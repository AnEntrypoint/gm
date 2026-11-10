#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TABLE_SHA256 = '0531146a3c415fb4b64ff33fa2eede11cfd59e2a8d5d2ce3c653263ee09a8a3d';
const browser = join(root, 'native', 'third_party', 'txiki', 'browser');
const txiki = join(root, 'native', 'third_party', 'txiki', 'txiki');
const libuvInclude = join(root, 'native', 'third_party', 'txiki', 'libuv', 'include');
const glue = join(root, 'native', 'components', 'quickjs', 'txiki', 'txiki_stubs.c');

const tablePath = join(browser, 'stubs.tsv');
const table = readFileSync(tablePath, 'utf8');
const digest = createHash('sha256').update(table).digest('hex');
if (digest !== TABLE_SHA256) throw new Error(`stubs.tsv sha256 ${digest} does not match the pin ${TABLE_SHA256}`);

const symbols = table.trim().split('\n').slice(1).map((line) => line.split('\t')[0]);
const headers = [join(txiki, 'src'), libuvInclude, browser].flatMap((dir) => readdirSync(dir, { recursive: true })
  .filter((name) => String(name).endsWith('.h')).map((name) => join(dir, String(name))));
const texts = headers.map((path) => readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*#.*$/gm, ''));
const glueText = readFileSync(glue, 'utf8');

function bodyFor(symbol, returns) {
  if (symbol === 'uv_available_parallelism') return 'return 1;';
  if (returns === 'void') return '';
  if (returns.includes('*')) return 'return NULL;';
  if (returns === 'JSValue') return 'return JS_UNDEFINED;';
  if (returns === 'bool') return 'return false;';
  if (returns === 'int') return symbol.startsWith('uv_') ? 'return UV_ENOSYS;' : 'return -1;';
  return 'return 0;';
}

const stubs = [];
for (const symbol of symbols) {
  if (new RegExp(`\\b${symbol}\\s*\\([^;]*\\)\\s*\\{`).test(glueText)) continue;
  const pattern = new RegExp(`([A-Za-z_][\\w\\s*]*?)\\b${symbol}\\s*\\(([^;{}]*?)\\)\\s*;`);
  const hit = texts.map((text) => text.match(pattern)).find(Boolean);
  if (!hit) throw new Error(`no prototype found for ${symbol}`);
  const returns = hit[1].replace(/\b(UV_EXTERN|extern)\b/g, '').replace(/\s+/g, ' ').trim();
  const params = hit[2].trim() || 'void';
  stubs.push(`${returns} ${symbol}(${params}) { ${bodyFor(symbol, returns)} }`);
}
writeFileSync(join(browser, 'stubs.c'), ['#include <stddef.h>', '#include "private.h"', ...stubs, ''].join('\n'));
console.log(`browser-stubs: wrote ${stubs.length} stubs to native/third_party/txiki/browser/stubs.c`);
