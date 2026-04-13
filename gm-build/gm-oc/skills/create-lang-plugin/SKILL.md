---
name: create-lang-plugin
description: Create a lang/ plugin that wires any CLI tool or language runtime into gm-cc — adds exec:<id> dispatch, optional LSP diagnostics, and optional prompt context injection. Zero hook configuration required.
---

# CREATE LANG PLUGIN

**Use gm subagents for all independent work items. Invoke all skills in the chain: planning → gm-execute → gm-emit → gm-complete → update-docs.**


A lang plugin is a single CommonJS file at `<projectDir>/lang/<id>.js`. gm-cc's hooks auto-discover it — no hook editing, no settings changes. The plugin gets three integration points: **exec dispatch**, **LSP diagnostics**, and **context injection**.

## PLUGIN SHAPE

```js
'use strict';
module.exports = {
  id: 'mytool',                          // must match filename: lang/mytool.js
  exec: {
    match: /^exec:mytool/,               // regex tested against full "exec:mytool\n<code>" string
    run(code, cwd) {                     // returns string or Promise<string>
      // ...
    }
  },
  lsp: {                                 // optional — synchronous only
    check(fileContent, cwd) {            // returns Diagnostic[] synchronously
      // ...
    }
  },
  extensions: ['.ext'],                  // optional — file extensions lsp.check applies to
  context: `=== mytool ===\n...`        // optional — string or () => string
};
```

```ts
type Diagnostic = { line: number; col: number; severity: 'error'|'warning'; message: string };
```

## HOW IT WORKS

- **`exec.run`** is called in a child process (30s timeout) when Claude writes `exec:mytool\n<code>`. Output is returned as `exec:mytool output:\n\n<result>`. Async is fine here.
- **`lsp.check`** is called synchronously in the hook process on each prompt submit — must NOT be async. Use `execFileSync` or `spawnSync`.
- **`context`** is injected into every prompt's `additionalContext` (truncated to 2000 chars) and into the session-start context.
- **`match`** regex is tested against the full command string `exec:mytool\n<code>` — keep it simple: `/^exec:mytool/`.

## STEP 1 — IDENTIFY THE TOOL

Answer these before writing any code:

1. What is the tool's CLI name or npm package? (`gdlint`, `tsc`, `deno`, `ruff`, ...)
2. How do you run a single expression/snippet? (`tool eval <expr>`, `tool -e <code>`, HTTP POST, ...)
3. How do you run a file? (`tool run <file>`, `tool <file>`, ...)
4. Does it have a lint/check mode? What does its output format look like?
5. What file extensions does it apply to?
6. Is the game/server running required, or does it work headlessly?

## STEP 2 — IMPLEMENT exec.run

Pattern for **HTTP eval** (tool has a running server):

```js
const http = require('http');
function httpPost(port, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      { hostname: '127.0.0.1', port, path: urlPath, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      (res) => { let raw = ''; res.on('data', c => raw += c); res.on('end', () => { try { resolve(JSON.parse(raw)); } catch { resolve({ raw }); } }); }
    );
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
    req.write(data); req.end();
  });
}
```

Pattern for **file-based execution** (write temp file, run headlessly):

```js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

function runFile(code, cwd) {
  const tmp = path.join(os.tmpdir(), `plugin_${Date.now()}.ext`);
  fs.writeFileSync(tmp, code);
  try {
    return execFileSync('mytool', ['run', tmp], { cwd, encoding: 'utf8', timeout: 10000 });
  } finally {
    try { fs.unlinkSync(tmp); } catch (_) {}
  }
}
```

**Distinguish single expression vs multi-line** when both modes exist:

```js
function isSingleExpr(code) {
  return !code.trim().includes('\n') && !/\b(func|def|fn |class|import)\b/.test(code);
}
```

## STEP 3 — IMPLEMENT lsp.check (if applicable)

Must be **synchronous**. Parse the tool's stderr/stdout for diagnostics:

```js
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function check(fileContent, cwd) {
  const tmp = path.join(os.tmpdir(), `lsp_${Math.random().toString(36).slice(2)}.ext`);
  try {
    fs.writeFileSync(tmp, fileContent);
    const r = spawnSync('mytool', ['check', tmp], { encoding: 'utf8', cwd });
    const output = r.stdout + r.stderr;
    return output.split('\n').reduce((acc, line) => {
      const m = line.match(/^.+:(\d+):(\d+):\s+(error|warning):\s+(.+)$/);
      if (m) acc.push({ line: parseInt(m[1]), col: parseInt(m[2]), severity: m[3], message: m[4].trim() });
      return acc;
    }, []);
  } catch (_) {
    return [];
  } finally {
    try { fs.unlinkSync(tmp); } catch (_) {}
  }
}
```

Common output patterns to parse:
- `file:line:col: error: message` → standard
- `file:line: E001: message` → gdlint style (`E`=error, `W`=warning)
- JSON output → `JSON.parse(r.stdout).errors.map(...)`

## STEP 4 — WRITE context STRING

Describe what `exec:<id>` does and when to use it. This appears in every prompt. Keep it under 300 chars:

```js
context: `=== mytool exec: support ===
exec:mytool
<expression or code block>

Runs via <how>. Use for <when>.`
```

## STEP 5 — WRITE THE FILE

File goes at `lang/<id>.js` in the project root. The `id` field must match the filename (without `.js`).

Verify after writing:

```
exec:nodejs
const p = require('/abs/path/to/lang/mytool.js');
console.log(p.id, typeof p.exec.run, p.exec.match.toString());
```

Then test dispatch:

```
exec:mytool
<a simple test expression>
```

If it returns `exec:mytool output:` → working. If it errors → fix `exec.run`.

## CONSTRAINTS

- `exec.run` may be async — it runs in a child process with a 30s timeout
- `lsp.check` must be synchronous — no Promises, no async/await
- Plugin must be CommonJS (`module.exports = { ... }`) — no ES module syntax
- No persistent processes — `exec.run` must complete and exit cleanly
- `id` must match the filename exactly
- First match wins — if multiple plugins could match, make `match` specific

## EXAMPLE — gdscript plugin (reference implementation)

See `C:/dev/godot-kit/lang/gdscript.js` for a complete working example combining HTTP eval (single expressions via port 6009) with headless file execution fallback, synchronous gdlint LSP, and a context string.
