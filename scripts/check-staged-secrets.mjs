import { execFileSync } from 'node:child_process';
import process from 'node:process';

const RULES = [
  ['aws-access-key-id', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['private-key-pem', /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})\b/],
  ['slack-token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['sk-style-key', /\bsk-[A-Za-z0-9_-]{32,}/],
  ['url-inline-password', /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@'"]+:([^\s/@'"]{3,})@[^\s'"]+/i],
  ['assigned-secret-literal', /\b(?:api[_-]?key|secret[_-]?key|access[_-]?token|auth[_-]?token|password)\s*[:=]\s*(?:["'][A-Za-z0-9/+_=.-]{20,}["']|[A-Za-z0-9/+_=.-]{20,}(?![A-Za-z0-9/+_=.-]))/i],
];

const PLACEHOLDER = /^[$<{%]/;

let diff;
try {
  diff = execFileSync('git', ['diff', '--cached', '-U0', '--no-color', '--no-ext-diff'], {
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
} catch (err) {
  console.log(`REFUSE: git diff --cached failed (${String(err.stderr || err.message).trim()})`);
  process.exit(2);
}

if (diff.trim() === '') {
  console.log('REFUSE: nothing staged to scan');
  console.log('RESULT: FAIL (nothing staged; a PASS must certify staged bytes)');
  process.exit(1);
}

// A commit that stages a skills/ file must stage skills/manifest.sha256 too, or the
// installed-skill refresh serves a stale digest list (scripts/build-skill-manifest.mjs).
const stagedNames = execFileSync('git', ['diff', '--cached', '--name-only', '--no-renames', '-z'], {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
  stdio: ['ignore', 'pipe', 'pipe'],
}).split('\0').filter(Boolean);
const skillEdit = stagedNames.find((n) => n.startsWith('skills/') && n !== 'skills/manifest.sha256');
if (skillEdit && !stagedNames.includes('skills/manifest.sha256')) {
  console.log(`REFUSE: staged ${skillEdit} without skills/manifest.sha256 (run node scripts/build-skill-manifest.mjs and stage it)`);
  console.log('RESULT: FAIL (stale skill manifest)');
  process.exit(1);
}

const findings = [];
let file = '(unknown)';
let line = 0;
let added = 0;
const files = new Set();

// A `+++ ` line is a file header only outside a hunk. Inside a hunk every `+` line is an
// added line, including one whose content begins with `++`.
let inHunk = false;
for (const raw of diff.split('\n')) {
  if (raw.startsWith('diff --git ')) {
    inHunk = false;
    continue;
  }
  if (!inHunk && raw.startsWith('+++ ')) {
    file = raw.startsWith('+++ b/') ? raw.slice(6) : raw.slice(4);
    files.add(file);
    continue;
  }
  const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(raw);
  if (hunk) {
    inHunk = true;
    line = Number(hunk[1]);
    continue;
  }
  if (inHunk && raw.startsWith('+')) {
    added++;
    const text = raw.slice(1);
    for (const [rule, re] of RULES) {
      const m = re.exec(text);
      if (!m) continue;
      if (rule === 'url-inline-password' && PLACEHOLDER.test(m[1])) continue;
      findings.push(`${rule} ${file}:${line}`);
      break;
    }
    line++;
  }
}

if (findings.length > 0) {
  for (const f of findings) console.log(`REFUSE: credential shape ${f}`);
  console.log(`RESULT: FAIL (${findings.length} staged line(s) matched; remove the value, load it from an env var or secret store, then re-stage)`);
  process.exit(1);
}

console.log(`PASS: ${added} staged added line(s) in ${files.size} file(s) scanned, no credential shape found`);
console.log('RESULT: PASS');
