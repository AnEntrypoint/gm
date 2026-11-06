import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import readline from 'node:readline';

export async function openServer(binary, { workspace = mkdtempSync(join(tmpdir(), 'gm-stdio-')), extraArgs = [] } = {}) {
    const child = spawn(binary, ['serve', '--workspace', workspace, ...extraArgs], { stdio: ['pipe', 'pipe', 'pipe'] });
    child.stderr.resume();
    const pending = new Map();
    let nextId = 1;
    readline.createInterface({ input: child.stdout }).on('line', (line) => {
        let message;
        try {
            message = JSON.parse(line);
        } catch {
            return;
        }
        if (message.id !== undefined && pending.has(message.id)) {
            pending.get(message.id)(message);
            pending.delete(message.id);
        }
    });
    const rpc = (method, params) => {
        const id = nextId++;
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
        return new Promise((resolve) => pending.set(id, resolve));
    };
    await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'gm-stdio', version: '1' } });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    const tool = async (name, args) => {
        const reply = await rpc('tools/call', { name, arguments: args });
        return JSON.parse(reply.result.content[0].text);
    };
    return {
        workspace,
        tool,
        run: (body) => tool('run_code', { body }),
        close() {
            child.kill();
            rmSync(workspace, { recursive: true, force: true });
        },
    };
}
