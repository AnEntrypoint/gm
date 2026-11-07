#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { disabledServers } from '../src/mcp-client.mjs';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
export const binary = process.argv[2] ? resolve(process.argv[2]) : null;
export const programs = () => binary && existsSync(binary) ? ['node', binary] : ['node'];

export function withWorkspace(fn) {
  const workspace = mkdtempSync(join(tmpdir(), 'gm-check-'));
  try { return fn(workspace); }
  finally { rmSync(workspace, { recursive: true, force: true }); }
}

export function session(workspace, program) {
  const config = join(workspace, 'disabled-mcp.json');
  writeFileSync(config, JSON.stringify(disabledServers(join(root, 'defaults', 'mcp.json'))));
  const args = program === 'node'
    ? [process.execPath, join(root, 'src', 'mcp.mjs'), '--workspace', workspace, '--run-dir', join(workspace, 'runs', 'one'), '--max-inflight', '1', '--mcp-config', config]
    : [program, 'serve', '--workspace', workspace, '--run-dir', join(workspace, 'runs', 'one'), '--max-inflight', '1', '--mcp-config', config];
  const messages = [];
  let nextId = 0;
  const rpc = (method, params = {}) => { nextId += 1; messages.push({ jsonrpc: '2.0', id: nextId, method, params }); return nextId; };
  const notify = (method, params = {}) => messages.push({ jsonrpc: '2.0', method, params });
  const send = () => {
    const run = spawnSync(args[0], args.slice(1), { cwd: root, input: messages.map((m) => JSON.stringify(m) + '\n').join(''), encoding: 'utf8', timeout: 180000, maxBuffer: 16 * 1024 * 1024 });
    const replies = new Map();
    for (const line of String(run.stdout || '').split('\n')) {
      try { const m = JSON.parse(line); if (m.id !== undefined) replies.set(m.id, m); } catch {}
    }
    return { run, replies };
  };
  return { args, rpc, notify, send };
}

export function initialize(s) {
  s.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'gm-check', version: '1' } });
  s.notify('notifications/initialized');
}

export function value(replies, id) {
  const m = replies.get(id);
  const structured = m?.result?.structuredContent;
  if (structured && Object.prototype.hasOwnProperty.call(structured, 'output')) return structured.output;
  try { return JSON.parse(m?.result?.content?.[0]?.text ?? 'null'); } catch { return null; }
}

export function bodyValue(replies, id) {
  const v = value(replies, id);
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return v; } }
  return v;
}

export function assert(failures, condition, text) { if (!condition) failures.push(text); }
export function finish(name, failures) {
  if (failures.length) { console.error(name + ': failed: ' + failures.join('; ')); process.exit(1); }
  console.log(name + ': passed: node and native real-tree checks succeeded');
}

export function direct(name, fn) {
  return {
    set verify(verify) {
      run(name, fn, verify);
    },
  };
}

function run(name, fn, verify) {
  const failures = [];
  withWorkspace((workspace) => {
    for (const program of programs()) {
      const s = session(workspace, program);
      initialize(s);
      const first = s.rpc('tools/call', { name: 'next_context', arguments: { task: name, owner: true } });
      const ids = fn(s, workspace, first);
      const out = s.send();
      if (out.run.status !== 0) failures.push(program + ': server exited ' + out.run.status);
      const firstReply = value(out.replies, first);
      if (!firstReply || firstReply.ok !== true) failures.push(program + ': owner first-step task refused');
      verify(failures, out.replies, ids, program, workspace);
    }
  });
  finish(name, failures);
}

if (isMain) {
  direct('check-output-recovery', (s, workspace) => {
      const lines = Array.from({ length: 1399 }, (_, i) => i === 700 ? 'OUTPUT_MIDDLE_MARKER' : 'line ' + i).join('\n') + '\n';
      const big = 'A'.repeat(12000) + 'OUTPUT_TAIL_MARKER' + 'B'.repeat(12000);
      writeFileSync(join(workspace, 'lines.txt'), lines);
      writeFileSync(join(workspace, 'big.txt'), big);
      const shell = s.rpc('tools/call', { name: 'run_code', arguments: { body: "const r = await gm.run_shell({ command: 'cat lines.txt' }); const p = r.outputPath ?? r.artifactPath; const page = p ? await gm.read_file({ path: p, unit: 'chars', offset: r.next ?? 0, limit: 20000 }) : null; return { ok: r.ok, outputPath: p, totalChars: r.totalChars, next: r.next, truncated: r.truncated, middle: String(page?.output ?? '').includes('OUTPUT_MIDDLE_MARKER') };" } });
      const top = s.rpc('tools/call', { name: 'run_code', arguments: { body: "const r = await gm.read_file({ path: 'big.txt', unit: 'chars' }); return r.output;" } });
      const fetched = s.rpc('tools/call', { name: 'run_code', arguments: { body: "const r = await gm.fetch({ url: 'data:text/plain,' + encodeURIComponent(\"FETCH_HEAD \" + \"DOM_MARKER \".repeat(3000)), maxBytes: 32 }); const p = r.outputPath ?? r.artifactPath; const page = p ? await gm.read_file({ path: p, unit: 'chars', offset: r.next ?? 0, limit: 20000 }) : null; return { ok: r.ok, outputPath: p, totalBytes: r.totalBytes, next: r.next, truncated: r.truncated, marker: String(page?.output ?? '').includes('DOM_MARKER') };" } });
      return { shell, top, fetched };
    }).verify = (failures, replies, ids, program) => {
      const shell = bodyValue(replies, ids.shell);
      assert(failures, shell?.outputPath && shell.truncated === true && shell.middle === true, program + ': run_shell artifact did not page the middle marker');
      const topText = String(value(replies, ids.top) ?? '');
      assert(failures, topText.includes('outputPath') && topText.includes('OUTPUT_TAIL_MARKER') === false, program + ': top-level run_code reply did not expose a bounded artifact path');
      const fetched = bodyValue(replies, ids.fetched);
      assert(failures, fetched?.outputPath && fetched.marker === true, program + ': fetch artifact did not page DOM_MARKER');
    };
}

