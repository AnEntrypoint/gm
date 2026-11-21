#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PINS = JSON.parse(readFileSync(join(HERE, 'pins.json'), 'utf8'));
const given = process.argv.slice(2);
const valueOf = (flag) => resolve(given[given.indexOf(flag) + 1]);
const target = valueOf('--target');
const glue = valueOf('--glue');
const browser = join(target, 'browser');
const tablePin = PINS.browserPort.find((entry) => entry.file === 'stubs.tsv').sha256;

const table = readFileSync(join(browser, 'stubs.tsv'), 'utf8');
const digest = createHash('sha256').update(table).digest('hex');
if (digest !== tablePin) throw new Error('stubs.tsv sha256 ' + digest + ' does not match the pin ' + tablePin);

const symbols = table.trim().split('\n').slice(1).map((line) => line.split('\t')[0]);
const headerDirs = [join(target, 'txiki', 'src'), join(target, 'libuv', 'include'), browser];
const texts = headerDirs.flatMap((dir) => readdirSync(dir, { recursive: true })
  .filter((name) => String(name).endsWith('.h')).map((name) => join(dir, String(name))))
  .map((path) => readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*#.*$/gm, ''));
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
  if (new RegExp('\\b' + symbol + '\\s*\\([^;]*\\)\\s*\\{').test(glueText)) continue;
  const hit = texts.map((text) => text.match(new RegExp('([A-Za-z_][\\w\\s*]*?)\\b' + symbol + '\\s*\\(([^;{}]*?)\\)\\s*;'))).find(Boolean);
  if (!hit) throw new Error('no prototype found for ' + symbol);
  const returns = hit[1].replace(/\b(UV_EXTERN|extern)\b/g, '').replace(/\s+/g, ' ').trim();
  stubs.push(returns + ' ' + symbol + '(' + (hit[2].trim() || 'void') + ') { ' + bodyFor(symbol, returns) + ' }');
}
writeFileSync(join(browser, 'stubs.c'), ['#include <stddef.h>', '#include "private.h"', ...stubs, ''].join('\n'));
console.log('browser-stubs: wrote ' + stubs.length + ' stubs to ' + join(browser, 'stubs.c'));
