import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildPrompt, parseAction } from './prompt.mjs';

const WINDOW = 20;

export async function runLoop({ runDir, spec, model, tools, log, maxSteps }) {
  for (let step = 1; step <= maxSteps; step += 1) {
    const rules = readFileSync(join(runDir, 'rules.md'), 'utf8');
    const prompt = buildPrompt({ rules, spec, events: log.recent(WINDOW), total: log.count() });

    let text;
    try {
      text = await model.reply(prompt);
    } catch (err) {
      log.append('error', { step, message: err.message });
      return end(log, 'error', step, null);
    }
    log.append('reply', { step, text });

    const action = parseAction(text);
    if (!action.ok) {
      log.append('parse_error', { step, error: action.error });
      continue;
    }
    log.append('action', { step, tool: action.tool, args: action.args });

    const result = await tools.run(action.tool, action.args);
    if (result.refused) {
      log.append('refusal', { step, tool: action.tool, error: result.error });
    } else {
      log.append('result', { step, tool: action.tool, ...result });
    }
    if (result.finished) return end(log, 'finished', step, result.output);
  }
  return end(log, 'max_steps', maxSteps, null);
}

function end(log, status, steps, witness) {
  log.append('end', { status, steps, witness });
  return { status, steps, witness };
}
