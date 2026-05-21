# gm-automation audit — policy vs plumbing (iter20 J1)

User mandate: gm-starter/lib/* keeps only Node-side mechanics; ALL policy moves into rs-plugkit Rust. NO Claude-Code-specific hooks (no .claude/settings.json writes); platform-agnostic mandate.

## skill-bootstrap.js
- `getManagedGitignoreEntries()` [169-199] — **MOVE** — ignore-path list is policy
- `getMustStayTracked()` [201-212] — **MOVE** — negative list is policy
- `ensureManagedGitignore()` [546-592] — **MOVE** — block-merge logic is policy
- `ensureSpoolPollGate()` [461-526] — **DELETE** — writes `.claude/settings.json` (PLATFORM-LOCK)
- `spoolPollGateScript()` [333-459] — **MOVE** patterns + heuristics / **DELETE** hook registration
- `ensureBuildToolIgnores()` [264-329] — **KEEP** — advisory `.gm/build-tool-ignores.md` writer
- `httpGet()` [100-121] — **KEEP** — plumbing
- `downloadPlugkitBinary()` [594-606] — **KEEP** — plumbing
- `spawnPlugkitWatcher()` [725-770] — **KEEP** — plumbing
- `bootstrapPlugkit()` [772-912] — **KEEP** — orchestration plumbing
- `writeSessionSidecar()` [528-544] — **KEEP** — plumbing

## daemon-bootstrap.js
All `ensureRs*DaemonRunning` + `ensureBrowserReady` — **KEEP** — spawn/health-check plumbing.

## spool-dispatch.js
- `isBrowserRunningFile()` [65-71] — **MOVE** — file-pattern policy
- `recordBrowserEdit()` [88-106] — **MOVE** — witness-recording policy
- `checkDispatchGates()` [268-404] — **MOVE** — gate logic is policy (~140 LOC)
- `isSpoolPollCommand()` [226-233] + `SPOOL_POLL_PATTERNS` — **MOVE** — pattern policy
- `logDeviation()` [8-32] — **KEEP** — JSONL emission plumbing
- `hasDispatchedInstruction()` [181-190] — **KEEP** — marker read plumbing

## spool-poll-gate.js
Full file — **DELETE** — registered into `.claude/settings.json`; platform-lock.

## spool.js
All writeSpool/readSpoolOutput/waitForCompletion/execSpool — **KEEP** — file I/O plumbing.

## learning.js
ensureDaemonRunning / queryLearning / persistLearning — **KEEP** — daemon-comms plumbing.

## gm-plugkit/bootstrap.js
bootstrap / copyWasmToGmTools / startSpoolDaemon / ensureReady — **KEEP** — wasm-lifecycle plumbing.

## gm-plugkit/cli.js, supervisor.js, index.js
**KEEP** — entry/supervision/re-export plumbing.

## gm-plugkit/plugkit-wasm-wrapper.js
- `spoolPollGateScript()` [32-172] — **MOVE** policy / **DELETE** hook registration
- `ensureSpoolPollGate()` [174-236] — **DELETE** — `.claude/settings.json` writer
- `recordBrowserEditLocal()` [95-114] — **MOVE**
- `isBrowserRunningFileLocal()` [76-82] — **MOVE**
- `isInstructionTurnEntry()` [255-262] — **MOVE** — turn semantics policy
- `readUserPromptForRecall()` [264-278] — **MOVE** — recall-query derivation policy
- `dispatchVerbToWasmInternal()` [280-300] — **KEEP** — WASM memory plumbing
- `createWasiShim()` [912-990] — **KEEP** — WASI shim plumbing
- KV functions [1022-1052] — **KEEP** — file I/O plumbing
- `spawnTask()` [1087-1138] — **KEEP** — process plumbing
- host_* JS impls — **KEEP** — syscall plumbing

## lib/template-builder.js
- `generateGitignore()` [172-232] — **MOVE** policy (gmBlock 190-218) / **KEEP** scaffolding
- Other methods — **KEEP** — template-generation plumbing

## Summary

| Classification | Count |
|---|---|
| MOVE to rs-plugkit Rust | 13 functions/sections |
| KEEP as JS plumbing | 35+ |
| DELETE platform-lock | 3 (ensureSpoolPollGate, spool-poll-gate.js, hook registration in wrapper) |

**Top 5 highest-impact moves (LOC):**
1. `checkDispatchGates()` — ~140 LOC, gate enforcement
2. `ensureManagedGitignore()` — ~46 LOC, gitignore merge
3. `SPOOL_POLL_PATTERNS` + `stripHeredocsAndStringLiterals` + `isSpoolPollCommand` — ~60 LOC
4. Browser recording + file heuristics — ~60 LOC
5. Turn-entry + prompt-recall — ~60 LOC

## Architectural notes

1. **Gate enforcement** currently runs PER-DISPATCH on the JS side. After move: plugkit returns the gate verdict inline with the verb response — JS just acts on it.

2. **Browser-edit witness**: today hooks into `.claude/settings.json`. After move: agent (any platform) calls plugkit verb `record-edit {path, hash}` when editing a browser file.

3. **Spool-poll prohibition** today via Claude Code PreToolUse Bash matcher (exits 2). After move: plugkit detects poll patterns post-hoc from `.claude/gm-log/<day>/hook.jsonl` (already platform-agnostic JSONL) OR via skill-prose soft enforcement. The hard-block IS the platform-lock; soft enforcement via deviation events is platform-agnostic.

4. **Gitignore strategy** marker tokens (`# >>> plugkit managed` / `# <<< plugkit managed`) stay. Block contents owned by plugkit Rust.

5. **Consolidate `# >>> gm managed` and `# >>> plugkit managed`** to single marker — resolves task #74 simultaneously.
