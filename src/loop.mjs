import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildPrompt, parseActions } from './prompt.mjs';

const WINDOW = 20;

export async function runLoop({ runDir, spec, model, tools, log, maxSteps, serial = false }) {
  log.append('start', { maxSteps, serial });
  const outcome = await stepLoop({ runDir, spec, model, tools, log, maxSteps, serial });
  await tools.close();
  log.append('end', outcome);
  return outcome;
}

async function stepLoop({ runDir, spec, model, tools, log, maxSteps, serial }) {
  for (let step = 1; step <= maxSteps; step += 1) {
    const rules = readFileSync(join(runDir, 'rules.md'), 'utf8');
    const prompt = buildPrompt({ rules, spec, events: log.recent(WINDOW), total: log.count() });

    let reply;
    const startMono = log.now();
    try {
      reply = await model.reply(prompt);
    } catch (err) {
      log.append('error', { step, message: err.message, startMono });
      return { status: 'error', steps: step, witness: null };
    }
    log.append('reply', { step, text: reply.text, startMono });

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

// Groups actions into waves that run together. Actions in one wave touch no
// path that another in the wave writes. A barrier action (shell, query_log,
// finish, unknown tools) runs alone. Serial mode puts every action in its own wave.
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
    if (touched.some((item) => conflicts(item, access.items))) {
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

function conflicts(item, items) {
  return items.some((other) => (item.write || other.write) && (isPrefix(item.path, other.path) || isPrefix(other.path, item.path)));
}

function isPrefix(a, b) {
  return a.length <= b.length && a.every((part, i) => part === b[i]);
}
