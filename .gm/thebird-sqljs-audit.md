# thebird sql.js -> plugkit migration map

(I1 audit, iter19 — preserved for later thebird-side migration after the policy-into-plugkit refactor lands.)

## CONSUMERS OF SQL.JS

### 1. `docs/libsql-sqljs.js` (1-206) — ENTRY POINT, DELETE
- API used: `loadSqlJs`, `window.initSqlJs`, `new SQL.Database()`, `db.prepare/exec/export/getRowsModified/close`, `db.__thebirdPlugkitBacked` flag
- Plugkit coverage: full — via `docs/lib/sqlite-shim-libsql-client-adapter.js` (lines 47-107) bridging `createClient({url})` -> `sqlite3.oo1.DB`, emitting `{rows, columns, rowsAffected, lastInsertRowid}`
- Action: **delete entirely**

### 2. `docs/lib/sqlite-shim.js` (1-494) — KEEP (plugkit shim)
- Exports `sqlite3InitModule()`, `Database` class with `.exec/.prepare/.export/.close/.lastInsertRowid`, `PreparedStatement` with `.bind/.step/.get/.free`
- Sets `__thebirdPlugkitBacked: true` flag (line 477)
- `parseSelectColumns()` (lines 119-149): plugkit returns rows alphabetical-keyed; this recovers SELECT order. Not sql.js-specific.
- Already handles both backends via fallback at line 188
- Action: **keep, no changes**

### 3. `docs/lib/sqlite-shim-libsql-client-adapter.js` (1-110) — KEEP
- `createClient({url})` -> libsql Client shape over `sqlite3.oo1.DB`
- Action: **keep, no changes**

### 4. `docs/vendor/busybase/embedded.js` — REROUTE comment only
- Line 9 imports plugkit adapter, line 12 plugkit backend, line 15 libsql Node-only error
- Action: drop "Default-libsql backend disabled" comment on line 1 after sql.js retirement

### 5. `docs/freddie-host.js` (line 1) — UPDATE IMPORT
- `import { createClient } from './libsql-sqljs.js'`
- Action: change to `from './lib/sqlite-shim-libsql-client-adapter.js'`

### 6. `docs/os.html` (20-62) — CLEAN IMPORTMAP
- Lines 22, 26 importmap `"sql.js": "./lib/sqlite-shim.js"`
- Lines 56-62 `initSqlJs` shim setup (plugkit-backed)
- Action: remove the `"sql.js"` importmap entry; keep sqlite3-wasm aliases

### 7. `docs/validate.html` (16-36) — CLEAN IMPORTMAP
- Lines 19-22 importmap `"sql.js"` -> `./lib/sqlite-shim.js`
- Affected 159-invariants: `sqlite_shim_global_present`, `sqlite_shim_init_returns_oo1_DB`, `sqlite_shim_exec_round_trip`, `sqlite_shim_uses_plugkit`, all busybase invariants. All plugkit-backed already.
- Action: remove the `"sql.js"` importmap entry; update comments to plugkit-only

### 8. `docs/shell-node-native.js` (line 2) — DELETE OR STUB
- ```js
  'better_sqlite3.node': () => import('https://esm.sh/sql.js@1.11.0/dist/sql-wasm.js')
  ```
- Node-runtime shim, not used in thebird browser path
- Action: delete the line or replace with plugkit-only path

### 9. `docs/vendor/sql-wasm.js` (190) — DELETE
- Emscripten modularization wrapper
- Action: **delete**

### 10. `docs/vendor/sql-wasm.wasm` (638 KB) — DELETE
- Compiled SQLite for browser
- Action: **delete**

### 11. `docs/vendor/esm/sql-wasm.mjs` — DELETE
- ESM re-export of sql-wasm.js
- Action: **delete**

### 12. `docs/CHANGELOG.md` (line 322) — UPDATE
- Lists sql-wasm.wasm (0.6 MB) excluded from defaults.json
- Action: drop sql-wasm mention; note plugkit-only consolidation

### 13. `scripts/vendor-fetch.mjs` — AUDIT + REMOVE
- May fetch sql-wasm.wasm during build
- Action: remove the sql.js fetch rule if present

## SUMMARY

- **Delete**: docs/libsql-sqljs.js, docs/vendor/sql-wasm.{js,wasm}, docs/vendor/esm/sql-wasm.mjs
- **Update imports/importmaps**: docs/freddie-host.js, docs/os.html, docs/validate.html
- **Drop comments only**: docs/vendor/busybase/embedded.js, docs/CHANGELOG.md
- **Audit**: scripts/vendor-fetch.mjs, docs/shell-node-native.js

## KEY CONTRACT NOTES

- `parseSelectColumns()` is a plugkit workaround (alphabetical-keys -> SELECT order recovery), NOT sql.js-specific. Survives migration unchanged.
- All 159 validate-harness invariants are plugkit-backed already; only importmap noise remains.
- Footprint reduction: ~650 KB (sql-wasm.wasm) + ~25 KB (wrappers/aliases/entry).
- Plugkit.wasm is loaded from CDN (`https://github.com/AnEntrypoint/plugkit-bin/releases/download/v0.1.464/plugkit.wasm`) per iter19 I2 decision.
