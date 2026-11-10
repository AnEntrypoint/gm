#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TOOL = 'vendor-txiki';
const TARGET = join(root, 'native', 'third_party', 'txiki');

const PINS = [
  { name: 'txiki', label: 'txiki.js v26.11.0', url: 'https://codeload.github.com/saghul/txiki.js/legacy.tar.gz/refs/tags/v26.11.0', sha256: '763025ac98e4d6629f9ebe8396c027ff22966a6322b0dc43e442d45c6d7f8059' },
  { name: 'libuv', label: 'libuv dd9f081cc55a4d83e2a976848d074f28ee5f34eb', url: 'https://codeload.github.com/libuv/libuv/legacy.tar.gz/dd9f081cc55a4d83e2a976848d074f28ee5f34eb', sha256: 'f5185440ee939936d6375755498b7f07915f747bd9bbfe6ea058a9ee173f88d0' },
  { name: 'quickjs', label: 'quickjs-ng 7b5f588e0f9b643e2996f291bfc861abeaceddc2', url: 'https://codeload.github.com/quickjs-ng/quickjs/legacy.tar.gz/7b5f588e0f9b643e2996f291bfc861abeaceddc2', sha256: 'f27b2e93647e73f91201e12c4f2ee0c0d07e2f6dc06b539422bf03269d601366' },
];
const TXIKI_VERSION = { major: '26', minor: '11', patch: '0', suffix: '' };

const TXIKI_SOURCES = [
  'vm.c', 'timers.c', 'utils.c', 'modules.c', 'error.c', 'mem.c', 'text-coding.c', 'tbuf.c', 'builtins.c', 'signals.c',
  'mod_os.c', 'mod_sys.c', 'mod_fs.c', 'mod_streams.c', 'worker.c', 'eval.c', 'url.c', 'mod_engine.c', 'version.c',
  'mod_channel.c', 'mod_dns.c', 'mod_fswatch.c', 'mod_process.c', 'mod_udp.c', 'mod_posix-socket.c',
];
const TXIKI_HEADERS_SKIPPED = new Set(['cacert.h', 'ed25519.h', 'mbedtls_config.h', 'wasm.h']);
const TXIKI_BUNDLES = ['core/core.c', 'core/polyfills.c', 'core/run-main.c', 'core/worker-bootstrap.c', 'internal/home.c', 'internal/path.c', 'stdlib/assert.c', 'stdlib/getopts.c', 'stdlib/hashing.c', 'stdlib/ipaddr.c', 'stdlib/path.c', 'stdlib/posix-socket.c', 'stdlib/readline.c', 'stdlib/utils.c', 'stdlib/uuid.c'];
const LIBUV_BUILD_FILES = new Set(['CMakeLists.txt', 'libuv.pc.in', 'libuv-static.pc.in']);
const ADA_FILES = ['ada.cpp', 'ada.h', 'ada_c.h'];
const QUICKJS_SOURCES = ['quickjs.c', 'dtoa.c', 'libregexp.c', 'libunicode.c'];
const QUICKJS_HEADERS_SKIPPED = new Set(['quickjs-libc.h']);
const LICENSE_NAME = /^(LICENSE|LICENSE-.*|COPYING)(\.txt|\.md)?$/i;
const TEXT_SOURCE = /\.(c|h|cpp|hpp|txt|md|in)$|^LICENSE/i;
const ASCII_FOR = new Map(
  [[0xe1, 'a'], [0xe9, 'e'], [0xed, 'i'], [0xf3, 'o'], [0xfa, 'u'], [0xf1, 'n'], [0xfc, 'u'], [0xf6, 'o'], [0xe4, 'a'], [0xa9, '(c)'], [0x2014, '-'], [0x2013, '-'], [0x2192, '->'], [0x2190, '<-'], [0x2018, "'"], [0x2019, "'"], [0x201c, '"'], [0x201d, '"'], [0x2026, '...'], [0xd7, 'x'], [0x2265, '>='], [0x2264, '<='], [0x2260, '!='], [0xa0, ' '], [0xb5, 'u'], [0x2022, '*']].map(([codePoint, ascii]) => [String.fromCodePoint(codePoint), ascii]),
);

const sha256Of = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const run = (command, args) => {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 600000 });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed: ${result.error?.message ?? result.stderr}`);
};

function withoutComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

function asciiCopy(from, to) {
  mkdirSync(dirname(to), { recursive: true });
  const original = readFileSync(from, 'utf8');
  if (!/[^\x00-\x7f]/.test(original)) {
    cpSync(from, to);
    return 0;
  }
  const isCode = /\.(c|h|cpp|hpp)$/.test(from);
  if (isCode && /[^\x00-\x7f]/.test(withoutComments(original))) throw new Error(`${from} has a non-ASCII character outside a comment; it cannot be normalized safely`);
  let replaced = 0;
  const text = original.replace(/[^\x00-\x7f]/gu, (character) => {
    replaced += 1;
    return ASCII_FOR.get(character) ?? '?';
  });
  writeFileSync(to, text);
  return replaced;
}

function copyTree(from, to, keep) {
  let files = 0;
  let replaced = 0;
  for (const entry of readdirSync(from, { recursive: true })) {
    const relative = String(entry);
    const source = join(from, relative);
    if (!statSync(source).isFile() || !keep(relative)) continue;
    replaced += TEXT_SOURCE.test(relative) ? asciiCopy(source, join(to, relative)) : (cpSync(source, join(to, relative), { recursive: true }), 0);
    files += 1;
  }
  return { files, replaced };
}

const work = mkdtempSync(join(tmpdir(), 'gm-vendor-txiki-'));
try {
  const trees = {};
  for (const pin of PINS) {
    const archive = join(work, `${pin.name}.tar.gz`);
    run('curl', ['-sSL', '--fail', '--max-time', '300', '-o', archive, pin.url]);
    const digest = sha256Of(archive);
    if (digest !== pin.sha256) throw new Error(`${pin.url} sha256 ${digest} does not match the pin ${pin.sha256}`);
    trees[pin.name] = join(work, pin.name);
    mkdirSync(trees[pin.name]);
    run('tar', ['-xzf', archive, '-C', trees[pin.name], '--strip-components=1']);
  }

  rmSync(TARGET, { recursive: true, force: true });
  const counts = { files: 0, replaced: 0 };
  const add = ({ files, replaced }) => {
    counts.files += files;
    counts.replaced += replaced;
  };
  const txikiSrc = join(trees.txiki, 'src');
  add(copyTree(txikiSrc, join(TARGET, 'txiki', 'src'), (relative) => !relative.includes('/') && ((relative.endsWith('.h') && !TXIKI_HEADERS_SKIPPED.has(relative)) || TXIKI_SOURCES.includes(relative))));
  add(copyTree(join(txikiSrc, 'bundles', 'c'), join(TARGET, 'txiki', 'src', 'bundles', 'c'), (relative) => TXIKI_BUNDLES.includes(relative)));
  add(copyTree(join(trees.txiki, 'deps', 'ada'), join(TARGET, 'txiki', 'deps', 'ada'), (relative) => ADA_FILES.includes(relative) || LICENSE_NAME.test(relative)));
  add(copyTree(trees.txiki, join(TARGET, 'txiki'), (relative) => relative === 'LICENSE'));
  const versionHeader = readFileSync(join(txikiSrc, 'version.h.in'), 'utf8')
    .replace('@TJS__VERSION_MAJOR@', TXIKI_VERSION.major)
    .replace('@TJS__VERSION_MINOR@', TXIKI_VERSION.minor)
    .replace('@TJS__VERSION_PATCH@', TXIKI_VERSION.patch)
    .replace('@TJS__VERSION_SUFFIX@', TXIKI_VERSION.suffix);
  if (/@TJS__\w+@/.test(versionHeader)) throw new Error('version.h.in has a placeholder this tool does not fill');
  writeFileSync(join(TARGET, 'txiki', 'src', 'version.h'), versionHeader.replace(/[^\x00-\x7f]/gu, (character) => ASCII_FOR.get(character) ?? '?'));
  counts.files += 1;

  add(copyTree(trees.libuv, join(TARGET, 'libuv'), (relative) => relative.startsWith('include/') || relative.startsWith('src/') || (!relative.includes('/') && (LICENSE_NAME.test(relative) || LIBUV_BUILD_FILES.has(relative)))));
  add(copyTree(trees.quickjs, join(TARGET, 'quickjs'), (relative) => !relative.includes('/') && (QUICKJS_SOURCES.includes(relative) || (relative.endsWith('.h') && !QUICKJS_HEADERS_SKIPPED.has(relative)) || LICENSE_NAME.test(relative))));

  for (const source of TXIKI_SOURCES) if (!existsSync(join(TARGET, 'txiki', 'src', source))) throw new Error(`the txiki archive has no src/${source}`);
  for (const bundle of TXIKI_BUNDLES) if (!existsSync(join(TARGET, 'txiki', 'src', 'bundles', 'c', bundle))) throw new Error(`the txiki archive has no bundle ${bundle}`);
  for (const source of QUICKJS_SOURCES) if (!existsSync(join(TARGET, 'quickjs', source))) throw new Error(`the quickjs-ng archive has no ${source}`);

  writeFileSync(
    join(TARGET, 'VERSION.txt'),
    [
      ...PINS.flatMap((pin) => [`${pin.name}: ${pin.label}`, `url: ${pin.url}`, `sha256: ${pin.sha256}`]),
      'written by: node tools/vendor-txiki.mjs (downloads each archive, checks its sha256, copies the files below)',
      `txiki files: src/*.h except ${[...TXIKI_HEADERS_SKIPPED].join(', ')}; src/{${TXIKI_SOURCES.join(', ')}}; src/bundles/c/{${TXIKI_BUNDLES.join(', ')}}; deps/ada/{${ADA_FILES.join(', ')}}; LICENSE; src/version.h is version.h.in with ${TXIKI_VERSION.major}.${TXIKI_VERSION.minor}.${TXIKI_VERSION.patch} filled in.`,
      'txiki files left out: the modules that need libwebsockets, mbedtls, wamr, libffi, sqlite3, miniz or mimalloc (httpclient, httpserver, ws, tls, webcrypto, hashing, wasm, ffi, sqlite3, miniz), the CLI, and the JavaScript sources of the bundles. native/components/quickjs/txiki_stubs.c answers their entry points.',
      'libuv files: include/, src/, CMakeLists.txt, the two .pc.in files it configures, and the licence files.',
      `quickjs-ng files: ${QUICKJS_SOURCES.join(', ')}, every top-level header except quickjs-libc.h, and LICENSE.`,
      `ASCII-normalized: ${counts.replaced} non-ASCII characters in comments and licence text are written as plain ASCII (accented letters without the accent, dashes as -, arrows as ->, the copyright sign as (c), anything else as ?). The tool refuses a non-ASCII character outside a comment in a source file, so no code changed.`,
      '',
    ].join('\n'),
  );
  console.log(`${TOOL}: wrote ${counts.files + 1} files under native/third_party/txiki; ${counts.replaced} non-ASCII characters normalized; pins ${PINS.map((pin) => `${pin.name} ${pin.sha256.slice(0, 12)}`).join(', ')}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
