#!/usr/bin/env node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openServer } from './lib/gm-stdio.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2] ?? 'build/release/native/components/host/gm';
const onNode = target === 'node';
const launch = onNode
    ? { binary: process.execPath, lead: [join(root, 'src', 'mcp.mjs')], extraArgs: [] }
    : { binary: resolve(target), lead: ['serve'], extraArgs: ['--build-dir', 'none'] };
const workspace = mkdtempSync(join(tmpdir(), 'gm-replay-'));
const configDir = mkdtempSync(join(tmpdir(), 'gm-replay-mcp-'));
const mcpConfig = join(configDir, 'no-default-mcp.json');
writeFileSync(mcpConfig, JSON.stringify({ mcpServers: { playwriter: { disabled: true } } }));
const marker = 'REPLAY-MARKER-5c1e';
const brief = `${marker} the first run's brief. ${'filler text for the brief. '.repeat(1200)}`;
const server = await openServer(launch.binary, { workspace, lead: launch.lead, extraArgs: ['--mcp-config', mcpConfig, ...launch.extraArgs] });
try {
    const first = await server.tool('next_context', { task: brief });
    const finished = await server.tool('finish', { witness: 'replay witness: the first run closed with its brief' });
    const successor = await server.tool('next_context', {});
    const items = successor.events ?? successor.items ?? [];
    const feed = JSON.stringify(items);
    const summary = {
        path: onNode ? 'node src/mcp.mjs' : 'native',
        target,
        firstRun: first.run,
        finished: finished.finished === true,
        successorRun: successor.run,
        briefChars: brief.length,
        feedChars: feed.length,
        feedHasBrief: feed.includes(marker),
        taskChars: successor.taskChars ?? String(successor.task ?? '').length,
    };
    console.log(JSON.stringify(summary, null, 2));
    if (!summary.finished || successor.run === first.run || summary.feedHasBrief) {
        console.error('next-context-replay: the successor run replayed the closed run brief in its events');
        process.exitCode = 1;
    }
} finally {
    server.close();
    rmSync(configDir, { recursive: true, force: true });
}
