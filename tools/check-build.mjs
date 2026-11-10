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

const failed = (step, result) => {
    const how = result.signal ? `signal ${result.signal}` : `status ${result.status}`;
    const hint = result.status === 13 ? ' (Node exits 13 when a top-level await never settles, so the step stopped before it reported)' : '';
    console.error(`check-build: failed: ${step} ended with ${how}${hint}`);
    process.exit(result.status ?? 1);
};
const runStep = (step, script, args) => {
    const result = spawnSync(process.execPath, [script, ...args], { cwd: root, stdio: 'inherit', timeout: 600000 });
    if (result.error) console.error(`check-build: ${step}: ${result.error.message}`);
    if (result.status !== 0) failed(step, result);
};

const workspace = mkdtempSync(join(tmpdir(), 'gm-check-'));
const configDir = mkdtempSync(join(tmpdir(), 'gm-check-mcp-'));
const mcpConfig = join(configDir, 'no-default-mcp.json');
writeFileSync(mcpConfig, JSON.stringify({ mcpServers: { playwriter: { disabled: true } } }));
const conformance = spawnSync(process.execPath, [join(root, 'tools', 'mcp-conformance.mjs'), '--stdio', binary, 'serve', '--workspace', workspace, '--mcp-config', mcpConfig], {
    cwd: root,
    stdio: 'inherit',
    timeout: 2700000,
});
rmSync(workspace, { recursive: true, force: true });
rmSync(configDir, { recursive: true, force: true });
if (conformance.error) console.error(`check-build: mcp-conformance: ${conformance.error.message}`);
if (conformance.status !== 0) failed('mcp-conformance', conformance);

for (const check of ['check-run-code-progress.mjs', 'check-shell-stdin.mjs', 'check-run-code-budget.mjs', 'check-grep-state-scope.mjs', 'check-job-bounds.mjs', 'check-early-run-code.mjs', 'check-stop-fetch.mjs', 'check-read-parity.mjs', 'check-read-truncation.mjs', 'check-protocol-versions.mjs', 'check-resources-subscribe.mjs', 'check-browser-scope.mjs', 'check-restart-jobs.mjs', 'check-startup-attempts.mjs', 'check-skill-serve.mjs', 'check-no-resource-client.mjs', 'check-restart-skill-read.mjs', 'check-relay-reexec.mjs', 'check-turn-economy.mjs', 'check-embedded-runtime.mjs', 'witness-next-context-replay.mjs']) {
    runStep(check, join(root, 'tools', check), [binary]);
}
for (const check of ['check-restart-jobs.mjs', 'check-no-resource-client.mjs', 'check-turn-economy.mjs']) {
    runStep(`${check} node`, join(root, 'tools', check), ['node']);
}

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
