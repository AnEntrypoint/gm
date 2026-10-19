#!/usr/bin/env node
// Repo hygiene gate: AGENTS.md byte budget, no UTF-8 BOM in tracked text,
// and no decorative em-dash or arrow in tracked prose (backtick spans exempt),
// and no hardcoded absolute path (/tmp, /config/, /workspace/, /home/, C:\ or C:/) in
// non-comment lines of tracked scripts under scripts/ (comment lines are the allowlist).
// Usage: node scripts/check-repo-hygiene.mjs [repoRoot]
// Prints one line per violation and `RESULT: PASS` or `RESULT: FAIL`.
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || '.');
const AGENTS_BUDGET = 30000;
const PROSE = /\.(md|html)$|^(skills|docs|site\/content)\//;
const TEXT = /\.(md|html|js|mjs|cjs|ts|json|sh|ps1|ya?ml|toml|rs|css|txt)$|^skills\//;
const BOM = [0xef, 0xbb, 0xbf];
const DECORATIVE = /[—→]/;
const SCRIPT = /^scripts\/.*\.(sh|mjs|js|cjs|ps1)$/;
const COMMENT = /^(#|\/\/|\*|\/\*)/;
const HARDCODED_PATH = /[\/]tmp\b|[\/]config[\/]|[\/]workspace[\/]|[\/]home[\/]|C:[\\/]/;

const violations = [];
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, maxBuffer: 1 << 26 })
  .toString('utf8')
  .split('\0')
  .filter(Boolean);

const agentsBytes = statSync(path.join(root, 'AGENTS.md')).size;
if (agentsBytes >= AGENTS_BUDGET) {
  violations.push(`AGENTS.md: ${agentsBytes} bytes >= ${AGENTS_BUDGET} (compile a fresh AGENTS.md, invariant 3)`);
}

for (const rel of tracked) {
  if (!TEXT.test(rel)) continue;
  let buf;
  try {
    buf = readFileSync(path.join(root, rel));
  } catch {
    continue;
  }
  if (buf.length >= 3 && BOM.every((b, i) => buf[i] === b)) {
    violations.push(`${rel}: UTF-8 BOM (EF BB BF) at start of file`);
  }
  if (SCRIPT.test(rel)) {
    buf.toString('utf8').split('\n').forEach((line, i) => {
      const code = line.trim();
      if (COMMENT.test(code)) return;
      const literal = HARDCODED_PATH.exec(code);
      if (literal) violations.push(`${rel}:${i + 1}: hardcoded absolute path ${literal[0]} in a script; use $TMPDIR, $HOME or a relative path`);
    });
  }
  if (!PROSE.test(rel)) continue;
  const lines = buf.toString('utf8').split('\n');
  lines.forEach((line, i) => {
    const outsideTicks = line.replace(/`[^`]*`/g, '');
    if (DECORATIVE.test(outsideTicks)) {
      violations.push(`${rel}:${i + 1}: decorative em-dash or arrow in tracked prose`);
    }
  });
}

for (const v of violations) console.log(v);
console.log(`checked ${tracked.length} tracked files; AGENTS.md ${agentsBytes} bytes`);
console.log(violations.length ? 'RESULT: FAIL' : 'RESULT: PASS');
process.exit(violations.length ? 1 : 0);
