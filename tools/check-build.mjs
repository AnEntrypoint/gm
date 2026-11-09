#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = resolve(process.argv[2] ?? join(root, 'build', 'release'));
const hostDir = join(buildDir, 'native', 'components', 'host');
const names = process.platform === 'win32' ? ['gm.exe', 'gm-core.exe'] : ['gm', 'gm-core'];
const binary = names.map((name) => join(hostDir, name)).find((path) => existsSync(path));

if (!binary) {
    console.error(`check-build: no gm binary under ${buildDir}`);
    process.exit(2);
}

const workspace = mkdtempSync(join(tmpdir(), 'gm-check-'));
const configDir = mkdtempSync(join(tmpdir(), 'gm-check-mcp-'));
const mcpConfig = join(configDir, 'no-default-mcp.json');
writeFileSync(mcpConfig, JSON.stringify({ mcpServers: { playwriter: { disabled: true } } }));
const run = spawnSync(process.execPath, [join(root, 'tools', 'mcp-conformance.mjs'), '--stdio', binary, 'serve', '--workspace', workspace, '--mcp-config', mcpConfig], {
    cwd: root,
    stdio: 'inherit',
    timeout: 1200000,
});
rmSync(workspace, { recursive: true, force: true });
rmSync(configDir, { recursive: true, force: true });
if (run.error) console.error(`check-build: ${run.error.message}`);
if (run.status !== 0) process.exit(run.status ?? 1);

for (const check of ['check-run-code-progress.mjs', 'check-shell-stdin.mjs', 'check-run-code-budget.mjs', 'check-job-bounds.mjs', 'check-early-run-code.mjs', 'check-stop-fetch.mjs', 'check-read-parity.mjs', 'check-read-truncation.mjs', 'check-protocol-versions.mjs', 'check-resources-subscribe.mjs', 'check-browser-scope.mjs', 'check-restart-jobs.mjs', 'check-startup-attempts.mjs', 'witness-next-context-replay.mjs']) {
    const result = spawnSync(process.execPath, [join(root, 'tools', check), binary], { cwd: root, stdio: 'inherit', timeout: 600000 });
    if (result.status !== 0) process.exit(result.status ?? 1);
}
const nodeRestart = spawnSync(process.execPath, [join(root, 'tools', 'check-restart-jobs.mjs'), 'node'], { cwd: root, stdio: 'inherit', timeout: 600000 });
if (nodeRestart.status !== 0) process.exit(nodeRestart.status ?? 1);

const cachePath = join(buildDir, 'CMakeCache.txt');
if (!existsSync(cachePath)) {
    console.error(`check-build: no CMakeCache.txt under ${buildDir}`);
    process.exit(2);
}
const cache = readFileSync(cachePath, 'utf8');
const cacheValue = (key) => {
    const line = cache.split('\n').find((entry) => entry.startsWith(`${key}:`));
    return line ? line.slice(line.indexOf('=') + 1).trim() : '';
};
const version = cacheValue('GMNEW_VERSION');
const commit = cacheValue('GMNEW_COMMIT');
if (!version || !commit) {
    console.error(`check-build: CMakeCache.txt under ${buildDir} has no GMNEW_VERSION or GMNEW_COMMIT`);
    process.exit(2);
}
const stamp = `${version} (${commit})`;
for (const name of names) {
    const path = join(hostDir, name);
    if (!existsSync(path)) {
        console.error(`check-build: missing ${name} under ${buildDir}`);
        process.exit(2);
    }
    const reply = spawnSync(path, ['--version'], { encoding: 'utf8', timeout: 30000 });
    const actual = (reply.stdout ?? '').trim();
    if (reply.status !== 0 || actual !== stamp) {
        console.error(`check-build: ${name} --version is ${JSON.stringify(actual)}, expected ${JSON.stringify(stamp)}`);
        process.exit(2);
    }
    console.log(`check-build: ${name} stamp ${actual}`);
}
process.exit(0);
