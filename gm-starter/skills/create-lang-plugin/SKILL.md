---
name: create-lang-plugin
description: Create a lang/ plugin that wires any CLI tool or language runtime into gm-cc — adds exec:<id> dispatch, optional LSP diagnostics, and optional prompt context injection. Zero hook configuration required.
---

# CREATE LANG PLUGIN

Single CommonJS file at `<projectDir>/lang/<id>.js`. Auto-discovered — no hook editing.

## Plugin Shape

```js
'use strict';
module.exports = {
  id: 'mytool',                         // must match filename
  exec: {
    match: /^exec:mytool/,
    run(code, cwd) { /* returns string or Promise<string> */ }
  },
  lsp: {                                // optional — synchronous only
    check(fileContent, cwd) { /* returns Diagnostic[] */ }
  },
  extensions: ['.ext'],                 // optional — for lsp.check
  context: `=== mytool ===\n...`       // optional — string or () => string
};
```

`type Diagnostic = { line: number; col: number; severity: 'error'|'warning'; message: string }`

## How It Works

- `exec.run` — child process, 30s timeout, async OK. Called when Claude writes `exec:mytool\n<code>`.
- `lsp.check` — synchronous, called per prompt submit. Use `spawnSync`/`execFileSync`. No async.
- `context` — injected into every prompt (truncated 2000 chars).

## Step 1 — Identify Tool

1. CLI name or npm package?
2. Run single expression? (`tool eval <expr>`, `tool -e <code>`, HTTP POST...)
3. Run file? (`tool run <file>`)
4. Lint/check mode + output format?
5. File extensions?
6. Requires running server or headless?

## Step 2 — exec.run Patterns

HTTP eval (running server):
```js
function httpPost(port, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      { hostname: '127.0.0.1', port, path: urlPath, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      res => { let raw = ''; res.on('data', c => raw += c); res.on('end', () => resolve(JSON.parse(raw))); }
    );
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
    req.write(data); req.end();
  });
}
```

File-based (headless):
```js
function runFile(code, cwd) {
  const tmp = path.join(os.tmpdir(), `plugin_${Date.now()}.ext`);
  fs.writeFileSync(tmp, code);
  try { return execFileSync('mytool', ['run', tmp], { cwd, encoding: 'utf8', timeout: 10000 }); }
  finally { try { fs.unlinkSync(tmp); } catch (_) {} }
}
```

Single expr detection:
```js
const isSingleExpr = code => !code.trim().includes('\n') && !/\b(func|def|fn |class|import)\b/.test(code);
```

## Step 3 — lsp.check

```js
function check(fileContent, cwd) {
  const tmp = path.join(os.tmpdir(), `lsp_${Math.random().toString(36).slice(2)}.ext`);
  try {
    fs.writeFileSync(tmp, fileContent);
    const r = spawnSync('mytool', ['check', tmp], { encoding: 'utf8', cwd });
    return (r.stdout + r.stderr).split('\n').reduce((acc, line) => {
      const m = line.match(/^.+:(\d+):(\d+):\s+(error|warning):\s+(.+)$/);
      if (m) acc.push({ line: +m[1], col: +m[2], severity: m[3], message: m[4].trim() });
      return acc;
    }, []);
  } catch (_) { return []; }
  finally { try { fs.unlinkSync(tmp); } catch (_) {} }
}
```

## Step 4 — context String

Under 300 chars:
```js
context: `=== mytool ===\nexec:mytool\n<expression>\n\nRuns via <how>. Use for <when>.`
```

## Step 5 — Write + Verify

```
exec:nodejs
const p = require('/abs/path/lang/mytool.js');
console.log(p.id, typeof p.exec.run, p.exec.match.toString());
```

Then test dispatch:
```
exec:mytool
<simple test expression>
```

## Constraints

- `exec.run` async OK (30s timeout)
- `lsp.check` synchronous only — no Promises
- CommonJS only — no ES module syntax
- No persistent processes
- `id` must match filename exactly
- First match wins — make `match` specific
