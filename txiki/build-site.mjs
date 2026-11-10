import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = resolve(here, '..');
const args = process.argv.slice(2);
const flag = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const thebird = '/workspace/thebird';
const root = resolve(flag('--root', repo));
const entry = resolve(root, flag('--entry', 'index.mjs'));
const out = resolve(flag('--out', join(repo, 'build', 'txiki-site')));
const wasmPath = resolve(flag('--wasm', thebird + '/web/vendor/txiki/tjs.wasm'));
const pinPath = resolve(flag('--pin', thebird + '/scripts/vendor-txiki.mjs'));
const timeoutMs = Number(flag('--timeout-ms', '120000'));
const allowUnpinned = args.includes('--allow-unpinned');

const pin = /export const TXIKI_WASM_SHA256 = '([0-9a-f]{64})'/.exec(readFileSync(pinPath, 'utf8'))?.[1];
if (pin === undefined) throw new Error('no TXIKI_WASM_SHA256 in ' + pinPath);
const digest = createHash('sha256').update(readFileSync(wasmPath)).digest('hex');
if (digest !== pin && !allowUnpinned) throw new Error('tjs.wasm sha256 ' + digest + ' does not match the pin ' + pin + ' in ' + pinPath);

const SKIP = new Set(['node_modules', '.git']);
const collect = (dir, files = {}) => {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(item.name)) continue;
    const path = join(dir, item.name);
    if (item.isDirectory()) collect(path, files);
    else if (/\.(mjs|js|json)$/.test(item.name)) files['/' + relative(root, path).split(sep).join('/')] = readFileSync(path, 'utf8');
  }
  return files;
};

mkdirSync(join(out, 'shims'), { recursive: true });
copyFileSync(wasmPath, join(out, 'tjs.wasm'));
copyFileSync(resolve(pinPath, '..', '..', 'web', 'shims', 'wasi-preview1.js'), join(out, 'shims', 'wasi-preview1.js'));
for (const name of ['host.mjs', 'bundle.mjs', 'site.mjs']) copyFileSync(join(here, name), join(out, name));
copyFileSync(join(here, 'site.html'), join(out, 'index.html'));
copyFileSync(join(repo, 'node_modules', 'acorn', 'dist', 'acorn.mjs'), join(out, 'acorn.mjs'));
const files = collect(root);
writeFileSync(join(out, 'project.json'), JSON.stringify({ entry: '/' + relative(root, entry).split(sep).join('/'), timeoutMs, files }));
writeFileSync(join(out, 'pin.json'), JSON.stringify({ pin, actual: digest, allowUnpinned }));
console.log(JSON.stringify({ out, pin, actual: digest, pinned: digest === pin, files: Object.keys(files).length }));
