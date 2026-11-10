#!/usr/bin/env node
import { removeTree } from './lib/tree.mjs';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2] ?? null;
const onNode = target === 'node';
const binary = onNode ? process.execPath : target === null ? null : resolve(target);
const lead = onNode ? [join(root, 'src', 'mcp.mjs')] : ['serve'];
if (binary === null || (!onNode && !existsSync(binary))) {
  console.log('browser-scope-check: skipped (no binary given)');
  process.exit(0);
}

const CALL_MS = 180000;
const MARKER = 'gm-browser-scope-marker';
const OPEN_CODE = `const p = await context.newPage(); state.gmScopeCheck = p; await p.goto('data:text/html,<title>${MARKER}</title>'); return p.url();`;
const SIDE_CODE = "const other = await browser.newContext(); await (await other.newPage()).goto('data:text/html,<title>side</title>'); const project = browser.contexts().find((c) => c !== state.gmRun); const projectPage = await project.newPage(); state.gmSideCheck = { other, projectPage }; return 'sided';";
const UNDO_CODE = "const side = state.gmSideCheck; if (side) { await side.projectPage.close(); await side.other.close(); } delete state.gmSideCheck; return 'undone';";
const COUNT_CODE = `let n = -1; for (let i = 0; i < 10; i += 1) { n = 0; for (const c of browser.contexts()) for (const p of c.pages()) if (!p.isClosed() && p.url().includes('${MARKER}')) n += 1; if (n === 0) break; await new Promise((done) => setTimeout(done, 1000)); } return n;`;

const workspace = mkdtempSync(join(tmpdir(), 'gm-browser-scope-'));
const child = spawn(binary, [...lead, '--workspace', workspace], { stdio: ['pipe', 'pipe', 'pipe'] });
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
const rpc = (method, params, ms) => {
  const id = nextId++;
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  return Promise.race([
    new Promise((done) => pending.set(id, done)),
    new Promise((done) => setTimeout(() => done(null), ms)),
  ]);
};

const failures = [];
const expect = (condition, text) => {
  if (!condition) failures.push(text);
};
const sameKeys = (value, keys) => value !== null && typeof value === 'object' && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());

const toolReply = async (name, args) => {
  const reply = await rpc('tools/call', { name, arguments: args }, CALL_MS);
  if (reply === null) return { ok: false, error: `${name} got no reply in ${CALL_MS} ms` };
  const text = reply.result?.content?.[0]?.text ?? '';
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: `${name} reply was not JSON: ${text.slice(0, 200)}` };
  }
};
const runCode = (body) => toolReply('run_code', { format: 'esm', timeoutMs: CALL_MS, body });
const outputOf = (reply) => (typeof reply.output === 'string' ? JSON.parse(reply.output) : reply.output);

let browserPhase = 'skipped: playwriter_execute is not served on this engine';

try {
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'gm-browser-scope-check', version: '1' } }, CALL_MS);
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  await rpc('resources/read', { uri: 'skill://gm/SKILL.md' });

  const first = await toolReply('next_context', {});
  expect(first.ok === true, `next_context did not start: ${JSON.stringify(first).slice(0, 200)}`);
  expect(typeof first.tabs === 'string', `next_context reply has no tabs field: keys ${Object.keys(first).join(', ')}`);

  const probe = await runCode(`return { execute: typeof gm.playwriter_execute === 'function', browsers: typeof gm.playwriter_browsers === 'function', tabs: await gm.browser_tabs({}), closeMachine: await gm.browser_close_machine({ confirm: false }), closeRun: typeof gm.playwriter_browsers === 'function' ? await gm.playwriter_browsers({ action: 'close' }) : null };`);
  expect(probe.ok === true, `run_code probe failed: ${JSON.stringify(probe).slice(0, 300)}`);
  if (probe.ok === true) {
    const got = outputOf(probe);
    expect(got.tabs?.state === 'none' && got.tabs?.text === 'tabs: none in this run', `browser_tabs before any browser use: ${JSON.stringify(got.tabs)}`);
    expect(got.closeMachine?.ok === false, `browser_close_machine without confirm must be refused: ${JSON.stringify(got.closeMachine)}`);
    if (got.browsers) {
      expect(sameKeys(got.closeRun, ['ok', 'closedPages', 'skipped']) && got.closeRun.ok === true && got.closeRun.closedPages === 0 && got.closeRun.skipped === true, `playwriter_browsers close with no browser use must be {ok, closedPages 0, skipped}: ${JSON.stringify(got.closeRun)}`);
    }
  }

  const finishPlain = await toolReply('finish', { witness: 'browser-scope check: non-browser phase' });
  expect(finishPlain.ok === true && finishPlain.finished === true, `finish did not end the run: ${JSON.stringify(finishPlain).slice(0, 200)}`);
  expect(sameKeys(finishPlain.browser, ['ok', 'closedPages', 'skipped']) && finishPlain.browser.skipped === true && finishPlain.browser.closedPages === 0, `finish reply browser key must be {ok, closedPages 0, skipped true} when no browser was used: ${JSON.stringify(finishPlain.browser)}`);

  await toolReply('next_context', {});
  const served = await runCode(`return { execute: typeof gm.playwriter_execute === 'function' };`);
  if (served.ok === true && outputOf(served).execute === true) {
    const opened = await runCode(`return { exec: await gm.playwriter_execute({ code: ${JSON.stringify(OPEN_CODE)}, timeout: 60000 }), tabs: await gm.browser_tabs({}) };`);
    if (opened.ok !== true) {
      browserPhase = `failed: the browser open did not run: ${String(opened.error ?? JSON.stringify(opened))}`;
      failures.push(`browser phase: ${browserPhase}`);
    } else {
      const { exec, tabs } = outputOf(opened);
      expect(exec?.ok === true && String(exec.output).includes(MARKER), `playwriter_execute did not open the marker page: ${JSON.stringify(exec)}`);
      expect(tabs?.state === 'changed' && String(tabs.text).includes('tabs: 1 in this run'), `browser_tabs did not list the run's page: ${JSON.stringify(tabs)}`);
      const sided = await runCode('return { side: await gm.playwriter_execute({ code: ' + JSON.stringify(SIDE_CODE) + ' }), tabs: await gm.browser_tabs({}), undo: await gm.playwriter_execute({ code: ' + JSON.stringify(UNDO_CODE) + ' }) };');
      if (sided.ok === true) {
        const got = outputOf(sided);
        const text = String(got.tabs?.text ?? '');
        const otherRuns = /(\d+) in other runs/.exec(text);
        const projectTabs = /(\d+) in the project browser/.exec(text);
        expect(got.side?.ok === true, 'the side pages did not open: ' + JSON.stringify(got.side));
        expect(text.includes('tabs: 1 in this run'), 'browser_tabs lost the run page after the side pages: ' + text);
        expect(otherRuns !== null && Number(otherRuns[1]) >= 1, 'browser_tabs did not count the page of another context: ' + text);
        expect(projectTabs !== null && Number(projectTabs[1]) >= 1, 'browser_tabs did not count the project browser page: ' + text);
      } else {
        failures.push('browser phase: the tab split did not run: ' + String(sided.error ?? ''));
      }
      const finishUsed = await toolReply('finish', { witness: 'browser-scope check: browser phase, page opened in the run' });
      expect(finishUsed.ok === true && sameKeys(finishUsed.browser, ['ok', 'closedPages']) && finishUsed.browser.ok === true && finishUsed.browser.closedPages >= 1, `finish reply browser key must be {ok, closedPages >= 1} after the run opened a page: ${JSON.stringify(finishUsed.browser)}`);
      await toolReply('next_context', {});
      const counted = await runCode(`return { count: await gm.playwriter_execute({ code: ${JSON.stringify(COUNT_CODE)} }), close: await gm.browser_close_machine({ confirm: true, force: true }) };`);
      if (counted.ok === true) {
        const { count, close } = outputOf(counted);
        const match = /\[return value\] (-?\d+)/.exec(String(count?.output ?? ''));
        expect(match !== null && Number(match[1]) === 0, `the run's page is still open after finish: ${String(count?.output ?? '')}`);
        expect(close?.ok === true, `browser_close_machine with confirm did not close the scratch browser: ${JSON.stringify(close).slice(0, 200)}`);
      } else {
        failures.push(`browser phase: the page count did not run: ${String(counted.error ?? '')}`);
      }
      await toolReply('finish', { witness: 'browser-scope check: browser phase closed' });
      if (failures.every((text) => !text.startsWith('browser phase'))) browserPhase = 'ran: the run page was listed, closed by finish, and gone from the browser after finish';
    }
  }
} catch (error) {
  failures.push(`check error: ${error.message}`);
} finally {
  child.kill();
  await new Promise((done) => setTimeout(done, 300));
  await removeTree(workspace).catch(() => {});
}

if (failures.length > 0) {
  console.log(`browser-scope-check: failed on ${target}`);
  for (const text of failures) console.log(`  - ${text}`);
  process.exit(1);
}
console.log(`browser-scope-check: ok (${target}: finish browser key, browser_tabs, playwriter_browsers close, browser_close_machine guard; browser run: ${browserPhase})`);
