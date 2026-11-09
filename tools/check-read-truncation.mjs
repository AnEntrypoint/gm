#!/usr/bin/env node
import { withoutPlaywriter } from './lib/no-playwriter.mjs';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';
import { once } from 'node:events';

const exited = (child) => (child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : once(child, 'exit'));
import { OUTPUT_PAGE, readCharPage, readLinePage } from '../src/tools.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const binary = process.argv[2] ? resolve(process.argv[2]) : null;
const WATCHDOG_MS = 300000;
const watchdog = setTimeout(() => {
  console.error(`read-truncation: failed: no completion within ${WATCHDOG_MS} ms`);
  process.exit(1);
}, WATCHDOG_MS);
watchdog.unref();
const NOTICE = /^truncated at (\d+) of (\d+) bytes; [^\]]+$/;
const MARKER = '[gm-read:';
const workspace = withoutPlaywriter(mkdtempSync(join(tmpdir(), 'gm-read-check-')));
const failures = [];
const bigText = Array.from({ length: 3000 }, (_, i) => `line ${String(i).padStart(5, '0')} of the big file`).join('\n') + '\n';
const smallText = 'one\ntwo\n';
writeFileSync(join(workspace, 'big.txt'), bigText);
writeFileSync(join(workspace, 'small.txt'), smallText);
const BIG_BYTES = Buffer.byteLength(bigText);
const SMALL_BYTES = Buffer.byteLength(smallText);

function expectPage(label, page, bytes, mustTruncate) {
  if (mustTruncate && page.truncated !== true) failures.push(`${label}: a ${bytes}-byte file read past one page was not reported truncated`);
  if (String(page.output ?? '').includes(MARKER)) failures.push(`${label}: the returned output text carries a [gm-read: marker`);
  if (page.truncated === true) {
    const match = NOTICE.exec(page.notice ?? '');
    if (!match) failures.push(`${label}: truncated read has no notice field naming the bytes shown and the rest`);
    else if (match[2] !== String(bytes)) failures.push(`${label}: the notice names ${match[2]} bytes, the file is ${bytes}`);
  } else if (page.notice !== undefined) {
    failures.push(`${label}: untruncated read carries a notice`);
  }
  console.log(JSON.stringify({ label, truncated: page.truncated, totalBytes: page.totalBytes ?? null, notice: page.notice ?? null }));
}

const nodeBig = await readLinePage(join(workspace, 'big.txt'), 0, Infinity);
expectPage('node read_file lines big.txt', { ...nodeBig, totalBytes: BIG_BYTES }, BIG_BYTES, true);
const nodeBigChars = await readCharPage(join(workspace, 'big.txt'), 0, OUTPUT_PAGE);
expectPage('node read_file chars big.txt', { ...nodeBigChars, totalBytes: BIG_BYTES }, BIG_BYTES, true);
const nodeSmall = await readLinePage(join(workspace, 'small.txt'), 0, Infinity);
expectPage('node read_file lines small.txt', { ...nodeSmall, totalBytes: SMALL_BYTES }, SMALL_BYTES, false);

function nativeSession() {
  const child = spawn(binary, ['serve', '--workspace', workspace], { stdio: ['pipe', 'pipe', 'pipe'] });
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
    return new Promise((resolveReply) => pending.set(id, resolveReply));
  };
  return { child, rpc };
}

async function nativeRead(rpc, body) {
  const reply = await rpc('tools/call', { name: 'run_code', arguments: { body } });
  const text = reply.result?.content?.[0]?.text ?? 'null';
  const parsed = JSON.parse(text);
  if (parsed.ok !== true) throw new Error(`run_code refused: ${parsed.error ?? text.slice(0, 200)}`);
  return typeof parsed.output === 'string' ? JSON.parse(parsed.output) : parsed.output;
}

if (binary === null || !existsSync(binary)) {
  console.log('native read_file: skipped (no binary given)');
} else {
  const { child, rpc } = nativeSession();
  try {
    await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'read-truncation-check', version: '1' } });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    await rpc('resources/read', { uri: 'skill://gm/SKILL.md' });
    await rpc('tools/call', { name: 'next_context', arguments: { task: 'read truncation check' } });
    const probe = (path, args) => `const r = await gm.read_file({ path: '${path}'${args} }); return { truncated: r.truncated, totalBytes: r.totalBytes, notice: r.notice, output: String(r.output).slice(-400) };`;
    const bigWhole = await nativeRead(rpc, probe('big.txt', ''));
    expectPage('native read_file whole big.txt', bigWhole, BIG_BYTES, false);
    const bigLines = await nativeRead(rpc, probe('big.txt', ', offset: 0'));
    expectPage('native read_file lines big.txt', bigLines, BIG_BYTES, true);
    const bigChars = await nativeRead(rpc, probe('big.txt', ", offset: 0, unit: 'chars'"));
    expectPage('native read_file chars big.txt', bigChars, BIG_BYTES, true);
    const smallLines = await nativeRead(rpc, probe('small.txt', ''));
    expectPage('native read_file lines small.txt', smallLines, SMALL_BYTES, false);
    const returned = await rpc('tools/call', { name: 'run_code', arguments: { body: "const r = await gm.read_file({ path: 'big.txt' }); return r.output;" } });
    const cutReply = JSON.parse(returned.result?.content?.[0]?.text ?? 'null');
    if (cutReply?.ok !== true) failures.push(`a returned page over the reply cap was refused: ${cutReply?.error ?? 'no reply'}`);
    else if (cutReply.truncated !== true || typeof cutReply.outputPath !== 'string' || cutReply.outputPath === '') failures.push('a returned page cut by the reply cap carries no bounded artifact path');
    else if (!String(cutReply.notice).includes(cutReply.outputPath) || !String(cutReply.notice).includes('gm.read_file')) failures.push('a returned page cut by the reply cap carries no paging notice');
    else if (cutReply.output.length > 20000) failures.push(`a cut reply is ${cutReply.output.length} characters, over the 20000 cap`);
    console.log(JSON.stringify({ label: 'native run_code returned page', replyChars: cutReply?.output?.length ?? null, outputPath: cutReply?.outputPath ?? null, truncated: cutReply?.truncated ?? null }));
  } catch (error) {
    failures.push(`native: ${error.message}`);
  } finally {
    child.kill();
    await exited(child);
  }
}

rmSync(workspace, { recursive: true, force: true });
if (failures.length > 0) {
  console.error(`read-truncation: failed: ${failures.join('; ')}`);
  process.exit(1);
}
console.log('read-truncation: passed: a read past one page reports truncation, the bytes shown, the file size and the read that gets the rest in metadata, and the returned output text never carries the marker');
