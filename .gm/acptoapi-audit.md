# acptoapi Audit: References Across gm Stack

**Audit Date:** 2026-05-20  
**Scope:** Search for acptoapi, localhost:4800, ensureAcptoapi, bootstrapAcptoapi, ACPTOAPI_ENABLE across specified repositories  
**Task:** Pure read-only inventory (no edits performed)

---

## C:\dev\gm

### Code (Active Source)
- `gm-starter/gm-plugkit/plugkit-wasm-wrapper.js:794-839` [code] — ensureAcptoapi() function inlined; spawns `bun x acptoapi@latest` on port 4800; includes Windows creationFlags inheritance pattern
- `gm-starter/lib/daemon-bootstrap.js:219-245` [code] — ensureAcptoapiRunning() async function; checks localhost:4800 reachability; spawns daemon on failure
- `gm-starter/lib/skill-bootstrap.js:706-722` [code] — bootstrapAcptoapi() async function (appears in original, not just build/)
- `build/gm-skill/lib/daemon-bootstrap.js:191-239` [generated] — Mirror of source daemon-bootstrap.js with ensureAcptoapiRunning()
- `build/gm-skill/lib/skill-bootstrap.js:706-722` [generated] — Mirror of source skill-bootstrap.js with bootstrapAcptoapi()

### Documentation
- `AGENTS.md:111` [doc] — Paragraph describing "acptoapi is the upstream embedding/LLM proxy: reachable at 127.0.0.1:4800; bootstrapAcptoapi spawns bun x acptoapi@latest; spawn failure non-fatal"
- `docs/skills.html:185` [doc] — HTML doc: "Routed through localhost acptoapi on 127.0.0.1:4800 for embedding/LLM calls"
- `docs/distribution.html:132` [doc] — "Optional outbound is acptoapi (localhost embedding/LLM proxy auto-launched)"
- `docs/paper.html:807` [doc] — Tasks route "via fetch host verb against local acptoapi proxy on 127.0.0.1:4800"

### Configuration & PRD
- `.gm/prd.yml:896-897` [doc] — G1 task: "Catalog every place rs-learn, rs-plugkit, rs-exec, rs-search, rs-codeinsight, gm reference acptoapi"
- `.gm/prd.yml:916-917` [doc] — G6 task: "Delete every acptoapi reference from running code: rs-plugkit/src/wasm_dispatch.rs, gm-starter/lib/daemon-bootstrap.js, gm-starter/lib/skill-bootstrap.js, plugkit-wasm-wrapper.js, vec_embed HTTP fallback"
- `.gm/prd.yml:920-921` [doc] — G7 task: "Strip acptoapi from AGENTS.md, docs/*, memory files. CHANGELOG history may retain past mentions"
- `.gm/prd.yml:928-929` [doc] — G9 task: "Final grep confirms zero acptoapi mentions anywhere except CHANGELOG history"
- `C:devgm.gmprd.yml:17,19-21,144` [doc] — PRD references: "Validate acptoapi + ACP agents", "Ensure c:\dev\acptoapi starts flawlessly", "Reference ACP: acptoapi with kilo/opencode"

### History (OK to retain)
- `CHANGELOG.md:15` [history] — 2026-05-18 entry: "Enables gm-skill to manage acptoapi, rs-learn, and rs-codeinsight daemons independently of plugkit"
- `CHANGELOG.md:152-154` [history] — 2026-05-14 entry: "rs-plugkit: track acptoapi process PID for session cleanup"

### Memory/State
- `.gm/mutables-acptoapi.yml` (entire file) [doc] — Witness declarations for acptoapi spawn PID tracking, session_start.rs, session_end.rs, kill_tree() integration (3 entries, all acptoapi-specific)
- `.gm/memorize-now.md:1-15` [memory] — "freddie acptoapi provider migration completed"; describes localhost:4800 endpoints for chat, memorize, rerank functions
- `.gm/mutables.yml:144` [doc] — One line in status section mentioning acptoapi daemon management in update context
- `.gm/last-prompt.txt` [memory] — (Not found; no acptoapi references expected)

---

## C:\dev\rs-plugkit

### Code
- `src/wasm_dispatch.rs:165,169` [code] — Two error messages:
  - Line 165: "is acptoapi running on 4800?" (inference error fallback)
  - Line 169: "acptoapi returned {status}: {detail}" (fetch error detail)

### Documentation
- `docs/wasm-parity.md` [doc] — Design document (no direct acptoapi refs, but part of wasm host surface context)

---

## C:\dev\rs-learn

**Status:** No acptoapi references found

---

## C:\dev\rs-exec

**Status:** No acptoapi references found

---

## C:\dev\rs-search

**Status:** No acptoapi references found

---

## C:\dev\rs-codeinsight

**Status:** No acptoapi references found

---

## C:\Users\user\.claude\projects\C--dev-gm\memory (Auto-Memory)

- `windows-spawn-cmd-shim-flash.md:37-41` [memory] — Memory entry documenting creationFlags inheritance pattern applied to acptoapi spawn; lists 6 files including:
  - `gm-starter/gm-plugkit/plugkit-wasm-wrapper.js::ensureAcptoapi`
  - `gm-starter/lib/daemon-bootstrap.js::ensureAcptoapiRunning + ensureAcptoapiRunning`
  - References to `acptoapi/lib/acp-launcher.js` and `acptoapi/lib/stdio-acp-wrapper.js` (upstream, not gm)
- Line 34: "bun x acptoapi@latest spawned with... 11+ conhost popups" (witness iter11)

---

## C:\dev\acptoapi (Upstream Proxy)

**Note:** This is the upstream project itself, not routing back to gm. Inventory for completeness.

### Code
- `bin/acptoapi.js:37,42-44` [code] — CLI bootstrap: console.log for acptoapi version/cache-clear messages
- `bin/acptoapi-tui.js:3,19,25,27-28,44,47-49,70,72-73,76-79,173,277` [code] — CLI TUI tool:
  - Env vars: `ACPTOAPI_URL` (default http://localhost:4800), `ACPTOAPI_CHAINS_PATH` (~/.acptoapi/), `ACPTOAPI_QUEUES_PATH`
  - Help text references acptoapi-tui subcommands
  - Default endpoint hardcoded to localhost:4800
- `docs/app.js:88,97` [doc/code] — Error message: "Is acptoapi running on {endpoint}?"; default endpoint http://localhost:4800/v1
- `lib/server.js`, `lib/acp-launcher.js`, `lib/stdio-acp-wrapper.js`, `lib/auto-chain.js`, `lib/capabilities.js`, `lib/keyring.js`, `lib/metrics.js`, `lib/model-resolver.js`, `lib/named-chains.js`, `lib/queues.js`, `lib/validate-prd.js`, `lib/openai-brands.js`, `lib/media-passthrough.js` [generated] — All contain acptoapi references as part of the upstream project (not routing back to gm)
- `package.json` [generated] — Contains acptoapi as project name/description
- `package-lock.json` [generated] — Lockfile (can ignore)

### Documentation & Site
- `README.md` [doc] — Project documentation
- `CHANGELOG.md` [history] — Project changelog
- `SYSTEM_SETUP.md`, `DEBUG_GUIDE.md`, `COMPLETION_REPORT.md` [doc] — Project docs
- `AGENTS.md` [doc] — Project agent documentation
- `.env.example` [doc] — Example config (no acptoapi-specific secrets)
- `site/content/**/*.yaml` [generated] — Static site content
- `docs/index.html` [generated] — Interactive docs UI

**Routing back to gm:** NO direct reverse references. acptoapi is upstream only.

---

## Summary

| Category | Count | Details |
|----------|-------|---------|
| **code** | 7 | ensureAcptoapi() (wasm-wrapper), ensureAcptoapiRunning() (daemon-bootstrap), bootstrapAcptoapi() (skill-bootstrap), wasm_dispatch.rs error msgs (2), TUI env vars, app.js default |
| **doc** | 14 | AGENTS.md, 3× docs/*, 4× .gm/prd.yml tasks, C:devgm.gmprd.yml (3 lines), mutables-acptoapi.yml, mutables.yml (1 line), wasm-parity.md |
| **memory** | 2 | memorize-now.md, windows-spawn-cmd-shim-flash.md |
| **history** | 2 | CHANGELOG.md (2 entries - retain per G7) |
| **generated** | 2 | build/gm-skill/lib/daemon-bootstrap.js, build/gm-skill/lib/skill-bootstrap.js |
| **acptoapi upstream** | 35 | bin/, lib/, docs/, site/ (ignore; upstream only, no reverse routing to gm) |

**Total gm Stack (actionable):** 27 references across code/doc/memory/history

**Notes:**
- G1 audit complete per task `.gm/prd.yml:896`
- No acptoapi references in rs-learn, rs-exec, rs-search, rs-codeinsight
- All active bootstrap code is in gm (daemon-bootstrap, skill-bootstrap, plugkit-wasm-wrapper)
- rs-plugkit wasm_dispatch.rs contains fallback error messages only (not primary routing)
- acptoapi upstream is self-contained; no reverse dependencies detected
- G6 (remove from source) and G7 (remove from docs/memory) are ready to proceed

---

