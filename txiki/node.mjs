import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openTxiki } from './host.mjs';
import { resolvePath } from './project.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const thebird = '/workspace/thebird';
const entry = args[0];
const root = resolve(flag('--root', process.cwd()));
const wasmPath = resolve(flag('--wasm', thebird + '/web/vendor/txiki/tjs.wasm'));
const pinPath = resolve(flag('--pin', thebird + '/scripts/txiki/pin.json'));
const timeoutMs = Number(flag('--timeout-ms', '120000'));
const allowUnpinned = args.includes('--allow-unpinned');

const pin = JSON.parse(readFileSync(pinPath, 'utf8')).tjsWasmSha256;
if (!/^[0-9a-f]{64}$/.test(pin ?? '')) throw new Error('no tjsWasmSha256 in ' + pinPath);
const wasm = readFileSync(wasmPath);
const digest = createHash('sha256').update(wasm).digest('hex');
if (digest !== pin && !allowUnpinned) throw new Error('tjs.wasm sha256 ' + digest + ' does not match the pin ' + pin + ' in ' + pinPath);

const { createWasi } = await import(pathToFileURL(resolve(thebird, 'web', 'shims', 'wasi-preview1.js')).href);
const project = {
  stat(path) {
    const info = statSync(join(root, path), { throwIfNoEntry: false });
    return info === undefined ? null : { dir: info.isDirectory(), size: info.size, mtimeMs: info.mtimeMs };
  },
  bytes(path) {
    return new Uint8Array(readFileSync(join(root, path)));
  },
  names(path) {
    try {
      return readdirSync(join(root, path));
    } catch {
      return null;
    }
  },
};
const entryPath = resolvePath(relative(root, resolve(root, entry)).split(sep).join('/'));
const source = new TextDecoder().decode(project.bytes(entryPath));
const txiki = await openTxiki({ wasm, createWasi, project });
const started = Date.now();
const result = await txiki.run(source, { timeoutMs, name: entryPath });
console.log(JSON.stringify({ engine: 'thebird-txiki', wasmSha256: digest, pin, pinned: digest === pin, stubbed: txiki.stubbed, ms: Date.now() - started, ...result }, null, 2));
process.exitCode = result.status === 0 ? 0 : 1;
