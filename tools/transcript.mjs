#!/usr/bin/env node
// One parser for both live arms. It reads a Claude Code transcript (JSONL) and returns the metrics of the
// turn that carries a marker token, so gm-new and gm are measured by the same code.
//
// Definitions, all in milliseconds from the transcript timestamps:
//   wallMs   prompt record (carrying the marker) to the first end_turn assistant record after it
//   toolMs   union of tool intervals, each from its tool_use record to its tool_result record
//   modelMs  union of model intervals, each from a request point (the prompt, or a tool_result) to the next assistant record
//   idleMs   wall time covered by neither a tool interval nor a model interval
//   toolCallMs  sum of tool intervals, where parallel calls count twice (kept for comparison with toolMs)
import { readFileSync } from 'node:fs';

export function readTranscript(file) {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line));
}

export function parseTurn(records, marker) {
  const at = (record) => Date.parse(record.timestamp);
  const blocksOf = (record) => (Array.isArray(record.message?.content) ? record.message.content : []);

  const prompt = records.find(
    (r) => r.type === 'user' && typeof r.timestamp === 'string' && JSON.stringify(r.message?.content ?? '').includes(marker) && !blocksOf(r).some((b) => b.type === 'tool_result'),
  );
  if (!prompt) return { ok: false, error: `no prompt record carries marker ${marker}` };
  const t0 = at(prompt);

  const assistants = records.filter((r) => r.type === 'assistant' && typeof r.timestamp === 'string' && at(r) >= t0);
  const endRecord = assistants.find((r) => r.message?.stop_reason === 'end_turn');
  if (!endRecord) return { ok: false, error: 'no end_turn assistant record after the prompt' };
  const tEnd = at(endRecord);

  const toolUses = new Map(); // tool_use id -> {name, start}
  for (const record of assistants) {
    if (at(record) > tEnd) continue;
    for (const block of blocksOf(record)) {
      if (block.type === 'tool_use' && !toolUses.has(block.id)) toolUses.set(block.id, { name: block.name, start: at(record) });
    }
  }
  const resultAt = new Map(); // tool_use id -> time of its tool_result
  const requests = [t0]; // request points: the prompt, then each tool_result
  for (const record of records) {
    if (record.type !== 'user' || typeof record.timestamp !== 'string') continue;
    const ts = at(record);
    if (ts < t0 || ts > tEnd) continue;
    for (const block of blocksOf(record)) {
      if (block.type !== 'tool_result') continue;
      resultAt.set(block.tool_use_id, ts);
      requests.push(ts);
    }
  }

  const toolIntervals = [];
  for (const [id, { start }] of toolUses) {
    const end = Math.min(resultAt.get(id) ?? tEnd, tEnd);
    if (end > start) toolIntervals.push([start, end]);
  }
  const responses = assistants.map(at).sort((a, b) => a - b);
  const modelIntervals = [];
  for (const request of requests) {
    const response = responses.find((ts) => ts > request && ts <= tEnd);
    if (response !== undefined) modelIntervals.push([request, response]);
  }

  const toolMs = unionMs(toolIntervals);
  const modelMs = unionMs(modelIntervals);
  const busy = unionMs([...toolIntervals, ...modelIntervals]);
  const wallMs = tEnd - t0;
  const names = [...toolUses.values()].map((u) => u.name);
  const mcp = names.filter((name) => name.startsWith('mcp__'));
  return {
    ok: true,
    marker,
    wallMs,
    idleMs: Math.max(0, wallMs - busy),
    toolMs,
    modelMs,
    toolCallMs: toolIntervals.reduce((sum, [a, b]) => sum + (b - a), 0),
    toolCalls: names.length,
    mcpToolCalls: mcp.length,
    builtinToolCalls: names.length - mcp.length,
    toolNames: names,
  };
}

// Total length covered by the intervals, counting overlaps once.
function unionMs(intervals) {
  const sorted = intervals.map(([a, b]) => [a, b]).sort((x, y) => x[0] - y[0]);
  let total = 0;
  let current = null;
  for (const [a, b] of sorted) {
    if (current === null || a > current[1]) {
      if (current !== null) total += current[1] - current[0];
      current = [a, b];
    } else if (b > current[1]) {
      current[1] = b;
    }
  }
  if (current !== null) total += current[1] - current[0];
  return total;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [file, marker] = process.argv.slice(2);
  if (!file || !marker) {
    console.error('usage: node tools/transcript.mjs <transcript.jsonl> <marker>');
    process.exit(2);
  }
  console.log(JSON.stringify(parseTurn(readTranscript(file), marker), null, 2));
}
