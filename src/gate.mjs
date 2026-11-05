import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCommand } from './exec.mjs';
import { disabledServers } from './mcp-client.mjs';
import { RELOADABLE } from './hot-config.mjs';
import { sourcesCheck } from './sources.mjs';
import { wikiCheck } from './wiki.mjs';
import { skillCheck } from './skills.mjs';
import { connectCheck } from './connect.mjs';

const SCRATCH = join(tmpdir(), 'gm-scratch', 'gm');
const KEEP = join(SCRATCH, 'KEEP');
const DOCS = ['DESIGN.md', 'AGENTS.md', 'README.md'];
const SOURCE = /\.(?:mjs|js|cjs)$/;
const NODE_TIMEOUT_MS = 20000;
const SYNTAX_CONCURRENCY = 8;
const SMOKE_TIMEOUT_MS = 60000;
const OWN_NAME = 'gm';
const OWN_CHECKS = ['ascii', 'docs', 'sources', 'wiki', 'skills', 'connect', 'workers', 'prompt', 'smoke'];
const WORKER_ENTRY = 'mcp.mjs';
const WORKER_LIST = 'src/worker-modules.json';
const MODULE_PATH = /^\.\/[\w.-]+\.mjs$/;
const SESSION_PROMPT = 'we want every possible approach to maximizing the usefulness kept whole, every word of it';

export const NOT_COVERED = [
  'semantic correctness of the change: the gate parses and runs the code, and it does not judge what the change means',
  'behaviour the smoke run does not exercise: the smoke run is one scripted task, plus a one-step negative control',
  'doc content beyond path existence: the docs check finds the repo paths, not whether a claim in the docs is true',
  'CI: this gate does not read CI results from .github/workflows/release.yml or .github/workflows/arm-diagnose.yml',
  'test suites: ctest, the parity harness and the Node leaf tests are not run by this gate',
];

export async function runGate(root, scope = null) {
  const own = isOwnCheckout(root);
  const checks = [];
  checks.push(await timed('syntax', () => syntaxCheck(root, own ? null : scope ?? [])));
  if (own) {
    checks.push(await timed('ascii', () => asciiCheck(root)));
    checks.push(await timed('docs', () => docCheck(root)));
    checks.push(await timed('sources', async () => sourcesCheck(root)));
    checks.push(await timed('wiki', async () => wikiCheck(root)));
    checks.push(await timed('skills', async () => skillCheck(root)));
    checks.push(await timed('connect', async () => connectCheck(root)));
    checks.push(await timed('workers', () => workersCheck(root)));
    checks.push(await timed('prompt', () => promptCheck(root)));
    checks.push(await timed('smoke', () => smokeCheck(root)));
  }
  const failed = checks.filter((check) => !check.ok).map((check) => check.name);
  const notCovered = own ? NOT_COVERED : [
    ...NOT_COVERED,
    `${OWN_CHECKS.join(', ')}: gm's own checks, not run in ${root}, which is not a gm checkout`,
    `syntax: in ${root}, only the modules named in this commit were checked; the rest of the tree was not`,
  ];
  return { ok: failed.length === 0, failed, checks, notCovered };
}

function isOwnCheckout(root) {
  try {
    return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name === OWN_NAME;
  } catch {
    return false;
  }
}

async function timed(name, run) {
  const started = Date.now();
  try {
    const result = await run();
    return { name, ok: result.ok, durMs: Date.now() - started, detail: result.detail };
  } catch (err) {
    return { name, ok: false, durMs: Date.now() - started, detail: `check threw: ${err.message}` };
  }
}

function trackedFiles(root) {
  return execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).split('\0').filter(Boolean);
}

function isPlainFile(path) {
  try {
    const info = lstatSync(path);
    return info.isFile();
  } catch {
    return false;
  }
}

async function syntaxCheck(root, scope) {
  const modules = trackedFiles(root).filter((file) => SOURCE.test(file));
  const files = scope === null ? modules : modules.filter((file) => scope.some((rel) => file === rel || file.startsWith(`${rel}/`)));
  const runs = new Array(files.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(SYNTAX_CONCURRENCY, files.length) }, async () => {
    while (next < files.length) {
      const index = next++;
      runs[index] = await runCommand(process.execPath, ['--check', files[index]], { cwd: root, timeoutMs: NODE_TIMEOUT_MS });
    }
  }));
  const bad = files.filter((_, i) => !runs[i].ok);
  return bad.length ? { ok: false, detail: `syntax errors in ${bad.join(', ')}` } : { ok: true, detail: `${files.length} modules parse` };
}

function asciiCheck(root) {
  const bad = [];
  let count = 0;
  for (const rel of trackedFiles(root)) {
    const path = join(root, rel);
    if (!isPlainFile(path)) continue;
    const buffer = readFileSync(path);
    if (buffer.subarray(0, 8000).includes(0)) continue;
    count += 1;
    if (/[^\x00-\x7f]/.test(buffer.toString('utf8'))) bad.push(rel);
  }
  return bad.length ? { ok: false, detail: `non-ASCII in ${bad.join(', ')}` } : { ok: true, detail: `${count} text files are ASCII` };
}

function docCheck(root) {
  const index = trackedFiles(root);
  const indexed = new Set(index);
  const tops = new Set(index.map((file) => file.split('/')[0]));
  const missing = [];
  let checked = 0;
  for (const doc of DOCS) {
    if (!isPlainFile(join(root, doc))) {
      missing.push(`${doc} itself`);
      continue;
    }
    const text = readFileSync(join(root, doc), 'utf8');
    for (const match of text.matchAll(/`([^`\s]+)`/g)) {
      const token = match[1].replace(/:\d+(?::\d+)?$/, '');
      if (!isRepoPath(token, tops)) continue;
      checked += 1;
      const exists = token.endsWith('/') ? index.some((file) => file.startsWith(token)) : indexed.has(token);
      if (!exists) missing.push(`${doc}: ${token}`);
    }
  }
  if (existsSync(KEEP)) {
    for (const rel of readFileSync(KEEP, 'utf8').split('\n').filter(Boolean)) {
      checked += 1;
      if (!existsSync(join(SCRATCH, rel))) missing.push(`KEEP: ${rel}`);
    }
  }
  return missing.length ? { ok: false, detail: `missing: ${missing.join(' | ')}` } : { ok: true, detail: `${checked} paths in the docs and KEEP exist` };
}

function isRepoPath(token, tops) {
  if (token.includes('<') || token.includes('*') || token.includes('://') || token.includes('=') || token.startsWith('/')) return false;
  if (/^(runs|node_modules|\.gm|\.agentplug-kv)(\/|$)/.test(token)) return false;
  return token.includes('/') && tops.has(token.split('/')[0]);
}

export async function workerModules(root) {
  const { parse } = createRequire(import.meta.url)('acorn');
  const graph = new Set();
  const queue = [WORKER_ENTRY];
  while (queue.length > 0) {
    const name = queue.pop();
    if (graph.has(name)) continue;
    graph.add(name);
    const ast = parse(readFileSync(join(root, 'src', name), 'utf8'), { ecmaVersion: 'latest', sourceType: 'module' });
    queue.push(...importsIn(ast, name));
  }
  return [...graph].sort();
}

function importsIn(node, file, found = []) {
  if (Array.isArray(node)) {
    for (const child of node) importsIn(child, file, found);
    return found;
  }
  if (node === null || typeof node !== 'object') return found;
  if (node.type === 'Literal' && typeof node.value === 'string' && MODULE_PATH.test(node.value)) found.push(node.value.slice(2));
  if (node.type === 'ImportExpression' && node.source.type === 'TemplateLiteral' && node.source.quasis[0].value.cooked.startsWith('./')) {
    if (file !== WORKER_ENTRY) throw new Error(`a computed import() of ./ modules in src/${file} is not followed by the graph`);
    found.push(...RELOADABLE);
  }
  for (const [key, child] of Object.entries(node)) if (key !== 'type' && typeof child === 'object') importsIn(child, file, found);
  return found;
}

async function workersCheck(root) {
  const graph = await workerModules(root);
  const listed = JSON.parse(readFileSync(join(root, WORKER_LIST), 'utf8'));
  const extra = listed.filter((name) => !graph.includes(name));
  const missing = graph.filter((name) => !listed.includes(name));
  if (extra.length === 0 && missing.length === 0) return { ok: true, detail: `${graph.length} worker modules match the import graph` };
  return { ok: false, detail: `${WORKER_LIST} lists ${JSON.stringify(extra)} that the graph does not reach, and lacks ${JSON.stringify(missing)}` };
}

async function promptCheck(root) {
  const dir = join(SCRATCH, 'gate-prompt', `run-${Date.now()}`);
  const runDir = join(dir, 'run');
  mkdirSync(join(dir, 'workspace'), { recursive: true });
  try {
    const noDefaults = join(dir, 'no-default-mcp.json');
    writeFileSync(noDefaults, JSON.stringify(disabledServers(join(root, 'defaults', 'mcp.json'))));
    const requests = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'gate', version: '0' } } },
      { jsonrpc: '2.0', id: 2, method: 'prompts/get', params: { name: 'gm', arguments: { task: SESSION_PROMPT } } },
    ];
    spawnSync(process.execPath, ['src/mcp.mjs', '--workspace', join(dir, 'workspace'), '--run-dir', runDir, '--mcp-config', noDefaults], { cwd: root, input: requests.map((request) => `${JSON.stringify(request)}\n`).join(''), timeout: NODE_TIMEOUT_MS, encoding: 'utf8' });
    const events = existsSync(join(runDir, 'log.jsonl')) ? readFileSync(join(runDir, 'log.jsonl'), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [];
    const tasks = events.filter((event) => event.kind === 'task').map((event) => event.text);
    if (tasks.length === 1 && tasks[0] === SESSION_PROMPT) return { ok: true, detail: `the session prompt kept all ${SESSION_PROMPT.split(' ').length} words` };
    return { ok: false, detail: `the session prompt became task ${JSON.stringify(tasks)}, not the whole prompt` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function smokeCheck(root) {
  const dir = join(SCRATCH, 'gate-smoke', `run-${Date.now()}`);
  mkdirSync(join(dir, 'smoke'), { recursive: true });
  mkdirSync(join(dir, 'control'), { recursive: true });
  try {
    const smoke = await runCommand(process.execPath, ['src/cli.mjs', 'run', '--task', 'commit gate smoke', '--workspace', join(dir, 'smoke')], { cwd: root, timeoutMs: SMOKE_TIMEOUT_MS });
    const control = await runCommand(process.execPath, ['src/cli.mjs', 'run', '--task', 'commit gate control', '--workspace', join(dir, 'control'), '--max-steps', '1'], { cwd: root, timeoutMs: SMOKE_TIMEOUT_MS });
    const problems = [];
    if (!(smoke.ok && /: finished after/.test(smoke.output))) problems.push('the smoke run did not finish');
    if (!(!control.ok && /: max_steps after/.test(control.output))) problems.push('the negative control did not stop at max_steps');
    return problems.length ? { ok: false, detail: problems.join('; ') } : { ok: true, detail: 'smoke run finished; negative control stopped at max_steps' };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
