import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { bundle } from './bundle.mjs';
import { openTxiki } from './host.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const thebird = '/workspace/thebird';
const entry = args[0];
const root = resolve(flag('--root', process.cwd()));
const wasmPath = resolve(flag('--wasm', thebird + '/web/vendor/txiki/tjs.wasm'));
const pinPath = resolve(flag('--pin', thebird + '/scripts/vendor-txiki.mjs'));
const timeoutMs = Number(flag('--timeout-ms', '120000'));
const allowUnpinned = args.includes('--allow-unpinned');

const pin = /export const TXIKI_WASM_SHA256 = '([0-9a-f]{64})'/.exec(readFileSync(pinPath, 'utf8'))?.[1];
if (pin === undefined) throw new Error('no TXIKI_WASM_SHA256 in ' + pinPath);
const wasm = readFileSync(wasmPath);
const digest = createHash('sha256').update(wasm).digest('hex');
if (digest !== pin && !allowUnpinned) throw new Error('tjs.wasm sha256 ' + digest + ' does not match the pin ' + pin + ' in ' + pinPath);

const { createWasi } = await import(pathToFileURL(resolve(pinPath, '..', '..', 'web', 'shims', 'wasi-preview1.js')).href);
const read = (path) => {
  try {
    return readFileSync(resolve(root, '.' + path), 'utf8');
  } catch {
    return null;
  }
};
const entryPath = '/' + relative(root, resolve(root, entry)).split(sep).join('/');
const source = bundle(entryPath, read);
const txiki = await openTxiki({ wasm, createWasi });
const started = Date.now();
const result = await txiki.run(source, { timeoutMs });
console.log(JSON.stringify({ engine: 'thebird-txiki', wasmSha256: digest, pin, pinned: digest === pin, stubbed: txiki.stubbed, ms: Date.now() - started, ...result }, null, 2));
process.exitCode = result.status === 0 ? 0 : 1;
