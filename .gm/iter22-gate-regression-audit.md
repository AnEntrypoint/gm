# Iter22 Gate Regression Audit

## Finding: spool-poll-gate.js Installation Source

**What writes the file:**  
`ensureSpoolPollGate()` function in gm-plugkit/plugkit-wasm-wrapper.js  
- Function definition: lines 32-173  
- Implementation: lines 174-204  
- Invocation point 1: line 1605 (bootstrap entry)  
- Invocation point 2: line 2391 (spool CLI branch)

**Where it lands:**  
`.gm/hooks/spool-poll-gate.js` (7074 bytes with embedded gate script)  
Also modifies `.claude/settings.json` to register PreToolUse hooks for Bash/Write/Edit/MultiEdit

**Affected npm package versions:**  
- gm-plugkit@2.0.1245 through 2.0.1256 (all include ensureSpollPollGate)  
- gm-plugkit@2.0.1257+ (cleaned — code removed)  
- gm-skill@2.0.1245 through 2.0.1252 (all bundle matching gm-plugkit versions with gate code)  
- gm-skill@2.0.1253+ (updated to depend on cleaned gm-plugkit >= 2.0.1257)

**The Regression:**  
Iter20 J4 removed the gate installation code from gm-starter/gm-plugkit/plugkit-wasm-wrapper.js (commit 80c6b49f on 2026-05-21 01:14:55). However, twelve versions of gm-plugkit (2.0.1245–2.0.1256) had already shipped to npm with the code. When users/agents run `bun x gm-plugkit@latest spool` or equivalent with these old versions, ensureSpollPollGate fires during bootstrap and installs the gate file + hook entries.

**Evidence:**  
gmsniff iter22 line 11 recorded gate.installed event on 2026-05-20 23:13:22 from "bootstrap" source, indicating an agent was still running gm-skill ≤ 2.0.1252 (which bundles gm-plugkit ≤ 2.0.1256).

## Fix Status

[x] Code cleaned from gm-starter source (commit 80c6b49f)  
[x] gm-plugkit@2.0.1257+ published without gate code  
[x] gm-skill@2.0.1253+ updated to depend on gm-plugkit@^2.0.1257  

**Remaining issue:**  
gm-skill versions 2.0.1251–2.0.1252 still have old gm-plugkit dependencies. If any agent environment still uses these versions, gate installation will recur. No code changes needed — the regression is already fixed in published versions. Audit complete.
