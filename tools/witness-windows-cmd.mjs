#!/usr/bin/env node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openServer } from './lib/gm-stdio.mjs';

const binary = resolve(process.argv[2] ?? 'build/release/native/components/host/gm.exe');
const workspace = mkdtempSync(join(tmpdir(), 'gm-windows-cmd-'));
const configDir = mkdtempSync(join(tmpdir(), 'gm-windows-cmd-mcp-'));
const mcpConfig = join(configDir, 'no-default-mcp.json');
writeFileSync(mcpConfig, JSON.stringify({ mcpServers: { playwriter: { disabled: true } } }));
const controlCommand = 'echo gm-windows-cmd-witness-ok';
const cmdOnlyCommand = 'dir /b';
const decode = (reply) => {
    if (typeof reply?.output !== 'string') return reply;
    try { return JSON.parse(reply.output); } catch { return reply.output; }
};
const server = await openServer(binary, { workspace, extraArgs: ['--mcp-config', mcpConfig] });
try {
    await server.tool('next_context', {});
    const control = await server.run(`return await gm.run_shell({ command: ${JSON.stringify(controlCommand)} });`);
    const cmdOnly = await server.run(`return await gm.run_shell({ command: ${JSON.stringify(cmdOnlyCommand)} });`);
    const cmdOnlyReply = decode(cmdOnly);
    if (cmdOnlyReply?.ok !== true || cmdOnlyReply?.launcher !== 'cmd') throw new Error(`cmd-only run_shell did not use cmd.exe: ${JSON.stringify(cmdOnlyReply)}`);
    console.log(JSON.stringify({ platform: process.platform, controlCommand, cmdOnlyCommand, control: decode(control), cmdOnly: cmdOnlyReply }, null, 2));
} finally {
    server.close();
    rmSync(configDir, { recursive: true, force: true });
}
