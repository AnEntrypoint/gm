import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { walkFiles } from './lib/walk-files.mjs'

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
  '.github',
  'skills',
];

const EXCLUDE_SEGMENTS = ['node_modules', '.git', 'CHANGELOG.md', 'paper-review-wood.md'];

const RETIRED_PATTERNS = [
  { name: 'rs-learn', re: /rs-learn/i },
  { name: 'npx gm-skill install', re: /npx\s+gm-skill\s+install/i },
  { name: 'bare bootstrap/0.txt id', re: /bootstrap\/0\.txt/ },
  { name: 'rs-exec superseded surface', re: /\bretired\s+(?:`|<code>)?rs-exec\b|\brs-exec(?:`|<\/code>)?\s+(?:crate|host-helper|surfaces?)\b/i },
];

const RETIREMENT_CONTEXT_RE = /retired|tombstone|no longer|folded into|is now retired|archived/i;

function isAllowedRetirementMention(patternName, line) {
  if (patternName !== 'rs-learn') return false;
  return RETIREMENT_CONTEXT_RE.test(line);
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

const isDocFile = (filePath) => DOC_EXTENSIONS.has(path.extname(filePath)) && !filePath.split(path.sep).some((part) => EXCLUDE_SEGMENTS.includes(part));
const files = DOC_ROOTS.flatMap((docRoot) => walkFiles(path.join(root, docRoot), { skipName: (name) => EXCLUDE_SEGMENTS.includes(name), includeFile: isDocFile }));
const uniqueFiles = [...new Set(files)];

const allFindings = uniqueFiles.flatMap(scanFile);

if (allFindings.length > 0) {
  console.error(`doc-drift: ${allFindings.length} retired-reference hit(s) found in live documentation`);
  for (const f of allFindings) {
    console.error(`  ${f.file}:${f.line} [${f.pattern}] ${f.text}`);
  }
  process.exit(1);
}
const checked = RETIRED_PATTERNS.map((p) => p.name).join(', ');
console.log(`doc-drift: 0 hits for ${RETIRED_PATTERNS.length} retired-reference patterns (${checked}) in ${uniqueFiles.length} doc files`);
process.exit(0);
