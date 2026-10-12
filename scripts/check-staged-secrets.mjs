import { execFileSync } from 'node:child_process';
import process from 'node:process';

// Scans only the lines this commit adds (the staged diff) for high-confidence
// credential shapes. Exit 0 when clean, 1 when a shape is found, 2 when git
// cannot produce the diff. Findings print the rule, path and line, never the value.

const RULES = [
  ['aws-access-key-id', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['private-key-pem', /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})\b/],
  ['slack-token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['sk-style-key', /\bsk-[A-Za-z0-9_-]{32,}/],
  ['url-inline-password', /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@'"]+:([^\s/@'"]{3,})@[^\s'"]+/i],
  ['assigned-secret-literal', /\b(?:api[_-]?key|secret[_-]?key|access[_-]?token|auth[_-]?token|password)\s*[:=]\s*["'][A-Za-z0-9/+_=.-]{20,}["']/i],
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

const findings = [];
let file = '(unknown)';
let line = 0;
let added = 0;
const files = new Set();

for (const raw of diff.split('\n')) {
  if (raw.startsWith('+++ ')) {
    file = raw.startsWith('+++ b/') ? raw.slice(6) : raw.slice(4);
    files.add(file);
    continue;
  }
  const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(raw);
  if (hunk) {
    line = Number(hunk[1]);
    continue;
  }
  if (raw.startsWith('+') && !raw.startsWith('+++')) {
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
