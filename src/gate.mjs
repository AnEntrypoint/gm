import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { runCommand } from './exec.mjs';
import { RELOADABLE } from './hot-config.mjs';
import { sourcesCheck } from './sources.mjs';
import { wikiCheck } from './wiki.mjs';
import { skillCheck } from './skills.mjs';
import { connectCheck } from './connect.mjs';

// The commit gate. git_commit runs these checks before it commits, with no CI and no test files. A failed check refuses
// the commit, and every check reports its result and its time in the commit's log event.
const SCRATCH = '/tmp/gm-scratch/gm-new';
const KEEP = join(SCRATCH, 'KEEP');
const DOCS = ['DESIGN.md', 'AGENTS.md', 'README.md'];
const SOURCE = /\.(?:mjs|js|cjs)$/;
const NODE_TIMEOUT_MS = 20000;
const SMOKE_TIMEOUT_MS = 60000;
// gm-new's own checks read gm-new's files: its docs, its skill, its relay and its smoke run. They run only in a gm-new checkout. In any
// other workspace they are not run, and notCovered names them, so a commit there is not refused for files it never had. The checkout is
// recognised by the package name, which a deleted file cannot change, so a damaged gm-new checkout still fails its own checks.
const OWN_NAME = 'gm-new';
const OWN_CHECKS = ['ascii', 'docs', 'sources', 'wiki', 'skills', 'connect', 'workers', 'smoke'];
const WORKER_ENTRY = 'mcp.mjs';
const WORKER_LIST = 'src/worker-modules.json';
const MODULE_PATH = /^\.\/[\w.-]+\.mjs$/;

// What the gate does not check. Every git_commit result and its commit event carry this list, so a pass is not read as more
// than it is. Any gap that survives the checks is recorded here, rather than hidden.
export const NOT_COVERED = [
  'semantic correctness of the change: the gate parses and runs the code, and it does not judge what the change means',
  'behaviour the smoke run does not exercise: the smoke run is one scripted task, plus a one-step negative control',
  'doc content beyond path existence: the docs check finds the repo paths, not whether a claim in the docs is true',
  'CI: none is configured, and no CI result is read',
];

// scope names the paths of the commit. In a gm-new checkout the syntax step checks every tracked module. In another workspace it checks only
// the modules the commit names: the rest of that tree is not gm-new's to judge, and its files may hold other code, such as evidence files.
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
    checks.push(await timed('smoke', () => smokeCheck(root)));
  }
  const failed = checks.filter((check) => !check.ok).map((check) => check.name);
  const notCovered = own ? NOT_COVERED : [
    ...NOT_COVERED,
    `${OWN_CHECKS.join(', ')}: gm-new's own checks, not run in ${root}, which is not a gm-new checkout`,
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

// A check that throws is a failed check with its message, not an error out of the gate, so a commit is refused with the reason.
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

// scope is null for the whole tree, or the paths of a commit, where a file is in scope when it is one of them or lies under one.
async function syntaxCheck(root, scope) {
  const modules = trackedFiles(root).filter((file) => SOURCE.test(file));
  const files = scope === null ? modules : modules.filter((file) => scope.some((rel) => file === rel || file.startsWith(`${rel}/`)));
  const runs = await Promise.all(files.map((file) => runCommand(process.execPath, ['--check', file], { cwd: root, timeoutMs: NODE_TIMEOUT_MS })));
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

// A backticked token is a repo path when its first segment is a top-level name in the index. Runtime directories,
// placeholders, URLs, method names and absolute paths are not repo paths. A trailing :line is removed first.
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
  if (!existsSync(KEEP)) {
    missing.push('KEEP file missing');
  } else {
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

// The modules the worker loads, from the import graph of src/mcp.mjs. It follows static imports, literal import() calls and the module paths in
// string literals (new URL and register entries). The leaves loader in src/mcp.mjs is import(`./${file}`) over RELOADABLE, so that template
// adds RELOADABLE; the same template anywhere else is an error. An import() of a project file (src/body-worker.mjs) is not a module of src/.
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

// The checked-in list must equal the graph. A module the graph reaches and the list lacks would not restart the worker when it changes.
async function workersCheck(root) {
  const graph = await workerModules(root);
  const listed = JSON.parse(readFileSync(join(root, WORKER_LIST), 'utf8'));
  const extra = listed.filter((name) => !graph.includes(name));
  const missing = graph.filter((name) => !listed.includes(name));
  if (extra.length === 0 && missing.length === 0) return { ok: true, detail: `${graph.length} worker modules match the import graph` };
  return { ok: false, detail: `${WORKER_LIST} lists ${JSON.stringify(extra)} that the graph does not reach, and lacks ${JSON.stringify(missing)}` };
}

// The smoke run must finish. The negative control runs the same task with one step, so it must stop at max_steps.
// Both run in a scratch workspace that is removed afterwards.
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
