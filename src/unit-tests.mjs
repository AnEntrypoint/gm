import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const RUST_TEST_ATTRIBUTE = `#${'[test]'}`;
const JS_TEST_CALL = /^\s*(describe|it|test)\s*\(/;
const JS_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.cts']);
const SKIP_DIRS = new Set(['.git', 'node_modules', 'build', 'runs', '.playwriter', '.gm', '.agentplug', '.agentplug-kv', 'third_party', 'vendor']);

export function scanUnitTests(root) {
  const hits = [];
  visit(root, root, hits);
  return hits;
}

function visit(root, dir, hits) {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (!SKIP_DIRS.has(name)) visit(root, full, hits);
      continue;
    }
    if (!stat.isFile()) continue;
    const file = relative(root, full);
    if (/\.test\./.test(name)) hits.push(`${file}: test file name`);
    let text;
    try {
      text = readFileSync(full, 'utf8');
    } catch {
      continue;
    }
    text.split('\n').forEach((line, index) => {
      if (line.includes(RUST_TEST_ATTRIBUTE)) hits.push(`${file}:${index + 1}: ${RUST_TEST_ATTRIBUTE}`);
      if (JS_EXTENSIONS.has(extname(name)) && JS_TEST_CALL.test(line)) hits.push(`${file}:${index + 1}: test call`);
    });
  }
}
