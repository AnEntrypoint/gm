import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { realHost } from './helpers.mjs';

const SERVER = `
const http = require('node:http');
let hits = 0;
const server = http.createServer((req, res) => {
  if (req.url === '/redir') return res.writeHead(302, { location: '/page' }).end();
  if (req.url === '/flaky' && (hits += 1) < 2) return res.writeHead(503).end('no');
  res.writeHead(200, { 'content-type': 'text/html' }).end('<html><script>x()</script><p>Hi &amp; bye</p></html>');
});
server.listen(0, '127.0.0.1', () => console.log(server.address().port));
`;

test('fetch through curl against a local server', async () => {
  const child = spawn(process.execPath, ['-e', SERVER], { stdio: ['ignore', 'pipe', 'inherit'] });
  const port = await new Promise((done) => child.stdout.once('data', (d) => done(Number(d))));
  const base = `http://127.0.0.1:${port}`;
  globalThis.host = realHost('/tmp');
  try {
    const { verbs } = await import('../fetch.mjs');
    const call = (args) => verbs[0].call(args);
    const result = call({ url: `${base}/redir` });
    assert.equal(result.status, 200);
    assert.equal(result.redirects, 1);
    assert.equal(result.headers['content-type'], 'text/html');
    assert.equal(result.output, `200 ${result.bytes} bytes ${base}/page\nHi & bye`);
    const flaky = call({ url: `${base}/flaky` });
    assert.deepEqual([flaky.status, flaky.attempts], [200, 2]);
    assert.equal(call({ url: 'nope' }).error, 'url is not a valid URL');
    assert.equal(call({ url: base, timeoutMs: 0 }).ok, false);
    const refused = call({ url: 'http://127.0.0.1:1/' });
    assert.equal(refused.code, 'ECONNREFUSED');
    assert.equal(refused.exhausted, true);
  } finally {
    child.kill();
  }
});
