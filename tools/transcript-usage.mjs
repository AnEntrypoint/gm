#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2] ?? '/config/.claude/projects';

const median = (values) => {
    const sorted = values.filter((value) => value !== null).sort((a, b) => a - b);
    return sorted.length ? +sorted[Math.floor(sorted.length / 2)].toFixed(4) : null;
};

const sessions = [];
for (const dir of readdirSync(root)) {
    const full = join(root, dir);
    if (!statSync(full).isDirectory()) continue;
    for (const file of readdirSync(full)) {
        if (!file.endsWith('.jsonl')) continue;
        const text = readFileSync(join(full, file), 'utf8');
        const gmTools = {};
        const usage = { input: 0, cacheCreate: 0, cacheRead: 0, output: 0 };
        let calls = 0;
        for (const line of text.split('\n')) {
            if (!line.trim()) continue;
            let entry;
            try {
                entry = JSON.parse(line);
            } catch {
                continue;
            }
            const message = entry.message;
            if (!message || entry.type !== 'assistant') continue;
            if (message.usage) {
                usage.input += message.usage.input_tokens || 0;
                usage.cacheCreate += message.usage.cache_creation_input_tokens || 0;
                usage.cacheRead += message.usage.cache_read_input_tokens || 0;
                usage.output += message.usage.output_tokens || 0;
            }
            for (const block of Array.isArray(message.content) ? message.content : []) {
                if (block.type !== 'tool_use') continue;
                calls += 1;
                if (block.name.startsWith('mcp__gm__')) gmTools[block.name] = (gmTools[block.name] || 0) + 1;
            }
        }
        const cacheTotal = usage.cacheCreate + usage.cacheRead;
        sessions.push({
            dir,
            live: dir.includes('gmlive'),
            gm: Object.keys(gmTools).length > 0,
            gmTools,
            calls,
            usage,
            share: cacheTotal ? usage.cacheRead / cacheTotal : null,
        });
    }
}

const sum = (list) => list.reduce(
    (total, session) => {
        for (const key of Object.keys(total)) total[key] += session.usage[key];
        return total;
    },
    { input: 0, cacheCreate: 0, cacheRead: 0, output: 0 },
);
const gmSessions = sessions.filter((session) => session.gm);
const toolCounts = {};
for (const session of gmSessions) for (const [name, count] of Object.entries(session.gmTools)) toolCounts[name] = (toolCounts[name] || 0) + count;
const group = (list) => ({
    sessions: list.length,
    medianCacheReadShare: median(list.map((session) => session.share)),
    usage: sum(list),
});

console.log(JSON.stringify({
    gmSessions: gmSessions.length,
    gmCalls: Object.values(toolCounts).reduce((a, b) => a + b, 0),
    gmToolCounts: Object.fromEntries(Object.entries(toolCounts).sort((a, b) => b[1] - a[1])),
    gmHost: group(gmSessions.filter((session) => !session.live)),
    gmLive: group(gmSessions.filter((session) => session.live)),
    nonGm: group(sessions.filter((session) => !session.gm)),
}, null, 1));
