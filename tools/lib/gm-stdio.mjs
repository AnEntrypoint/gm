import { withoutPlaywriter } from './no-playwriter.mjs';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import readline from 'node:readline';

const removeWorkspace = (path) => {
    const wait = new Int32Array(new SharedArrayBuffer(4));
    for (let attempt = 0; attempt < 8; attempt += 1) {
        try {
            rmSync(path, { recursive: true, force: true });
            return;
        } catch (error) {
            if (error?.code !== 'ENOTEMPTY' || attempt === 7) throw error;
            Atomics.wait(wait, 0, 0, 50);
        }
    }
};

export async function openServer(binary, { workspace = withoutPlaywriter(mkdtempSync(join(tmpdir(), 'gm-stdio-'))), extraArgs = [], lead = ['serve'] } = {}) {
    const child = spawn(binary, [...lead, '--workspace', workspace, ...extraArgs], { stdio: ['pipe', 'pipe', 'pipe'] });
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
            removeWorkspace(workspace);
        },
    };
}
