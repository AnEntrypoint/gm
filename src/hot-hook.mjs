import { RELOADABLE } from './hot-config.mjs';

const SRC = new URL('./', import.meta.url).href;
const reloadable = new Set(RELOADABLE);
let generation = null;

export function initialize(data) {
  generation = new Int32Array(data.generation);
}

export async function resolve(specifier, context, nextResolve) {
  const result = await nextResolve(specifier, context);
  if (generation === null || !result.url.startsWith(SRC)) return result;
  if (!reloadable.has(result.url.slice(SRC.length))) return result;
  const gen = Atomics.load(generation, 0);
  if (gen === 0) return result;
  return { ...result, url: `${result.url}?gen=${gen}`, shortCircuit: true };
}
