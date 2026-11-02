// Registers the loader hook (src/hot-hook.mjs) and owns the generation counter it reads. The worker imports this module at boot, so the
// hook is in place before the first reload. Until a bump, every module loads at its plain URL, exactly as without the hook.
import { register } from 'node:module';

const shared = new SharedArrayBuffer(4);
const counter = new Int32Array(shared);
register('./hot-hook.mjs', import.meta.url, { data: { generation: shared } });

// Starts a new generation and returns its number. The next import of each reloadable module, from any module under src/, is a fresh instance.
export function bumpGeneration() {
  return Atomics.add(counter, 0, 1) + 1;
}
