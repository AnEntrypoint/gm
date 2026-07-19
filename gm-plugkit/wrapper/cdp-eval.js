import fs from 'fs';
import http from 'http';

function httpJson(url, timeoutMs) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (_) { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

async function pickPageTarget(port, startUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const list = await httpJson(`http://127.0.0.1:${port}/json/list`, 2000);
    if (Array.isArray(list)) {
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    }
    if (startUrl) {
      const created = await httpJson(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(startUrl)}`, 3000);
      if (created && created.webSocketDebuggerUrl) return created;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

function cdpSession(wsUrl, timeoutMs) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let nextId = 1;
    const pending = new Map();
    const timer = setTimeout(() => { try { ws.close(); } catch (_) {} reject(new Error('cdp timeout')); }, timeoutMs);
    ws.addEventListener('open', () => {
      resolve({
        send(method, params) {
          const id = nextId++;
          return new Promise((res, rej) => {
            pending.set(id, { res, rej });
            ws.send(JSON.stringify({ id, method, params: params || {} }));
          });
        },
        close() { clearTimeout(timer); try { ws.close(); } catch (_) {} },
      });
    });
    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (_) { return; }
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message || 'cdp error'));
        else res(msg.result);
      }
    });
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('cdp websocket error')); });
  });
}

// Direct CDP evaluation, replacing the playwriter relay attach+eval that crashes
// with UV_HANDLE_CLOSING on Windows. Everything up to obtaining Chrome's CDP
// endpoint is already done by the wrapper (it launches Chrome with
// --remote-debugging-port and polls /json/version); this drives that endpoint
// directly over the DevTools websocket, so the crashing relay process is never
// spawned. Reads {port, startUrl, scriptFile, resultFile, timeoutMs} from argv[2]
// as JSON, runs the script via Runtime.evaluate (awaitPromise, returnByValue),
// and writes the returned value to resultFile -- the same result channel the
// playwriter path used.
async function main() {
  const cfg = JSON.parse(process.argv[2]);
  const { port, startUrl, scriptFile, resultFile, timeoutMs } = cfg;
  const script = fs.readFileSync(scriptFile, 'utf-8');
  const target = await pickPageTarget(port, startUrl, Math.min(timeoutMs, 30000));
  if (!target) {
    fs.writeFileSync(resultFile, JSON.stringify({ __cdpError: 'no page target on CDP endpoint' }));
    process.stderr.write('cdp-eval: no page target\n');
    process.exit(1);
  }
  const sess = await cdpSession(target.webSocketDebuggerUrl, timeoutMs);
  try {
    await sess.send('Runtime.enable', {});
    if (startUrl) {
      await sess.send('Page.enable', {});
      await sess.send('Page.navigate', { url: startUrl });
      await new Promise((r) => setTimeout(r, 1200));
    }
    // The wrapper's eval body is a function body ending in `return __RET;`.
    // Wrap it in an async IIFE so Runtime.evaluate resolves the returned value.
    const wrapped = `(async () => { ${script} })()`;
    const res = await sess.send('Runtime.evaluate', {
      expression: wrapped,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
      timeout: timeoutMs,
    });
    if (res.exceptionDetails) {
      const msg = res.exceptionDetails.exception && res.exceptionDetails.exception.description
        ? res.exceptionDetails.exception.description
        : (res.exceptionDetails.text || 'evaluate exception');
      fs.writeFileSync(resultFile, JSON.stringify({ __cdpError: msg }));
      process.stderr.write(`cdp-eval: exception ${msg}\n`);
      sess.close();
      process.exit(1);
    }
    const value = res.result && ('value' in res.result) ? res.result.value : null;
    fs.writeFileSync(resultFile, JSON.stringify(value === undefined ? null : value));
    sess.close();
    process.exit(0);
  } catch (e) {
    fs.writeFileSync(resultFile, JSON.stringify({ __cdpError: String(e && e.message || e) }));
    process.stderr.write(`cdp-eval: ${e && e.message || e}\n`);
    try { sess.close(); } catch (_) {}
    process.exit(1);
  }
}

main();
