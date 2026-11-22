import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createServer, connect } from 'node:net';
import { createServer as createHttpServer } from 'node:http';

const results = {};
const step = async (name, run) => {
  try {
    results[name] = { ok: true, value: await run() };
  } catch (error) {
    results[name] = { ok: false, error: String(error?.code ?? '') + ' ' + String(error?.message ?? error) };
  }
};

await step('hostFunction', () => createRequire(import.meta.url)('./host.node').sum(40, 2));
await step('fs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'edgejs-spike-'));
  writeFileSync(join(dir, 'probe.txt'), 'written by edgejs');
  const text = readFileSync(join(dir, 'probe.txt'), 'utf8');
  rmSync(dir, { recursive: true });
  return text;
});
await step('childProcess', () => {
  const run = spawnSync('/bin/sh', ['-c', 'printf child; exit 3']);
  return { status: run.status, out: String(run.stdout) };
});
await step('net', () => new Promise((resolve, reject) => {
  const server = createServer((socket) => socket.pipe(socket));
  server.listen(0, '127.0.0.1', () => {
    const client = connect(server.address().port, '127.0.0.1', () => client.write('echo'));
    client.on('data', (data) => { client.end(); server.close(); resolve(String(data)); });
    client.on('error', reject);
  });
}));
await step('sqlite', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(':memory:');
  db.exec('create table t (v text)');
  db.prepare('insert into t values (?)').run('row');
  return db.prepare('select v from t').get().v;
});
await step('fetch', () => new Promise((resolve, reject) => {
  const server = createHttpServer((request, response) => response.end('fetched ' + request.url));
  server.listen(0, '127.0.0.1', async () => {
    try {
      const response = await fetch('http://127.0.0.1:' + server.address().port + '/probe');
      resolve({ status: response.status, body: await response.text() });
    } catch (error) {
      reject(error);
    } finally {
      server.close();
    }
  });
}));
console.log(JSON.stringify(results));
