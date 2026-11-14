#!/usr/bin/env node
import { spawn } from './lib/group.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { withoutPlaywriter } from './lib/no-playwriter.mjs';

const binary = process.argv[2] ? resolve(process.argv[2]) : null;
const watchdog = setTimeout(() => {
  console.error('invalid-utf8-reply-check: failed: no completion within 90000 ms');
  process.exit(1);
}, 90000);
watchdog.unref();

if (binary === null) {
  console.log('invalid-utf8-reply-check: skipped (no binary given)');
  process.exit(0);
}
if (process.platform === 'win32') {
  console.log('invalid-utf8-reply-check: skipped (Windows filenames are UTF-16)');
  process.exit(0);
}

const workspace = withoutPlaywriter(mkdtempSync(join(tmpdir(), 'gm-invalid-utf8-ws-')));
const payload = mkdtempSync(join(tmpdir(), 'gm-invalid-utf8-dir-'));
const badName = Buffer.from([0x01, 0xa0, 0x01, 0x05, 0x40, 0x40, 0x56, 0x47, 0x40, 0x38, 0x0f, 0x40]);
const twoByteName = Buffer.from('caf\u00e9.txt', 'utf8');
const fourByteName = Buffer.from('\ud83c\udfa7.txt', 'utf8');
for (const name of [badName, twoByteName, fourByteName]) {
  writeFileSync(Buffer.concat([Buffer.from(payload + '/'), name]), 'x');
}

const child = spawn(binary, ['serve', '--workspace', workspace], { stdio: ['pipe', 'pipe', 'pipe'] });
child.stderr.resume();
const failures = [];
const pending = new Map();
let nextId = 1;
let buffer = Buffer.alloc(0);
const decoder = new TextDecoder('utf-8', { fatal: true });
child.stdout.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const at = buffer.indexOf(0x0a);
    if (at < 0) break;
    const line = buffer.subarray(0, at);
    buffer = buffer.subarray(at + 1);
    if (line.length < 2) continue;
    let parsed;
    try {
      parsed = JSON.parse(decoder.decode(line));
    } catch (error) {
      failures.push('a stdio reply line is not valid UTF-8 JSON: ' + error.message);
      continue;
    }
    if (parsed.id !== undefined && pending.has(parsed.id)) {
      pending.get(parsed.id)(parsed);
      pending.delete(parsed.id);
    }
  }
});
const rpc = (method, params) => {
  const id = nextId++;
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  return new Promise((done) => pending.set(id, done));
};
const unwrap = (text) => {
  let value = JSON.parse(text);
  for (let i = 0; i < 3; i += 1) {
    if (value && typeof value === 'object' && value.output !== undefined) {
      value = value.output;
      continue;
    }
    if (typeof value === 'string') {
      try {
        value = JSON.parse(value);
        continue;
      } catch {
        break;
      }
    }
    break;
  }
  return value;
};
const run = async (body) => {
  const reply = await rpc('tools/call', { name: 'run_code', arguments: { format: 'esm', body } });
  return unwrap(reply.result?.content?.[0]?.text ?? JSON.stringify(reply.error ?? null));
};
const summary = {};
try {
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'gm-invalid-utf8-check', version: '1' } });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  await rpc('resources/read', { uri: 'skill://gm/SKILL.md' });
  const listed = await run('return { listing: await gm.list_dir({ path: ' + JSON.stringify(payload) + ' }) };');
  const listing = listed?.listing;
  summary.total = listing?.total;
  summary.output = listing?.output;
  const output = String(listing?.output ?? '');
  if (listing?.ok !== true) failures.push('list_dir did not return ok:true: ' + JSON.stringify(listing));
  if (!output.includes('\uFFFD')) failures.push('list_dir output has no U+FFFD replacement: ' + JSON.stringify(output));
  if (!output.includes('caf\u00e9.txt')) failures.push('list_dir lost a valid two-byte UTF-8 name');
  if (!output.includes('\ud83c\udfa7.txt')) failures.push('list_dir lost a valid four-byte UTF-8 name');
  if (listing?.total !== 3) failures.push('list_dir total was ' + listing?.total + ', not 3');
  const logReply = await run('return { log: await gm.query_log({ last: 5 }) };');
  summary.queryLogOk = logReply?.log != null && logReply.log.ok !== false;
  if (!summary.queryLogOk) failures.push('query_log after a bad-name list_dir returned no usable value');
} finally {
  child.kill();
  rmSync(workspace, { recursive: true, force: true });
  rmSync(payload, { recursive: true, force: true });
}
if (failures.length > 0) {
  console.error('invalid-utf8-reply-check: failed: ' + failures.join('; '));
  process.exit(1);
}
console.log('invalid-utf8-reply-check: passed: ' + JSON.stringify(summary));
