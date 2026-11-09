#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openServer } from './lib/gm-stdio.mjs';

const binary = resolve(process.argv[2] ?? 'build/release/native/components/host/gm');
const secrets = [
    'Bearer tokA1x', 'Bearer tokB2y', 'bearer tokC3z', 'Bearer tokD4w',
    'access_token=SECRETZ1', 'refresh_token=SECRETZ2', 'api_key=KEYZ2', 'password=PWZ3',
];
const keep = 'keep-me';
const command = `echo '${secrets.join(' and ')} and ${keep}'`;

const server = await openServer(binary);
let failures = 0;
const check = (ok, what) => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
    if (!ok) failures += 1;
};
try {
    await server.tool('next_context', {});
    await server.run(`return (await gm.run_shell({ command: ${JSON.stringify(command)} })).output;`);
    const log = await server.run('return await gm.query_log({ kind: "action", limit: 50 });');
    const events = JSON.parse(log.output.output);
    const text = JSON.stringify(events);
    const artifactTexts = [];
    const runs = join(server.workspace, 'runs');
    if (existsSync(runs)) {
        for (const entry of readdirSync(runs, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            const outputs = join(runs, entry.name, 'outputs');
            if (!existsSync(outputs)) continue;
            for (const name of readdirSync(outputs)) {
                const file = join(outputs, name);
                if (statSync(file).isFile()) artifactTexts.push(readFileSync(file, 'utf8'));
            }
        }
    }
    const artifacts = artifactTexts.join('\n');
    check(events.some((event) => event.tool === 'run_shell'), 'the run_shell action reached the run log (positive control)');
    for (const secret of secrets) check(!text.includes(secret), `no raw "${secret}" in the run log`);
    check(text.includes(keep), `the non-secret "${keep}" is kept in the run log`);
    check(text.includes('[redacted]'), 'the run log shows [redacted] in place of the values');
    for (const secret of secrets) check(!artifacts.includes(secret), `no raw \"${secret}\" in output artifacts`);
    check(artifacts.length === 0 || artifacts.includes('[redacted]'), 'output artifacts show [redacted] in place of secret values');
} finally {
    server.close();
}
console.log(failures === 0 ? 'witness-redaction: passed' : `witness-redaction: ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
