#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const argv = process.argv.slice(2);
const dayAt = argv.indexOf('--day');
const day = dayAt === -1 ? new Date().toISOString().slice(0, 10) : argv[dayAt + 1];
const roots = argv.filter((arg, index) => arg !== '--day' && index !== dayAt + 1).map((arg) => resolve(arg));
const defaults = roots.length > 0 ? roots : ['/workspace/fx/runs', '/workspace/jayzee/runs', '/workspace/thebird/runs'];
const TOKEN_CHARS = 4;
const SMALL_OUTPUT = 2000;
const WRITE_TOOLS = new Set(['write_file', 'edit_file', 'fs_op', 'run_shell']);

const runs = [];
for (const root of defaults) {
  if (!existsSync(root)) continue;
  for (const name of readdirSync(root).filter((name) => name.startsWith(`${day}-`)).sort()) {
    const file = join(root, name, 'log.jsonl');
    if (!existsSync(file)) continue;
    const events = readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
    runs.push({ root, name, events });
  }
}

const stable = (value) => JSON.stringify(value ?? null);
const causes = new Map();
const add = (cause, turns, tokens, detail) => {
  const row = causes.get(cause) ?? { cause, turns: 0, tokens: 0, examples: [] };
  row.turns += turns;
  row.tokens += Math.round(tokens);
  if (detail && row.examples.length < 3 && !row.examples.includes(detail)) row.examples.push(detail);
  causes.set(cause, row);
};

const totals = { runs: runs.length, calls: 0, codeCalls: 0, waitMs: 0, outputChars: 0 };
for (const run of runs) {
  const actions = new Map();
  const seenCalls = new Map();
  const lastWrite = new Map();
  const readsSinceWrite = new Map();
  const errors = new Map();
  const innerByAction = new Map();
  let openRunCode = null;
  for (const event of run.events) {
    if (event.kind === 'action') {
      actions.set(event.seq, event);
      if (event.tool === "run_code") openRunCode = event.seq;
      if (event.tool === 'next_context' && event.args && Object.keys(event.args).length === 0) continue;
      totals.calls += 1;
      const body = event.body ?? event.args?.body;
      if (event.tool === 'run_code' && typeof body === 'string') {
        const verbs = (body.match(/gm\.[a-z_]+\(/g) ?? []).length;
        if (verbs === 1) add('one-verb run_code body (batchable)', 1, 0, `${run.name} step ${event.step}`);
      }
    }
    if (event.kind === 'code-call') {
      totals.codeCalls += 1;
      if (!innerByAction.has(openRunCode)) innerByAction.set(openRunCode, []);
      innerByAction.get(openRunCode).push(event);
      const key = `${event.tool}:${stable(event.args)}`;
      const size = typeof event.outputChars === 'number' ? event.outputChars : String(event.output ?? '').length;
      const pointer = typeof event.output === 'string' && event.output.startsWith('[gm: the same call');
      if (seenCalls.has(key)) {
        add('repeated identical call', 1, pointer ? 0 : seenCalls.get(key) / TOKEN_CHARS, `${event.tool} ${stable(event.args).slice(0, 80)}`);
      } else {
        seenCalls.set(key, size);
      }
      if (event.tool === 'read_file' && event.args?.path) {
        const path = event.args.path;
        if (readsSinceWrite.get(path) && event.args?.fresh !== true && !pointer) add('same file read again with no write between', 1, size / TOKEN_CHARS, `${run.name} ${path}`);
        readsSinceWrite.set(path, true);
      }
      if (WRITE_TOOLS.has(event.tool) && event.args?.path) readsSinceWrite.delete(event.args.path);
      if (event.tool === 'job_status' && typeof event.args?.waitMs === 'number') totals.waitMs += Number(event.durMs) || 0;
      if (event.ok === false && event.error) errors.set(String(event.error).slice(0, 120), (errors.get(String(event.error).slice(0, 120)) ?? 0) + 1);
    }
    if (event.kind === 'result') {
      const size = typeof event.outputChars === 'number' ? event.outputChars : String(event.output ?? '').length;
      totals.outputChars += size;
      if (event.tool === 'next_context' && String(event.output ?? '').includes('"unchanged":true')) {
        add('next_context polled with nothing new', 1, 0, run.name);
      }
      if (event.tool === 'job_status' && typeof event.durMs === 'number') totals.waitMs += event.durMs;
      if (event.truncated === true || event.outputPath) add('reply truncated and paged', 0, 0, `${run.name} ${event.tool}`);
      if (event.tool === 'run_code' && size > SMALL_OUTPUT) {
        const inner = innerByAction.get(event.actionSeq) ?? [];
        const top = inner.reduce((best, call) => ((call.outputChars ?? String(call.output ?? '').length) > (best?.size ?? -1) ? { tool: call.tool, size: call.outputChars ?? String(call.output ?? '').length } : best), null);
        add(`run_code reply over 2000 chars, largest inner verb ${top?.tool ?? 'none'}`, 0, (size - SMALL_OUTPUT) / TOKEN_CHARS, `${run.name} ${size} chars`);
      }
      if (event.ok === false && event.error) errors.set(String(event.error).slice(0, 120), (errors.get(String(event.error).slice(0, 120)) ?? 0) + 1);
    }
    if (event.kind === 'refusal') add('refused call (run ended or not allowed)', 1, String(event.error ?? '').length / TOKEN_CHARS, String(event.error ?? '').slice(0, 80));
  }
  for (const [text, count] of errors) {
    if (count > 1) add('same error hit more than once', count - 1, 0, text);
  }
}

const rows = [...causes.values()].sort((a, b) => b.tokens - a.tokens || b.turns - a.turns);
console.log(`day ${day}: ${totals.runs} runs, ${totals.calls} model calls, ${totals.codeCalls} verb calls in run_code, ${totals.outputChars} output chars, ${Math.round(totals.waitMs)} ms in job waits`);
console.log('rank | cause | turns lost | tokens lost (approx) | example');
rows.forEach((row, index) => {
  console.log(`${index + 1} | ${row.cause} | ${row.turns} | ${row.tokens} | ${row.examples[0] ?? ''}`);
});
