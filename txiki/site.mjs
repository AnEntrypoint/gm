import { bundle } from './bundle.mjs';
import { openTxiki } from './host.mjs';
import { createWasi } from './shims/wasi-preview1.js';

const hex = (buffer) => [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
const show = (value) => {
  document.querySelector('#result').textContent = JSON.stringify(value, null, 2);
};

try {
  const [pin, project, wasm] = await Promise.all([
    fetch('./pin.json').then((response) => response.json()),
    fetch('./project.json').then((response) => response.json()),
    fetch('./tjs.wasm').then((response) => response.arrayBuffer()),
  ]);
  const digest = hex(await crypto.subtle.digest('SHA-256', wasm));
  const pinned = digest === pin.pin;
  if (!pinned && !pin.allowUnpinned) {
    show({ refused: true, wasmSha256: digest, pin: pin.pin });
    document.body.dataset.state = 'refused';
  } else {
    const source = bundle(project.entry, (path) => project.files[path] ?? null);
    const txiki = await openTxiki({ wasm, createWasi });
    const started = performance.now();
    const result = await txiki.run(source, { timeoutMs: project.timeoutMs });
    show({ wasmSha256: digest, pinned, stubbed: txiki.stubbed, ms: Math.round(performance.now() - started), ...result });
    document.body.dataset.state = 'done';
  }
} catch (error) {
  show({ error: String(error && error.stack ? error.stack : error) });
  document.body.dataset.state = 'error';
}
