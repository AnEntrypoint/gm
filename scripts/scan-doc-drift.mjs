import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');

const DOC_EXTENSIONS = new Set(['.md', '.html', '.yaml', '.yml']);
const DOC_ROOTS = [
  'README.md',
  'AGENTS.md',
  'docs',
  'site/content',
  'gm-config/prose',
  'rs-plugkit/README.md',
  'rs-plugkit/crates/plugkit-core/src/orchestrator/instructions/prose',
];

const EXCLUDE_SEGMENTS = ['node_modules', '.git', 'CHANGELOG.md', 'paper-review-wood.md'];

const RETIRED_PATTERNS = [
  { name: 'rs-learn', re: /rs-learn/i },
  { name: 'npx gm-skill install', re: /npx\s+gm-skill\s+install/i },
  { name: 'bare bootstrap/0.txt id', re: /bootstrap\/0\.txt/ },
];

const RETIREMENT_CONTEXT_RE = /retired|tombstone|no longer|folded into|is now retired|archived/i;

function isAllowedRetirementMention(patternName, line) {
  if (patternName !== 'rs-learn') return false;
  return RETIREMENT_CONTEXT_RE.test(line);
}

function walk(startPath, files) {
  const abs = path.join(root, startPath);
  if (!fs.existsSync(abs)) return;
  const stat = fs.statSync(abs);
  if (stat.isFile()) {
    if (DOC_EXTENSIONS.has(path.extname(abs))) files.push(abs);
    return;
  }
  for (const entry of fs.readdirSync(abs)) {
    if (EXCLUDE_SEGMENTS.includes(entry)) continue;
    const rel = path.join(startPath, entry);
    const childAbs = path.join(root, rel);
    const childStat = fs.statSync(childAbs);
    if (childStat.isDirectory()) {
      walk(rel, files);
    } else if (DOC_EXTENSIONS.has(path.extname(childAbs)) && !EXCLUDE_SEGMENTS.some((seg) => childAbs.includes(seg))) {
      files.push(childAbs);
    }
  }
}

function scanFile(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split('\n');
  const findings = [];
  lines.forEach((line, idx) => {
    for (const pattern of RETIRED_PATTERNS) {
      if (pattern.re.test(line) && !isAllowedRetirementMention(pattern.name, line)) {
        findings.push({ file: path.relative(root, filePath), line: idx + 1, pattern: pattern.name, text: line.trim().slice(0, 200) });
      }
    }
  });
  return findings;
}

const files = [];
for (const docRoot of DOC_ROOTS) walk(docRoot, files);

const uniqueFiles = [...new Set(files)].filter((f) => !EXCLUDE_SEGMENTS.some((seg) => f.includes(seg)));

let allFindings = [];
for (const file of uniqueFiles) allFindings = allFindings.concat(scanFile(file));

if (allFindings.length > 0) {
  console.error(`doc-drift: ${allFindings.length} retired-reference hit(s) found in live documentation`);
  for (const f of allFindings) {
    console.error(`  ${f.file}:${f.line} [${f.pattern}] ${f.text}`);
  }
  process.exit(1);
} else {
  console.log(`doc-drift: clean (${uniqueFiles.length} doc files scanned, 0 retired-reference hits)`);
  process.exit(0);
}
