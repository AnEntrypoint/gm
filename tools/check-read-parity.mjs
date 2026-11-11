#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2] ?? null;
if (target === null) {
  console.error('read-parity-check: usage: node tools/check-read-parity.mjs (node | path-to-native-gm)');
  process.exit(2);
}
const onNode = target === 'node';
const binary = onNode ? process.execPath : resolve(target);
if (!onNode && !existsSync(binary)) {
  console.error(`read-parity-check: no native binary at ${binary}`);
  process.exit(2);
}
const lead = onNode ? [join(root, 'src', 'mcp.mjs')] : ['serve'];

const REPLY_MS = 20000;
const EMOJI = String.fromCodePoint(0x1f600);
const ACCENTED = 'caf\u00e9 na\u00efve \u00fcn\u00efc\u00f6d\u00e9 \u20ac ';
const LONG = 'x'.repeat(19999);
const bytes = Buffer.concat([
  Buffer.from(`${ACCENTED}${EMOJI}`, 'utf8'),
  Buffer.from([0xff]),
  Buffer.from(`\n${LONG}${EMOJI}y\ntail ok\n`, 'utf8'),
]);
const emojiAt = ACCENTED.length;

const PROBES = {
  'whole lines': '',
  'whole chars': ", unit: 'chars'",
  'chars cut inside an emoji': `, unit: 'chars', offset: 0, limit: ${emojiAt + 1}`,
  'chars from inside an emoji': `, unit: 'chars', offset: ${emojiAt + 1}, limit: 5`,
  'chars page of 20000': ", unit: 'chars', offset: 0, limit: 20000",
  'lines first page': ', offset: 0',
  'lines long line cut': ', offset: 1',
  'lines past the end': ', offset: 9',
};

const DIGEST = 'a2b2b789cd278568';
const REPLACEMENT = '\ufffd';
const head = (text) => text.slice(0, 24);
const tail = (text) => text.slice(-24);
const hintChars = (offset) => `pass unit: "chars", offset: ${offset} and limit: 20000 to read the rest`;
const hintLines = (offset, limit) => `pass offset: ${offset} and limit: ${limit} to read the rest`;
const WHOLE_OUTPUT = `${ACCENTED}${EMOJI}${REPLACEMENT}\n${LONG}${EMOJI}y\ntail ok\n`;
const LONG_HINT = 'line 1 is longer than a page: pass unit: "chars", offset: 20025 and limit: 20000 to read the rest';

const EXPECTED = {
  'whole lines': { ok: true, unit: 'lines', total: 3, offset: 0, next: null, nextOffset: null, truncated: false, totalBytes: 20048, digest: DIGEST, cutLine: null, hint: null, notice: null, outLen: WHOLE_OUTPUT.length, outHead: head(WHOLE_OUTPUT), outTail: tail(WHOLE_OUTPUT) },
  'whole chars': { ok: true, unit: null, total: 20036, offset: 0, next: null, nextOffset: null, truncated: false, totalBytes: 20048, digest: DIGEST, cutLine: null, hint: null, notice: null, outLen: WHOLE_OUTPUT.length, outHead: head(WHOLE_OUTPUT), outTail: tail(WHOLE_OUTPUT) },
  'chars cut inside an emoji': { ok: true, unit: null, total: 20036, offset: 0, next: 22, nextOffset: 22, truncated: true, totalBytes: 20048, digest: DIGEST, cutLine: null, hint: hintChars(22), notice: `truncated at 29 of 20048 bytes; ${hintChars(22)}`, outLen: 21, outHead: ACCENTED, outTail: ACCENTED },
  'chars from inside an emoji': { ok: true, unit: null, total: 20036, offset: 22, next: 27, nextOffset: 27, truncated: true, totalBytes: 20048, digest: DIGEST, cutLine: null, hint: hintChars(27), notice: `truncated at 10 of 20048 bytes; ${hintChars(27)}`, outLen: 6, outHead: `${EMOJI}${REPLACEMENT}\nxx`, outTail: `${EMOJI}${REPLACEMENT}\nxx` },
  'chars page of 20000': { ok: true, unit: null, total: 20036, offset: 0, next: 20000, nextOffset: 20000, truncated: true, totalBytes: 20048, digest: DIGEST, cutLine: null, hint: hintChars(20000), notice: `truncated at 20012 of 20048 bytes; ${hintChars(20000)}`, outLen: 20000, outHead: head(WHOLE_OUTPUT), outTail: 'x'.repeat(24) },
  'lines first page': { ok: true, unit: 'lines', total: 3, offset: 0, next: 1, nextOffset: 1, truncated: true, totalBytes: 20048, digest: DIGEST, cutLine: null, hint: hintLines(1, 2), notice: `truncated at 37 of 20048 bytes; ${hintLines(1, 2)}`, outLen: 25, outHead: head(WHOLE_OUTPUT), outTail: tail(`${ACCENTED}${EMOJI}${REPLACEMENT}\n`) },
  'lines long line cut': { ok: true, unit: 'lines', total: 3, offset: 1, next: 2, nextOffset: 2, truncated: true, totalBytes: 20048, digest: DIGEST, cutLine: true, hint: LONG_HINT, notice: `truncated at 19999 of 20048 bytes; ${LONG_HINT}`, outLen: 19999, outHead: 'x'.repeat(24), outTail: 'x'.repeat(24) },
  'lines past the end': { ok: true, unit: 'lines', total: 3, offset: 9, next: null, nextOffset: null, truncated: false, totalBytes: 20048, digest: DIGEST, cutLine: null, hint: null, notice: null, outLen: 0, outHead: '', outTail: '' },
};

const removeTree = async (path) => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      rmSync(path, { recursive: true, force: true });
      return;
    } catch (error) {
      if (error?.code !== 'ENOTEMPTY' || attempt === 50) throw error;
      await new Promise((done) => setTimeout(done, 100));
    }
  }
};

const workspace = mkdtempSync(join(tmpdir(), 'gm-read-parity-'));
const configDir = mkdtempSync(join(tmpdir(), 'gm-read-parity-config-'));
writeFileSync(join(workspace, 'fixed.txt'), bytes);
const mcpConfig = join(configDir, 'no-default-mcp.json');
writeFileSync(mcpConfig, JSON.stringify({ mcpServers: { playwriter: { disabled: true } } }));

const child = spawn(binary, [...lead, '--workspace', workspace, '--mcp-config', mcpConfig], { stdio: ['pipe', 'pipe', 'pipe'] });
child.stderr.resume();
const pending = new Map();
let nextId = 1;
readline.createInterface({ input: child.stdout }).on('line', (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.id !== undefined && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  }
});
const rpc = (method, params) => {
  const id = nextId++;
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  return new Promise((done) => pending.set(id, done));
};

const failures = [];
const observedOf = {};

const probeBody = (args) => `const r = await gm.read_file({ path: 'fixed.txt'${args}, full: true, fresh: true }); const out = String(r.output ?? ''); return { ok: r.ok === true, unit: r.unit ?? null, total: r.total ?? null, offset: r.offset ?? null, next: r.next ?? null, nextOffset: r.nextOffset ?? null, truncated: r.truncated ?? null, totalBytes: r.totalBytes ?? null, digest: r.digest ?? null, cutLine: r.cutLine ?? null, hint: r.hint ?? null, notice: r.notice ?? null, outLen: out.length, outHead: out.slice(0, 24), outTail: out.slice(-24) };`;

try {
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'gm-read-parity-check', version: '1' } });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  await rpc('resources/read', { uri: 'skill://gm/SKILL.md' });

  for (const [label, args] of Object.entries(PROBES)) {
    const reply = await Promise.race([
      rpc('tools/call', { name: 'run_code', arguments: { format: 'esm', timeoutMs: 60000, body: probeBody(args) } }),
      new Promise((done) => setTimeout(() => done(null), REPLY_MS).unref()),
    ]);
    if (reply === null) {
      failures.push(`${label}: no reply within ${REPLY_MS} ms`);
      continue;
    }
    const body = JSON.parse(reply.result.content[0].text);
    const observed = typeof body.output === 'string' ? JSON.parse(body.output) : body.output;
    if (body.ok !== true || observed === undefined || observed === null) {
      failures.push(`${label}: the body did not run: ${JSON.stringify(body).slice(0, 300)}`);
      continue;
    }
    observedOf[label] = observed;
    const expected = EXPECTED[label];
    if (expected === undefined) {
      failures.push(`${label}: no expected constant; observed ${JSON.stringify(observed)}`);
      continue;
    }
    for (const key of Object.keys(expected)) {
      const got = JSON.stringify(observed[key] ?? null);
      const want = JSON.stringify(expected[key]);
      if (got !== want) failures.push(`${label}: ${key} expected ${want}, got ${got}`);
    }
  }
} catch (error) {
  failures.push(`engine: ${error.message}`);
} finally {
  const exited = child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : once(child, 'exit');
  child.kill();
  await Promise.race([exited, new Promise((done) => setTimeout(done, 5000))]);
  await removeTree(workspace);
  await removeTree(configDir);
}

if (failures.length > 0) {
  console.error(`read-parity-check: ${failures.length} failure(s) on ${target}\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
} else {
  console.log(`read-parity-check: ok (${Object.keys(PROBES).length} read_file probes on ${target} match the native constants: digest, byte totals, bounded text and notices)`);
}
process.exit(process.exitCode ?? 0);
