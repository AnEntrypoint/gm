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
