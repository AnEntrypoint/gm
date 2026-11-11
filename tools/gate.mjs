#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scope = process.argv.slice(2);
const AGENTS_MAX_BYTES = 30 * 1024;
const DOCS = ['DESIGN.md', 'AGENTS.md', 'README.md'];
const SOURCE = /^tools\/[^/]+\.mjs$/;
const TIMEOUT_MS = 20000;

const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).split('\0').filter(Boolean);
const trackedFiles = () => git(['ls-files', '-z']);
const isPlainFile = (path) => {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
};

const syntaxCheck = () => {
  const files = trackedFiles().filter((file) => SOURCE.test(file) && (scope.length === 0 || scope.some((rel) => file === rel || file.startsWith(`${rel}/`))));
  const bad = files.filter((file) => spawnSync(process.execPath, ['--check', file], { cwd: root, timeout: TIMEOUT_MS }).status !== 0);
  return bad.length ? { ok: false, detail: `syntax errors in ${bad.join(', ')}` } : { ok: true, detail: `${files.length} tools modules parse` };
};

const asciiCheck = () => {
  const bad = [];
  let count = 0;
  for (const rel of trackedFiles()) {
    const path = join(root, rel);
    if (!isPlainFile(path)) continue;
    const buffer = readFileSync(path);
    if (buffer.subarray(0, 8000).includes(0)) continue;
    count += 1;
    if (/[^\x00-\x7f]/.test(buffer.toString('utf8'))) bad.push(rel);
  }
  return bad.length ? { ok: false, detail: `non-ASCII in ${bad.join(', ')}` } : { ok: true, detail: `${count} text files are ASCII` };
};

const docCheck = () => {
  const index = trackedFiles();
  const indexed = new Set(index);
  const tops = new Set(index.map((file) => file.split('/')[0]));
  const missing = [];
  let checked = 0;
  for (const doc of DOCS) {
    if (!isPlainFile(join(root, doc))) {
      missing.push(`${doc} itself`);
      continue;
    }
    for (const match of readFileSync(join(root, doc), 'utf8').matchAll(/`([^`\s]+)`/g)) {
      const token = match[1].replace(/:\d+(?::\d+)?$/, '');
      if (token.includes('<') || token.includes('*') || token.includes('://') || token.includes('=') || token.startsWith('/')) continue;
      if (/^(runs|node_modules|\.gm|\.agentplug-kv)(\/|$)/.test(token)) continue;
      if (!token.includes('/') || !tops.has(token.split('/')[0])) continue;
      checked += 1;
      const exists = token.endsWith('/') ? index.some((file) => file.startsWith(token)) : indexed.has(token);
      if (!exists) missing.push(`${doc}: ${token}`);
    }
  }
  return missing.length ? { ok: false, detail: `missing: ${missing.join(' | ')}` } : { ok: true, detail: `${checked} paths in the docs exist` };
};

const agentsSizeCheck = () => {
  const bytes = lstatSync(join(root, 'AGENTS.md')).size;
  return bytes > AGENTS_MAX_BYTES
    ? { ok: false, detail: `AGENTS.md is ${bytes} bytes; the limit is ${AGENTS_MAX_BYTES}` }
    : { ok: true, detail: `AGENTS.md is ${bytes} bytes, within ${AGENTS_MAX_BYTES}` };
};

const stagedCommentsCheck = async () => {
  const { parse } = await import(join(root, 'native', 'leaves', 'vendor', 'acorn.mjs'));
  const files = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']).filter((file) => /\.(?:mjs|js|cjs)$/.test(file));
  const hits = [];
  for (const file of files) {
    const text = execFileSync('git', ['show', `:${file}`], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    const found = [];
    parse(text, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true, locations: true, onComment: found });
    for (const comment of found) {
      if (comment.start === 0 && text.startsWith('#!')) continue;
      hits.push(`${file}:${comment.loc.start.line}`);
    }
  }
  return hits.length === 0
    ? { ok: true, detail: `${files.length} staged JavaScript modules have no comments` }
    : { ok: false, detail: `comments in staged modules: ${hits.join(', ')}` };
};

const checks = [
  ['syntax', syntaxCheck],
  ['ascii', asciiCheck],
  ['docs', docCheck],
  ['agents-size', agentsSizeCheck],
  ['staged-comments', stagedCommentsCheck],
];
const results = [];
for (const [name, run] of checks) {
  const started = Date.now();
  try {
    const result = await run();
    results.push({ name, ok: result.ok, ms: Date.now() - started, detail: result.detail });
  } catch (err) {
    results.push({ name, ok: false, ms: Date.now() - started, detail: `check threw: ${err.message}` });
  }
}
const failed = results.filter((result) => !result.ok).map((result) => result.name);
for (const result of results) console.log(`gate: ${result.name} ${result.ok ? 'ok' : 'FAILED'} ${result.ms} ms: ${result.detail}`);
console.log(JSON.stringify({ gate: failed.length === 0, failed }));
process.exitCode = failed.length === 0 ? 0 : 1;
