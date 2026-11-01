import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { runCommand } from './exec.mjs';

// The commit gate. git_commit runs these checks before it commits, with no CI and no test files. A failed check refuses
// the commit, and every check reports its result and its time in the commit's log event.
const SCRATCH = '/tmp/gm-scratch/gm-new';
const KEEP = join(SCRATCH, 'KEEP');
const DOCS = ['DESIGN.md', 'AGENTS.md', 'README.md'];
const SOURCE = /\.(?:mjs|js|cjs)$/;
const NODE_TIMEOUT_MS = 20000;
const SMOKE_TIMEOUT_MS = 60000;

export async function runGate(root) {
  const checks = [];
  checks.push(await timed('syntax', () => syntaxCheck(root)));
  checks.push(await timed('ascii', () => asciiCheck(root)));
  checks.push(await timed('docs', () => docCheck(root)));
  checks.push(await timed('smoke', () => smokeCheck(root)));
  const failed = checks.filter((check) => !check.ok).map((check) => check.name);
  return { ok: failed.length === 0, failed, checks };
}

async function timed(name, run) {
  const started = Date.now();
  const result = await run();
  return { name, ok: result.ok, durMs: Date.now() - started, detail: result.detail };
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

async function syntaxCheck(root) {
  const files = trackedFiles(root).filter((file) => SOURCE.test(file));
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
