#!/usr/bin/env node
import { resolve } from 'node:path';
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
    const events = JSON.parse(JSON.parse(log.output).output);
    const text = JSON.stringify(events);
    check(events.some((event) => event.tool === 'run_shell'), 'the run_shell action reached the run log (positive control)');
    for (const secret of secrets) check(!text.includes(secret), `no raw "${secret}" in the run log`);
    check(text.includes(keep), `the non-secret "${keep}" is kept in the run log`);
    check(text.includes('[redacted]'), 'the run log shows [redacted] in place of the values');
} finally {
    server.close();
}
console.log(failures === 0 ? 'witness-redaction: passed' : `witness-redaction: ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
