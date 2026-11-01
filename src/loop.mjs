import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildPrompt, parseActions } from './prompt.mjs';
import { conflicts } from './tools.mjs';
import { writeSummary } from './summary.mjs';

const WINDOW = 20;
const MAX_RETRIES = 4;
const MAX_HEADERLESS_429_RETRIES = 2;
const MAX_RETRY_AFTER_MS = 60000;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 16000;
const JITTER = 0.2;
const RETRYABLE_NETWORK = new Set(['ECONNRESET', 'ETIMEDOUT', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'TimeoutError']);

export async function runLoop({ runDir, spec, model, tools, log, maxSteps, serial = false }) {
  log.append('start', { mode: 'cli', maxSteps, serial });
  let outcome;
  try {
    outcome = await stepLoop({ runDir, spec, model, tools, log, maxSteps, serial });
  } finally {
    await tools.close();
  }
  writeSummary(log);
  log.append('end', outcome);
  return outcome;
}

async function stepLoop({ runDir, spec, model, tools, log, maxSteps, serial }) {
  for (let step = 1; step <= maxSteps; step += 1) {
    const rules = readFileSync(join(runDir, 'rules.md'), 'utf8');
    const { prompt, prefix, prefixSha } = buildPrompt({ rules, spec, events: log.recent(WINDOW), total: log.count() });

    const call = await askModel(model, { prompt, prefix }, { step, prefixSha, log });
    if (!call.ok) {
      const { error } = call;
      log.append('error', {
        step,
        message: error.message,
        status: error.status,
        errorType: error.errorType,
        attempts: call.attempts,
        reason: call.reason,
        prefixSha,
        startMono: call.startMono,
      });
      return { status: 'error', steps: step, witness: null };
    }
    const { reply } = call;
    log.append('reply', { step, text: reply.text, attempts: reply.attempts, prefixSha, usage: reply.usage, startMono: reply.startMono });

    const parsed = parseActions(reply.text);
    if (!parsed.ok) {
      log.append('parse_error', { step, error: parsed.error });
      continue;
    }
    const outcome = await runActions(parsed.actions, { step, tools, log, serial });
    if (outcome.finished) return { status: 'finished', steps: step, witness: outcome.witness };
  }
  return { status: 'max_steps', steps: maxSteps, witness: null };
}

// One model call per step. A failure is retried only when retryPlan allows it. Each retry is logged,
// and a failure that is not retried returns with its reason.
async function askModel(model, { prompt, prefix }, { step, prefixSha, log }) {
  let retries = 0;
  let headerless429 = 0;
  for (let attempt = 1; ; attempt += 1) {
    const startMono = log.now();
    try {
      const reply = await model.reply(prompt, { prefix });
      return { ok: true, reply: { ...reply, attempts: attempt, startMono } };
    } catch (error) {
      const plan = retryPlan(error, { retries, headerless429 });
      if (plan.reason) return { ok: false, error, attempts: attempt, reason: plan.reason, startMono };
      log.append('retry', {
        step,
        attempt,
        status: error.status,
        errorType: error.errorType,
        delayMs: plan.delayMs,
        source: plan.source,
        prefixSha,
        message: error.message,
        startMono,
      });
      retries += 1;
      if (plan.headerless) headerless429 += 1;
      await sleep(plan.delayMs);
    }
  }
}

// Returns {delayMs, source, headerless} to retry, or {reason} to fail the call.
function retryPlan(error, { retries, headerless429 }) {
  const rateLimited = error.status === 429;
  const retryable = rateLimited || retryableStatus(error.status) || (error.network === true && RETRYABLE_NETWORK.has(error.errorType));
  if (!retryable) {
    const where = error.status === undefined ? 'network' : `HTTP ${error.status}`;
    return { reason: `not retryable: ${where} ${error.errorType ?? ''}`.trim() };
  }
  if (rateLimited && error.retryAfterMs !== undefined) {
    if (error.retryAfterMs > MAX_RETRY_AFTER_MS) {
      return { reason: `retry-after of ${Math.round(error.retryAfterMs / 1000)} s is over ${MAX_RETRY_AFTER_MS / 1000} s` };
    }
    if (retries >= MAX_RETRIES) return { reason: `${MAX_RETRIES} retries used` };
    return { delayMs: error.retryAfterMs, source: 'retry-after', headerless: false };
  }
  if (rateLimited && headerless429 >= MAX_HEADERLESS_429_RETRIES) {
    return { reason: `429 without retry-after, after ${MAX_HEADERLESS_429_RETRIES} retries` };
  }
  if (retries >= MAX_RETRIES) return { reason: `${MAX_RETRIES} retries used` };
  return { delayMs: backoffMs(retries), source: 'backoff', headerless: rateLimited };
}

// 408, 409 and every 5xx are retried. A 429 has its own rule, and other 4xx fail at once.
function retryableStatus(status) {
  return status === 408 || status === 409 || (status >= 500 && status <= 599);
}

// Exponential backoff: 1 s, doubling, capped at 16 s, with plus or minus 20% jitter.
function backoffMs(retries) {
  const base = Math.min(BASE_DELAY_MS * 2 ** retries, MAX_DELAY_MS);
  const jittered = base * (1 + JITTER * (2 * Math.random() - 1));
  return Math.min(Math.round(jittered), MAX_DELAY_MS);
}

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

async function runActions(actions, { step, tools, log, serial }) {
  const waves = planWaves(actions, tools, serial);
  for (let i = 0; i < waves.length; i += 1) {
    const results = await Promise.all(waves[i].map((action) => runAction(action, step, tools, log)));
    const finish = results.find((result) => result.finished);
    if (finish) {
      for (const rest of waves.slice(i + 1).flat()) {
        log.append('skipped', { step, tool: rest.tool, reason: 'follows finish in the same reply' });
      }
      return { finished: true, witness: finish.output };
    }
  }
  return { finished: false };
}

async function runAction({ tool, args }, step, tools, log) {
  const startMono = log.now();
  log.enter();
  log.append('action', { step, tool, args });
  const result = await tools.run(tool, args);
  if (result.refused) log.append('refusal', { step, tool, error: result.error, startMono });
  else log.append('result', { step, tool, startMono, ...result });
  log.leave();
  return result;
}

// Groups actions into waves that run together. Paths compare by real path and by
// dev:ino group (hard links), so actions in one wave touch no file that another
// in the wave writes. A barrier action (shell, query_log, finish, unknown tools,
// a path that cannot be planned) runs alone. Serial mode puts every action in its own wave.
export function planWaves(actions, tools, serial) {
  if (serial) return actions.map((action) => [action]);
  const waves = [];
  let wave = [];
  let touched = [];
  for (const action of actions) {
    const access = tools.access(action.tool, action.args);
    if (access.barrier) {
      if (wave.length) waves.push(wave);
      waves.push([action]);
      wave = [];
      touched = [];
      continue;
    }
    if (conflicts({ items: touched }, access)) {
      waves.push(wave);
      wave = [];
      touched = [];
    }
    wave.push(action);
    touched.push(...access.items);
  }
  if (wave.length) waves.push(wave);
  return waves;
}
