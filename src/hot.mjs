import { register } from 'node:module';

const shared = new SharedArrayBuffer(4);
const counter = new Int32Array(shared);
register('./hot-hook.mjs', import.meta.url, { data: { generation: shared } });

export function bumpGeneration() {
  return Atomics.add(counter, 0, 1) + 1;
}
