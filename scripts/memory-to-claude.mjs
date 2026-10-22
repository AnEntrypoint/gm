#!/usr/bin/env node
// Converts gm's flat memory files into Claude Code memory files: one fact per file with
// name, description and metadata frontmatter, indexed by one line in MEMORY.md.
// Sources: <repo>/.gm/memories/mem-*.md and <repo>/.gm/disciplines/<name>/memories/mem-*.md,
// each with key, ns, created and updated frontmatter. Files the converter wrote carry
// metadata.source under .gm/ and are removed when their source is gone. Other files in the
// target directory, and MEMORY.md lines outside the managed block, are left alone.
// Entries that name a repo path which no longer exists are reported as stale, never deleted.
//
// Usage: node scripts/memory-to-claude.mjs [--dry-run] [--repo <root>] [--to <memory dir>]
//   --repo defaults to the current directory. --to defaults to
//   ~/.claude/projects/<repo with / replaced by ->/memory.
// Output: one line per file written, removed or flagged, then a summary. Exit 0 on success.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
};

const repo = path.resolve(value('--repo', process.cwd()));
const target = path.resolve(
  value('--to', path.join(os.homedir(), '.claude', 'projects', repo.replace(/\//g, '-'), 'memory')),
);
const dryRun = flag('--dry-run');
const INDEX_START = '<!-- gm-memory: start -->';
const INDEX_END = '<!-- gm-memory: end -->';
const REPO_PATH = /\b((?:agentplug|rs-plugkit|rs-codeinsight|rs-search|gm-config|gm-mcp|scripts|skills|docs|bin)\/[\w./-]*[\w])/g;

function sourceFiles() {
  const dirs = [path.join(repo, '.gm', 'memories')];
  const disciplines = path.join(repo, '.gm', 'disciplines');
  if (fs.existsSync(disciplines)) {
    for (const d of fs.readdirSync(disciplines)) dirs.push(path.join(disciplines, d, 'memories'));
  }
  const out = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).sort()) {
      if (/^mem-.+\.md$/.test(f)) out.push(path.join(dir, f));
    }
  }
  return out;
}

function parseFlat(file) {
  const text = fs.readFileSync(file, 'utf8');
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) throw new Error(`no frontmatter in ${path.relative(repo, file)}`);
  const meta = Object.fromEntries(m[1].split('\n').map((l) => l.split(/:\s*/, 2)));
  if (!meta.key) throw new Error(`no key in ${path.relative(repo, file)}`);
  return { key: meta.key, ns: meta.ns || 'default', body: m[2].trim(), source: path.relative(repo, file) };
}

function describe(body) {
  const para = body.split(/\n\s*\n/)[0].replace(/\s+/g, ' ').trim();
  const cut = para.search(/\. /);
  const first = cut > 0 && cut < 160 ? para.slice(0, cut + 1) : para;
  return first.length > 160 ? first.slice(0, 157) + '...' : first;
}

function slug(entry) {
  const base = entry.ns === 'default' ? `gm-${entry.key}` : `${entry.ns}-${entry.key}`;
  return base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function missingPaths(body) {
  const named = [...body.matchAll(REPO_PATH)].map((m) => m[1].replace(/[.,;:)]+$/, ''));
  return [...new Set(named)].filter((p) => !fs.existsSync(path.join(repo, p)));
}

function generatedSource(file) {
  const m = fs.readFileSync(file, 'utf8').match(/^  source: (\.gm\/.+)$/m);
  return m ? m[1] : null;
}

const entries = [];
const failures = [];
for (const file of sourceFiles()) {
  try {
    const e = parseFlat(file);
    entries.push({ ...e, name: slug(e), description: describe(e.body) });
  } catch (err) {
    failures.push(err.message);
  }
}
if (failures.length) {
  for (const f of failures) console.error(`error: ${f}`);
  process.exit(1);
}
entries.sort((a, b) => a.name.localeCompare(b.name));

const sourcesNow = new Set(entries.map((e) => e.source));
if (!dryRun) fs.mkdirSync(target, { recursive: true });
const existing = fs.existsSync(target) ? fs.readdirSync(target).filter((f) => f.endsWith('.md') && f !== 'MEMORY.md') : [];
const produced = new Set(entries.map((e) => `${e.name}.md`));
let removed = 0;
for (const f of existing) {
  const src = generatedSource(path.join(target, f));
  if (src && !sourcesNow.has(src) && !produced.has(f)) {
    console.log(`remove  ${f}  (source ${src} is gone)`);
    if (!dryRun) fs.unlinkSync(path.join(target, f));
    removed++;
  }
}

let written = 0;
const stale = [];
for (const e of entries) {
  const body = [
    '---',
    `name: ${e.name}`,
    `description: ${e.description.replace(/\n/g, ' ')}`,
    'metadata:',
    '  type: project',
    `  source: ${e.source}`,
    '---',
    '',
    e.body,
    '',
  ].join('\n');
  const missing = missingPaths(e.body);
  if (missing.length) stale.push(`${e.name}: ${missing.join(', ')}`);
  console.log(`write   ${e.name}.md  (${e.source})${missing.length ? '  [stale: ' + missing.join(', ') + ']' : ''}`);
  if (!dryRun) fs.writeFileSync(path.join(target, `${e.name}.md`), body, 'utf8');
  written++;
}

const block = [INDEX_START, ...entries.map((e) => `- [${e.name}](${e.name}.md): ${e.description}`), INDEX_END].join('\n');
const indexPath = path.join(target, 'MEMORY.md');
let index = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, 'utf8') : '';
if (index.includes(INDEX_START) && index.includes(INDEX_END)) {
  index = index.replace(new RegExp(`${INDEX_START}[\\s\\S]*?${INDEX_END}`), block);
} else {
  index = (index.trimEnd() ? index.trimEnd() + '\n\n' : '') + block + '\n';
}
if (!dryRun) fs.writeFileSync(indexPath, index, 'utf8');
console.log(`index   MEMORY.md  (${entries.length} line(s) in the managed block)`);

console.log(`summary: ${written} written, ${removed} removed, ${stale.length} flagged stale${dryRun ? ' (dry run, nothing written)' : ''}`);
console.log(`target:  ${target}`);
if (stale.length) {
  console.log('flagged stale (named repo paths that do not exist; review, not deleted):');
  for (const s of stale) console.log(`  ${s}`);
}
