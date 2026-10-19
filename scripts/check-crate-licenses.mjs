// Fails when a Rust crate in rs-plugkit or agentplug carries a license outside deny.toml.
// Usage: node scripts/check-crate-licenses.mjs   (needs cargo-deny on PATH)
// Prints one line per offending crate and RESULT: PASS or RESULT: FAIL.
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const manifests = ['rs-plugkit/Cargo.toml', 'agentplug/Cargo.toml'];
const failures = [];
for (const manifest of manifests) {
  const run = spawnSync('cargo', ['deny', '--format', 'json', '--manifest-path', manifest, 'check', '--config', resolve('deny.toml'), 'licenses'], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (run.error) { console.error('cargo-deny did not start: ' + run.error.message); process.exit(1); }
  for (const line of (run.stderr || '').split('\n')) {
    if (!line.startsWith('{')) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    const fields = entry.fields || {};
    if (entry.type !== 'diagnostic' || fields.severity !== 'error') continue;
    const name = fields.graphs?.[0]?.Krate?.name ?? '(unknown crate)';
    failures.push(manifest + ': ' + name + ': ' + (fields.code ?? 'error') + ': ' + fields.message);
  }
  if (run.status !== 0 && !(run.stderr || '').includes('"type":"diagnostic"')) failures.push(manifest + ': cargo-deny exited ' + run.status + ' with no diagnostics');
}
for (const failure of failures) console.log('FAIL ' + failure);
console.log(failures.length === 0 ? 'RESULT: PASS' : 'RESULT: FAIL');
process.exit(failures.length === 0 ? 0 : 1);
