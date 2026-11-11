#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import readline from 'node:readline';

const CHECK = 'check-cut-marker';
const binary = resolve(process.argv[2] ?? 'build/release/native/components/host/gm');
const started = Date.now();
const failures = [];
const expect = (condition, text) => {
  if (!condition) failures.push(text);
};
const sandbox = mkdtempSync(join(tmpdir(), 'gm-cut-marker-'));
const workspace = join(sandbox, 'ws');
mkdirSync(workspace);
const quiet = join(sandbox, 'quiet.json');
const home = join(sandbox, 'home');
mkdirSync(home);
const { writeFileSync } = await import('node:fs');
writeFileSync(quiet, JSON.stringify({ mcpServers: { playwriter: { disabled: true } } }));
const relay = spawn(binary, ['serve', '--workspace', workspace, '--run-dir', join(workspace, 'runs', 'cut'), '--mcp-config', quiet], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, HOME: home } });
relay.stdin.on('error', () => {});
const waiting = new Map();
let nextId = 1;
readline.createInterface({ input: relay.stdout }).on('line', (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.id !== undefined && waiting.has(message.id)) {
    waiting.get(message.id)(message);
    waiting.delete(message.id);
  }
});
const rpc = (method, params, ms = 60000) =>
  new Promise((done) => {
    const id = nextId++;
    const timer = setTimeout(() => done(null), ms);
    waiting.set(id, (m) => {
      clearTimeout(timer);
      done(m);
    });
    relay.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
const runBody = async (body) => {
  const reply = await rpc('tools/call', { name: 'run_code', arguments: { body } });
  const text = reply?.result?.content?.[0]?.text;
  try {
    return JSON.parse(text ?? 'null');
  } catch {
    return { ok: false, raw: String(text ?? reply?.error?.message ?? 'no reply').slice(0, 400) };
  }
};

const BODY = `
  await gm.write_file({ path: 'src.txt', content: 'line of source text\\n'.repeat(500) });
  await gm.write_file({ path: 'small.txt', content: 'short\\n' });
  const bounded = await gm.read_file({ path: 'src.txt' });
  const refusedCopy = await gm.write_file({ path: 'copy.txt', content: bounded.output });
  const copyAfterRefusal = await gm.stat_file({ path: 'copy.txt' });
  const full = await gm.read_file({ path: 'src.txt', full: true });
  const fullCopy = await gm.write_file({ path: 'copy.txt', content: full.output });
  await gm.read_file({ path: 'small.txt' });
  const pointer = await gm.read_file({ path: 'small.txt' });
  const refusedPointer = await gm.write_file({ path: 'pointer.txt', content: pointer.output });
  const refusedEdit = await gm.edit_file({ path: 'copy.txt', old: 'line of source text', new: bounded.output });
  return { bounded: { truncated: bounded.truncated, complete: bounded.complete, outputPath: bounded.outputPath, chars: String(bounded.output).length, output: bounded.output }, refusedCopy, copyAfterRefusal, full: { truncated: full.truncated, complete: full.complete }, fullCopy, pointer: { pointer: pointer.pointer, complete: pointer.complete, output: pointer.output }, refusedPointer, refusedEdit };
`;

try {
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: CHECK, version: '1' } });
  relay.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  await rpc('resources/read', { uri: 'skill://gm/SKILL.md' });
  await rpc('tools/call', { name: 'next_context', arguments: {} });
  const result = await runBody(BODY);
  expect(!existsSync(join(workspace, 'pointer.txt')), 'a refused pointer write reached disk');
  expect(readFileSync(join(workspace, 'copy.txt'), 'utf8') === 'line of source text\n'.repeat(500), 'copy.txt must hold the full text, not a cut');
  const r = result.output ?? result;
  expect(r && r.bounded, `the body did not return its results: ${JSON.stringify(result).slice(0, 300)}`);
  if (r && r.bounded) {
    expect(r.bounded.truncated === true, `a bounded read must say truncated: ${JSON.stringify(r.bounded).slice(0, 200)}`);
    expect(r.bounded.complete === false, `a bounded read must say complete: false, in its JSON: ${JSON.stringify(r.bounded).slice(0, 200)}`);
    expect(typeof r.bounded.outputPath === 'string' && r.bounded.outputPath.length > 0, 'a bounded read must name its outputPath');
    expect(String(r.bounded.output).includes('<<<gm-cut omitted='), 'the cut must be an unmistakable <<<gm-cut marker, not an ellipsis');
    expect(!String(r.bounded.output).includes('\n...\n'), 'the cut must not be shaped like content (no ellipsis line)');
    const refused = r.refusedCopy?.error ?? '';
    expect(r.refusedCopy?.ok === false, `a write whose content carries the cut marker must be refused: ${JSON.stringify(r.refusedCopy)}`);
    expect(refused.includes('outputPath') && refused.includes('full: true') && refused.includes(r.bounded.outputPath), `the refusal must name outputPath and full: true: ${refused.slice(0, 300)}`);
    expect(!JSON.stringify(r.copyAfterRefusal).includes('"exists":true'), `a refused write must leave no copy.txt behind: ${JSON.stringify(r.copyAfterRefusal).slice(0, 200)}`);
    expect(r.full?.complete === true || r.full?.truncated === false, `a full read must not be bounded: ${JSON.stringify(r.full)}`);
    expect(r.fullCopy?.ok === true, `a write of a full read must succeed: ${JSON.stringify(r.fullCopy)}`);
    expect(r.pointer?.pointer === true && r.pointer?.complete === false, `a repeat read must answer a pointer that says complete: false: ${JSON.stringify(r.pointer)?.slice(0, 200)}`);
    expect(String(r.pointer?.output).includes('<<<gm-pointer'), 'the repeat read must answer the pointer marker');
    const pointed = r.refusedPointer?.error ?? '';
    expect(r.refusedPointer?.ok === false && pointed.includes('fresh: true'), `a write of a pointer reply must be refused and name fresh: true: ${JSON.stringify(r.refusedPointer)?.slice(0, 300)}`);
    expect(r.refusedEdit?.ok === false && String(r.refusedEdit?.error).includes('outputPath'), `an edit whose new text carries the cut marker must be refused: ${JSON.stringify(r.refusedEdit)?.slice(0, 300)}`);
  }
} finally {
  relay.kill('SIGKILL');
  rmSync(sandbox, { recursive: true, force: true });
}

const wall = ((Date.now() - started) / 1000).toFixed(2);
if (failures.length > 0) {
  console.error(`${CHECK}: ${failures.length} failure(s) (wall ${wall} s)\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
} else {
  console.log(`${CHECK}: ok (a bounded read says truncated and complete false with an outputPath and a <<<gm-cut marker; a write or edit carrying the cut is refused naming outputPath and full: true, and nothing reaches disk; a repeat read answers a <<<gm-pointer that is refused as file text and names fresh: true; a full read writes; wall ${wall} s)`);
}
