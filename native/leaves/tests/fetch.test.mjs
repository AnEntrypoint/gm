import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { realHost } from './helpers.mjs';

const NL = String.fromCharCode(10);

const SERVER = `
const http = require('node:http');
let hits = 0;
const server = http.createServer((req, res) => {
  if (req.url === '/redir') return res.writeHead(302, { location: '/page' }).end();
  if (req.url === '/flaky' && (hits += 1) < 2) return res.writeHead(503).end('no');
  if (req.url === '/long') return res.writeHead(200, { 'content-type': 'text/plain' }).end(['alpha one', 'beta two', 'gamma three', 'delta four', ''].join(String.fromCharCode(10)));
  res.writeHead(200, { 'content-type': 'text/html' }).end('<html><script>x()</script><p>Hi &amp; bye</p></html>');
});
server.listen(0, '127.0.0.1', () => console.log(server.address().port));
`;

test('fetch through curl against a local server', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'fetch-'));
  const child = spawn(process.execPath, ['-e', SERVER], { stdio: ['ignore', 'pipe', 'inherit'] });
  const port = await new Promise((done) => child.stdout.once('data', (d) => done(Number(d))));
  const base = `http://127.0.0.1:${port}`;
  globalThis.host = realHost(workspace);
  try {
    const { verbs } = await import('../fetch.mjs');
    const call = (args) => verbs[0].call(args);
    const result = call({ url: `${base}/redir` });
    assert.equal(result.status, 200);
    assert.equal(result.redirects, 1);
    assert.match(result.source, /^[0-9a-f]{12}$/);
    assert.equal(result.sourceNew, true);
    assert.equal(call({ url: `${base}/redir` }).sourceNew, false);
    assert.equal(result.output, `200 ${result.bytes} bytes ${base}/page\nHi & bye`);
    const longUrl = `${base}/long`;
    const long = call({ url: longUrl });
    assert.equal(long.output, `200 ${long.bytes} bytes ${longUrl}` + NL + ['alpha one', 'beta two', 'gamma three', 'delta four', ''].join(NL));
    const capped = call({ url: longUrl, maxBytes: 10 });
    assert.equal(capped.output, `200 ${long.bytes} bytes ${longUrl}` + NL + 'alpha one' + NL + `[gm-fetch: body truncated to 10 bytes of ${long.bytes} bytes]`);
    const filtered = call({ url: longUrl, match: 'beta|delta' });
    assert.equal(filtered.output, `200 ${long.bytes} bytes ${longUrl}` + NL + ['beta two', 'delta four'].join(NL));
    const both = call({ url: longUrl, match: 'beta|delta', maxBytes: 6 });
    assert.equal(both.output, `200 ${long.bytes} bytes ${longUrl}` + NL + 'beta t' + NL + '[gm-fetch: body truncated to 6 bytes of 19 bytes]');
    assert.equal(call({ url: longUrl, maxBytes: -1 }).error, 'maxBytes must be an integer from 0 to 16777216');
    assert.equal(call({ url: longUrl, maxBytes: 1.5 }).ok, false);
    assert.equal(call({ url: longUrl, maxBytes: 16777217 }).ok, false);
    assert.equal(call({ url: longUrl, match: 5 }).error, 'match must be a string of at most 4096 characters');
    assert.equal(call({ url: longUrl, match: '[' }).ok, false);
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
