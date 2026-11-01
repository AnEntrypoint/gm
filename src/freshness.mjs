// A resolve hook for run_code. Every project file a body loads gets a query that holds the current generation, a counter that run_code
// bumps at the start of each call. Node caches ES modules by URL, so without this a later call would reuse the modules of an earlier
// one, including a file that imports an edited file. With a new generation each call, every call loads the project as it is on disk.
// Files under node_modules are left alone. The hook runs on Node's loader thread; its root and the shared counter come from the data
// passed to module.register in runcode.mjs.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isAbsolute, relative, sep } from 'node:path';

let root = null;
let generation = null;

export function initialize(data) {
  root = data.root;
  generation = new Int32Array(data.buffer);
}

export async function resolve(specifier, context, nextResolve) {
  const result = await nextResolve(specifier, context);
  if (root === null || !result.url.startsWith('file:')) return result;
  const [base] = result.url.split('?');
  const path = fileURLToPath(base);
  const rel = relative(root, path);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return result;
  if (rel.split(sep).includes('node_modules') || !existsSync(path)) return result;
  return { ...result, url: `${base}?g=${Atomics.load(generation, 0)}` };
}
