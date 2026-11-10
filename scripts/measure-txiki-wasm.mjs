#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const GZIP_TIMEOUT_MS = 120000;
const SECTION_NAMES = ['custom', 'type', 'import', 'function', 'table', 'memory', 'global', 'export', 'start', 'element', 'code', 'data', 'datacount'];
const FAMILIES = [
  ['sqlite3', [/sqlite3_/, /SQLITE_/, /tjs:sqlite/, /tjs__mod_sqlite3/]],
  ['webcrypto', [/webcrypto/i]],
  ['httpclient', [/httpclient/i]],
  ['libwebsockets', [/lws_/, /libwebsockets/i, /tjs__mod_ws_/, /tjs:ws\b/]],
  ['mbedtls', [/mbedtls_/, /tjs__mod_tls_/, /tjs:tls\b/]],
];
const isDebugSection = (name) => name.startsWith('.debug') || name === 'name' || name === 'sourceMappingURL';

function skipLeb(buf, pos) {
  while (buf[pos] & 0x80) pos += 1;
  return pos + 1;
}

function readLeb(buf, pos) {
  let value = 0;
  let scale = 1;
  let byte;
  do {
    byte = buf[pos++];
    value += (byte & 0x7f) * scale;
    scale *= 128;
  } while (byte & 0x80);
  return [value, pos];
}

function readName(buf, pos) {
  let length;
  [length, pos] = readLeb(buf, pos);
  return [buf.toString('utf8', pos, pos + length), pos + length];
}

function skipLimits(buf, pos) {
  const flag = buf[pos];
  pos = skipLeb(buf, pos + 1);
  return flag & 1 ? skipLeb(buf, pos) : pos;
}

function parseSections(buf) {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x0061736d || buf.readUInt32LE(4) !== 1) {
    throw new Error('not a wasm 1.0 binary');
  }
  const sections = [];
  let pos = 8;
  while (pos < buf.length) {
    const start = pos;
    const id = buf[pos];
    let size;
    [size, pos] = readLeb(buf, pos + 1);
    const body = pos;
    pos += size;
    if (pos > buf.length) throw new Error(`section ${id} at byte ${start} runs past the end of the file`);
    const section = { id, start, body, end: pos, bytes: pos - start, name: null };
    if (id === 0) [section.name] = readName(buf, body);
    sections.push(section);
  }
  return sections;
}

function parseImports(buf, section) {
  const imports = [];
  let pos = section.body;
  let count;
  [count, pos] = readLeb(buf, pos);
  for (let i = 0; i < count; i++) {
    let module;
    let field;
    [module, pos] = readName(buf, pos);
    [field, pos] = readName(buf, pos);
    const kind = buf[pos++];
    if (kind === 0) pos = skipLeb(buf, pos);
    else if (kind === 1) pos = skipLimits(buf, pos + 1);
    else if (kind === 2) pos = skipLimits(buf, pos);
    else if (kind === 3) pos += 2;
    else if (kind === 4) pos = skipLeb(buf, pos + 1);
    else throw new Error(`import ${module}.${field} has unknown kind ${kind}`);
    imports.push({ module, field, kind });
  }
  return imports;
}

function parseExports(buf, section) {
  const exports = [];
  let pos = section.body;
  let count;
  [count, pos] = readLeb(buf, pos);
  for (let i = 0; i < count; i++) {
    let name;
    [name, pos] = readName(buf, pos);
    const kind = buf[pos++];
    pos = skipLeb(buf, pos);
    exports.push({ name, kind });
  }
  return exports;
}

function parseFunctionNames(buf, section) {
  const names = new Map();
  const [, first] = readName(buf, section.body);
  let pos = first;
  while (pos < section.end) {
    const id = buf[pos];
    let size;
    [size, pos] = readLeb(buf, pos + 1);
    const sub = pos;
    pos += size;
    if (id !== 1) continue;
    let count;
    let p = sub;
    [count, p] = readLeb(buf, p);
    for (let i = 0; i < count; i++) {
      let index;
      let name;
      [index, p] = readLeb(buf, p);
      [name, p] = readName(buf, p);
      names.set(index, name);
    }
  }
  return names;
}

function strip(buf, sections) {
  const parts = [buf.subarray(0, 8)];
  for (const section of sections) if (section.id !== 0) parts.push(buf.subarray(section.start, section.end));
  return Buffer.concat(parts);
}

function gzipFile(path) {
  return new Promise((done, fail) => {
    const child = spawn('gzip', ['-9', '-c', path], { stdio: ['ignore', 'pipe', 'pipe'], timeout: GZIP_TIMEOUT_MS });
    const chunks = [];
    const errors = [];
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.stderr.on('data', (chunk) => errors.push(chunk));
    child.on('error', fail);
    child.on('close', (code, signal) => {
      if (code === 0) done(Buffer.concat(chunks));
      else fail(new Error(`gzip -9 exited ${code ?? signal}: ${Buffer.concat(errors).toString('utf8').trim()}`));
    });
  });
}

async function gzipNamed(data, name) {
  const dir = mkdtempSync(join(tmpdir(), 'measure-txiki-wasm-'));
  try {
    const path = join(dir, name);
    writeFileSync(path, data);
    return await gzipFile(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function familyEvidence(candidates) {
  return FAMILIES.map(([family, patterns]) => {
    const hits = [...candidates].filter((text) => patterns.some((pattern) => pattern.test(text)));
    return `  ${family}: ${hits.length} matching names${hits.length ? ` (e.g. ${hits.slice(0, 3).join(', ')})` : ''}`;
  });
}

async function measure(path) {
  const buf = readFileSync(path);
  const sections = parseSections(buf);
  const byId = new Map();
  for (const section of sections) {
    const row = byId.get(section.id) ?? { count: 0, bytes: 0 };
    row.count += 1;
    row.bytes += section.bytes;
    byId.set(section.id, row);
  }
  const customs = sections.filter((section) => section.id === 0);
  const debug = customs.filter((section) => isDebugSection(section.name));
  const debugBytes = debug.reduce((sum, section) => sum + section.bytes, 0);
  const importSection = sections.find((section) => section.id === 2);
  const exportSection = sections.find((section) => section.id === 7);
  const imports = importSection ? parseImports(buf, importSection) : [];
  const exports = exportSection ? parseExports(buf, exportSection) : [];
  const nameSection = customs.find((section) => section.name === 'name');
  const functionNames = nameSection ? parseFunctionNames(buf, nameSection) : new Map();
  const stripped = strip(buf, sections);
  const gzRaw = await gzipFile(path);
  const gzStripped = await gzipNamed(stripped, basename(path));
  const strings = (buf.toString('latin1').match(/[\x20-\x7e]{6,}/g) ?? []).filter((text) => text.length <= 80);
  const candidates = new Set([...strings, ...functionNames.values(), ...exports.map((entry) => entry.name), ...imports.map((entry) => entry.field)]);
  const importModules = new Map();
  for (const entry of imports) importModules.set(entry.module, (importModules.get(entry.module) ?? 0) + 1);

  const lines = [];
  lines.push(`file: ${path}`);
  lines.push(`raw bytes: ${buf.length}`);
  lines.push(`sha256: ${createHash('sha256').update(buf).digest('hex')}`);
  lines.push(`sections: ${[...byId].sort((a, b) => a[0] - b[0]).map(([id, row]) => `${SECTION_NAMES[id] ?? id}=${row.count}/${row.bytes}B`).join(' ')}`);
  lines.push(`custom sections: ${customs.length ? customs.map((section) => `${section.name}=${section.bytes}B`).join(' ') : 'none'}`);
  lines.push(`debug sections (.debug*, name, sourceMappingURL): ${debug.length} sections, ${debugBytes} bytes`);
  lines.push(`name section (function names): ${nameSection ? `yes, ${functionNames.size} names` : 'no'}`);
  lines.push(`imports: ${imports.length} (${[...importModules].map(([module, count]) => `${module}=${count}`).join(' ') || 'none'})`);
  lines.push(`exports: ${exports.length}`);
  lines.push(`families (names found in strings, imports, exports or the name section):`);
  lines.push(...familyEvidence(candidates));
  lines.push(`stripped (all custom sections removed) bytes: ${stripped.length}`);
  lines.push(`gzip -9 raw bytes (gzip -9 <file>, name stored): ${gzRaw.length}`);
  lines.push(`gzip -9 stripped bytes (same method on the stripped copy): ${gzStripped.length}`);
  return lines;
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('usage: node scripts/measure-txiki-wasm.mjs <file.wasm> [more.wasm ...]');
  process.exit(2);
}
for (const file of files) {
  console.log((await measure(resolve(file))).join('\n'));
  console.log('');
}
