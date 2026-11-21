#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PINS = JSON.parse(readFileSync(join(HERE, 'pins.json'), 'utf8'));
const SELECT = PINS.selections;
const PATCH_DIR = join(HERE, 'patches');
const EXTRAS_DIR = join(HERE, 'extras');
const MANIFEST = 'MANIFEST.sha256';
const GENERATED = ['txiki', 'libuv', 'quickjs', ...new Set(PINS.extras.map((entry) => entry.to.split('/')[0])), 'VERSION.txt', MANIFEST];
const LICENSE_NAME = /^(LICENSE|LICENSE-.*|COPYING)(\.txt|\.md)?$/i;
const TEXT_SOURCE = /\.(c|h|cpp|hpp|txt|md|in|ac)$|^LICENSE/i;
const ASCII_FOR = new Map(
  [[0xe1, 'a'], [0xe9, 'e'], [0xed, 'i'], [0xf3, 'o'], [0xfa, 'u'], [0xf1, 'n'], [0xfc, 'u'], [0xf6, 'o'], [0xe4, 'a'], [0xa9, '(c)'], [0x2014, '-'], [0x2013, '-'], [0x2192, '->'], [0x2190, '<-'], [0x2018, "'"], [0x2019, "'"], [0x201c, '"'], [0x201d, '"'], [0x2026, '...'], [0xd7, 'x'], [0x2265, '>='], [0x2264, '<='], [0x2260, '!='], [0xa0, ' '], [0xb5, 'u'], [0x2022, '*']].map(([codePoint, ascii]) => [String.fromCodePoint(codePoint), ascii]),
);

const options = (() => {
  const given = process.argv.slice(2);
  const valueOf = (flag) => given[given.indexOf(flag) + 1];
  return {
    target: resolve(given.includes('--target') ? valueOf('--target') : join(HERE, '..', '..', 'native', 'third_party', 'txiki')),
    glue: given.includes('--glue') ? resolve(valueOf('--glue')) : null,
    browser: given.includes('--browser'),
    verify: given.includes('--verify'),
    extras: given.includes('--extras') ? resolve(valueOf('--extras')) : null,
  };
})();

const sha256Of = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const mustMatch = (what, digest, pin) => {
  if (digest !== pin) throw new Error(what + ' sha256 ' + digest + ' does not match the pin ' + pin);
};
const run = (command, args) => {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 600000 });
  if (result.status !== 0) throw new Error(command + ' ' + args.join(' ') + ' failed: ' + (result.error?.message ?? result.stderr));
};
const filesUnder = (dir) => readdirSync(dir, { recursive: true }).map(String).filter((name) => statSync(join(dir, name)).isFile()).map((name) => name.split(sep).join('/')).sort();
const withoutComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const asciiOf = (text) => text.replace(/[^\x00-\x7f]/gu, (character) => ASCII_FOR.get(character) ?? '?');

function asciiCopy(from, to) {
  mkdirSync(dirname(to), { recursive: true });
  const original = readFileSync(from, 'utf8');
  if (!/[^\x00-\x7f]/.test(original)) {
    cpSync(from, to);
    return 0;
  }
  if (/\.(c|h|cpp|hpp)$/.test(from) && /[^\x00-\x7f]/.test(withoutComments(original))) throw new Error(from + ' has a non-ASCII character outside a comment; it cannot be normalized safely');
  writeFileSync(to, asciiOf(original));
  return original.match(/[^\x00-\x7f]/gu).length;
}

function copyTree(from, to, keep) {
  const counts = { files: 0, replaced: 0 };
  for (const name of filesUnder(from)) {
    if (!keep(name)) continue;
    counts.replaced += TEXT_SOURCE.test(name) ? asciiCopy(join(from, name), join(to, name)) : (cpSync(join(from, name), join(to, name)), 0);
    counts.files += 1;
  }
  return counts;
}

const topLevel = (name) => !name.includes('/');
const manifestLines = (target) => filesUnder(target).filter((name) => name !== MANIFEST).map((name) => sha256Of(join(target, name)) + '  ' + name);

function verify(target) {
  const recorded = readFileSync(join(target, MANIFEST), 'utf8').trim().split('\n');
  const actual = new Set(manifestLines(target));
  const wanted = new Set(recorded);
  const problems = [...wanted].filter((line) => !actual.has(line)).map((line) => 'changed or missing: ' + line.slice(66))
    .concat([...actual].filter((line) => !wanted.has(line)).map((line) => 'not in the manifest: ' + line.slice(66)));
  for (const patch of PINS.patches) mustMatch('patch ' + patch.file, sha256Of(join(PATCH_DIR, patch.file)), patch.sha256);
  if (problems.length > 0) throw new Error(problems.slice(0, 20).join('\n'));
  console.log('vendor-txiki: ' + recorded.length + ' files under ' + target + ' match ' + MANIFEST);
}

function download(work) {
  const trees = {};
  for (const pin of PINS.archives) {
    const archive = join(work, pin.name + '.tar.gz');
    run('curl', ['-sSL', '--fail', '--max-time', '300', '-o', archive, pin.url]);
    mustMatch(pin.url, sha256Of(archive), pin.sha256);
    trees[pin.name] = join(work, pin.name);
    mkdirSync(trees[pin.name]);
    run('tar', ['-xzf', archive, '-C', trees[pin.name], '--strip-components=1']);
  }
  return trees;
}

function copyAll(trees, target) {
  const total = { files: 0, replaced: 0 };
  const add = ({ files, replaced }) => {
    total.files += files;
    total.replaced += replaced;
  };
  const src = join(trees.txiki, 'src');
  const skipped = new Set(SELECT.txikiHeadersSkipped);
  add(copyTree(src, join(target, 'txiki', 'src'), (name) => topLevel(name) && ((name.endsWith('.h') && !skipped.has(name)) || SELECT.txikiSources.includes(name))));
  add(copyTree(join(src, 'bundles', 'c'), join(target, 'txiki', 'src', 'bundles', 'c'), (name) => SELECT.txikiBundles.includes(name)));
  add(copyTree(join(trees.txiki, 'deps', 'ada'), join(target, 'txiki', 'deps', 'ada'), (name) => SELECT.adaFiles.includes(name) || LICENSE_NAME.test(name)));
  add(copyTree(trees.txiki, join(target, 'txiki'), (name) => name === 'LICENSE'));
  const version = PINS.txikiVersion;
  const header = readFileSync(join(src, 'version.h.in'), 'utf8')
    .replace('@TJS__VERSION_MAJOR@', version.major).replace('@TJS__VERSION_MINOR@', version.minor)
    .replace('@TJS__VERSION_PATCH@', version.patch).replace('@TJS__VERSION_SUFFIX@', version.suffix);
  if (/@TJS__\w+@/.test(header)) throw new Error('version.h.in has a placeholder this tool does not fill');
  writeFileSync(join(target, 'txiki', 'src', 'version.h'), asciiOf(header));
  total.files += 1;
  add(copyTree(trees.libuv, join(target, 'libuv'), (name) => name.startsWith('include/') || name.startsWith('src/') || (topLevel(name) && (LICENSE_NAME.test(name) || SELECT.libuvBuildFiles.includes(name)))));
  const quickjsSkipped = new Set(SELECT.quickjsHeadersSkipped);
  add(copyTree(trees.quickjs, join(target, 'quickjs'), (name) => topLevel(name) && (SELECT.quickjsSources.includes(name) || (name.endsWith('.h') && !quickjsSkipped.has(name)) || LICENSE_NAME.test(name))));
  for (const entry of PINS.extras) {
    const wanted = (name) => entry.files?.includes(name) || (entry.match !== undefined && new RegExp(entry.match).test(name));
    add(copyTree(join(trees[entry.archive], entry.from), join(target, entry.to), (name) => topLevel(name) && wanted(name)));
  }
  for (const source of SELECT.txikiSources) if (!existsSync(join(target, 'txiki', 'src', source))) throw new Error('the txiki archive has no src/' + source);
  for (const bundle of SELECT.txikiBundles) if (!existsSync(join(target, 'txiki', 'src', 'bundles', 'c', bundle))) throw new Error('the txiki archive has no bundle ' + bundle);
  for (const source of SELECT.quickjsSources) if (!existsSync(join(target, 'quickjs', source))) throw new Error('the quickjs-ng archive has no ' + source);
  return total;
}

function applyPatches(target) {
  for (const patch of PINS.patches) {
    const file = join(PATCH_DIR, patch.file);
    mustMatch('patch ' + patch.file, sha256Of(file), patch.sha256);
    run('patch', ['-p1', '-d', target, '-i', file, '--quiet', '--no-backup-if-mismatch']);
  }
}

function generateStubs(target) {
  if (options.glue === null) throw new Error('--browser needs --glue <the C file that already defines some stub symbols>');
  for (const entry of PINS.browserPort) mustMatch('browser/' + entry.file, sha256Of(join(target, 'browser', entry.file)), entry.sha256);
  run(process.execPath, [join(HERE, 'browser-stubs.mjs'), '--target', target, '--glue', options.glue]);
}

function versionText(counts, target) {
  const stubs = options.browser ? ['browser stubs: browser/stubs.c is generated by browser-stubs.mjs from browser/stubs.tsv, sha256: ' + sha256Of(join(target, 'browser', 'stubs.c'))] : [];
  return [
    ...PINS.archives.flatMap((pin) => [pin.name + ': ' + pin.label, 'url: ' + pin.url, 'sha256: ' + pin.sha256]),
    ...PINS.patches.map((patch) => 'patch: tools/txiki/patches/' + patch.file + ', sha256: ' + patch.sha256),
    ...(options.browser ? PINS.browserPort.map((entry) => 'browser port: ' + entry.origin + ', copied to browser/' + entry.file + ', sha256: ' + entry.sha256) : []),
    ...stubs,
    'written by: node tools/txiki/vendor.mjs (downloads each archive, checks its sha256, copies the selections in tools/txiki/pins.json, applies the patches, writes ' + MANIFEST + ')',
    'txiki files: src/*.h except ' + SELECT.txikiHeadersSkipped.join(', ') + '; src/{' + SELECT.txikiSources.join(', ') + '}; src/bundles/c/{' + SELECT.txikiBundles.join(', ') + '}; deps/ada/{' + SELECT.adaFiles.join(', ') + '}; LICENSE; src/version.h is version.h.in with ' + PINS.txikiVersion.major + '.' + PINS.txikiVersion.minor + '.' + PINS.txikiVersion.patch + ' filled in.',
    'txiki files left out: the modules that need libwebsockets, mbedtls, wamr, libffi, sqlite3, miniz or mimalloc (httpclient, httpserver, ws, tls, webcrypto, hashing, wasm, ffi, sqlite3, miniz), the CLI, and the JavaScript sources of the bundles. The host answers their entry points.',
    ...PINS.extras.map((entry) => 'extra files: ' + entry.archive + '/' + entry.from + ' to ' + entry.to + ': ' + (entry.files ? entry.files.join(', ') : 'every file matching ' + entry.match)),
    'libuv files: include/, src/, CMakeLists.txt, configure.ac (the build file reads the version from it), the two .pc.in files it configures, and the licence files.',
    'quickjs-ng files: ' + SELECT.quickjsSources.join(', ') + ', every top-level header except ' + SELECT.quickjsHeadersSkipped.join(', ') + ', and LICENSE.',
    'ASCII-normalized: ' + counts.replaced + ' non-ASCII characters in comments and licence text are written as plain ASCII. The tool refuses a non-ASCII character outside a comment in a source file, so no code changed.',
    '',
  ].join('\n');
}

function copyHostExtras(to) {
  mkdirSync(to, { recursive: true });
  for (const entry of PINS.hostExtras) {
    mustMatch('extras/' + entry.file, sha256Of(join(EXTRAS_DIR, entry.file)), entry.sha256);
    cpSync(join(EXTRAS_DIR, entry.file), join(to, entry.file));
  }
  console.log('vendor-txiki: wrote ' + PINS.hostExtras.length + ' host extras under ' + relative(process.cwd(), to));
}

if (options.extras) {
  copyHostExtras(options.extras);
} else if (options.verify) {
  verify(options.target);
} else {
  for (const patch of PINS.patches) mustMatch('patch ' + patch.file, sha256Of(join(PATCH_DIR, patch.file)), patch.sha256);
  const work = mkdtempSync(join(tmpdir(), 'txiki-vendor-'));
  try {
    const trees = download(work);
    for (const generated of GENERATED) rmSync(join(options.target, generated), { recursive: true, force: true });
    const counts = copyAll(trees, options.target);
    applyPatches(options.target);
    if (options.browser) generateStubs(options.target);
    writeFileSync(join(options.target, 'VERSION.txt'), versionText(counts, options.target));
    writeFileSync(join(options.target, MANIFEST), manifestLines(options.target).join('\n') + '\n');
    console.log('vendor-txiki: wrote ' + filesUnder(options.target).length + ' files under ' + relative(process.cwd(), options.target) + '; ' + counts.replaced + ' non-ASCII characters normalized');
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
