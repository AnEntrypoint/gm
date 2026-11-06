#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = resolve(process.argv[2] ?? join(root, 'build', 'release'));
const names = ['gm', 'gm.exe'];
const binary = names.map((name) => join(buildDir, 'native', 'components', 'host', name)).find((path) => existsSync(path));

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
    timeout: 600000,
});
rmSync(workspace, { recursive: true, force: true });
rmSync(configDir, { recursive: true, force: true });
if (run.error) console.error(`check-build: ${run.error.message}`);
process.exit(run.status ?? 1);
