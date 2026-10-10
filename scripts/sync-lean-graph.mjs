import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const authoredGraph = path.join(root, 'gm-config', 'fsm', 'graph.json');
const authoredProseDir = path.join(root, 'gm-config', 'prose');
const leanGraph = path.join(root, 'rs-plugkit', 'crates', 'plugkit-core', 'src', 'orchestrator', 'lean_graph.json');
const leanProseDir = path.join(root, 'rs-plugkit', 'crates', 'plugkit-core', 'src', 'orchestrator', 'instructions', 'prose');

const RS_PLUGKIT_COMPILED_PROSE = new Set(['entry.md', 'entry-extended.md']);

function sharedProse(dir) {
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md') && !RS_PLUGKIT_COMPILED_PROSE.has(f)).sort();
}

function sameBytes(a, b) {
  return fs.existsSync(a) && fs.existsSync(b) && fs.readFileSync(a).equals(fs.readFileSync(b));
}

function check() {
  const drift = [];
  if (!sameBytes(authoredGraph, leanGraph)) {
    drift.push('graph: rs-plugkit/.../lean_graph.json differs from gm-config/fsm/graph.json');
  }
  const authored = sharedProse(authoredProseDir);
  const lean = sharedProse(leanProseDir);
  for (const f of authored) {
    if (!lean.includes(f)) drift.push(`prose missing in rs-plugkit: ${f}`);
    else if (!sameBytes(path.join(authoredProseDir, f), path.join(leanProseDir, f))) drift.push(`prose differs: ${f}`);
  }
  for (const f of lean) {
    if (!authored.includes(f)) drift.push(`prose lean-only (no gm-config source): ${f}`);
  }
  for (const line of drift) console.log(`DRIFT ${line}`);
  console.log(drift.length === 0 ? `OK graph and ${authored.length} shared prose files match` : `FAIL ${drift.length} drift line(s)`);
  return drift.length === 0 ? 0 : 1;
}

function emit(outDir) {
  const proseOut = path.join(outDir, 'prose');
  fs.mkdirSync(proseOut, { recursive: true });
  fs.copyFileSync(authoredGraph, path.join(outDir, 'lean_graph.json'));
  const files = sharedProse(authoredProseDir);
  for (const f of files) fs.copyFileSync(path.join(authoredProseDir, f), path.join(proseOut, f));
  console.log(`EMIT graph + ${files.length} prose files -> ${outDir}`);
  return 0;
}

const [mode, arg] = process.argv.slice(2);
if (mode === 'check' || mode === undefined) process.exitCode = check();
else if (mode === 'emit' && arg) process.exitCode = emit(path.resolve(arg));
else {
  console.error('usage: sync-lean-graph.mjs check | emit <outdir>');
  process.exitCode = 2;
}
