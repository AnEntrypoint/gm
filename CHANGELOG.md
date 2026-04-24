## 2026-04-24 - gm-first enforcement + state machine phase guards

- New `hooks/prompt-submit-hook.js` (CC): writes `.gm/needs-gm` sentinel on every prompt; injects systemMessage demanding gm invocation and subagent parallelism as the first action.
- Updated `hooks/pre-tool-use-hook.js` (CC + gm-starter): blocks any non-Skill tool if `.gm/needs-gm` exists; clears sentinel when `Skill(gm)` is invoked; blocks `Write`/`Edit`/`NotebookEdit` in `gm-complete` and `update-docs` phases (prevents file mutations after emission).
- CC `buildHooksMap` override in `platforms/cli-config-shared.js`: generates hooks.json with plugkit binary + JS hook for both `UserPromptSubmit` and `PreToolUse`; fixes `Stop` timeouts (stop=15s, stop-git=180s — was inverted 300s/60s causing 3m20s session-end hang).
- ccsniff 48h analysis: 57% compliance across 23,746 messages; dominant violation = `missing-memorize-on-unknown` (agent finds/fixes facts but doesn't spawn memorize in same turn); secondary = `narrative-before-execution` (agent describes intent before running tool). Both are now actively enforced via hooks.

## 2026-04-23 - ccsniff + gm skillset alignment

- New `ccsniff-gm-lint.js`: optional linting module that analyzes conversation transcripts against gm tier-0 rules. Detects missing-skill-invocation, missing-memorize-on-unknown, bash-direct violations, narrative-before-execution. Produces JSON report for compliance auditing. Tested against 54 recent assistant messages: 98% compliance with gm skillset (49/50 conformant, 1 missing-skill edge case). Tool ready for integration into pre-commit hooks and agent training workflows.
- Updated AGENTS.md with ccsniff compliance audit findings.

## 2026-04-22 - Paper III published

- New `docs/paper3.html` — "Governance, Earned Emission, and the Remote-Execution Boundary" — covers 197 commits since paper II (2026-04-12): the governance layer (7 route families, 4 state planes, 16-mode taxonomy, ΔS/λ/ε/Coverage metrics, 8-case stress suite, 5 refused collapses); `git push` as remote-execution event with mandatory CI watch; catalogue of 4+1 parse-time CI failure modes (block-scalar heredoc indentation, missing token env, concurrent-push races, gitignored outputs, multiline output expansion); same-turn memorize discipline with end-of-turn self-check.
- Added paper3 nav links across paper.html, paper2.html, made-with.html, stats.html, site/main.js.

## 2026-04-22 - Governance layer in skill chain

- New `governance` skill: encodes route discovery (7 route families), weak-prior bridge, legitimacy gate (earned specificity / lawful downgrade), 16-failure taxonomy, 4 state planes (route_fit / authorization / repair_legality / hidden_decision_posture), ΔS/λ/ε/Coverage quality metrics, and 8-case governance stress suite (M1/F1/C1/H1/S1/B1/A1/D1).
- `planning` skill: route_family tagging + failure-mode mapping required on `.prd` items with emission impact; .prd YAML schema gains `route_family`, `failure_modes`, `route_fit`, `authorization`; competing routes kept live until witnessed dominance.
- `gm-execute` skill: weak-prior bridge — hypotheses from PLAN arrive as weak priors, never as authorization; witnessed probe required before `authorization=witnessed`. Quality metrics ΔS=0 / λ≥2 / ε intact / Coverage≥0.70 gate UNKNOWN→KNOWN transition.
- `gm-emit` skill: legitimacy gate prior to pre-emit — earned specificity, repair legality, lawful downgrade preferred over forced closure, live-alternative preservation. Five refused collapses enumerated in gate conditions.
- `gm-complete` skill: `stress_suite_clear` + `hidden_decision_posture=closed` added as completion mutables; hygiene sweep step 15 walks finished change through the 8 stress cases.
- Built to all 10 platforms (gm-cc/gc/oc/codex/kilo/qwen/hermes/vscode/cursor/copilot-cli/jetbrains).

## 2026-04-18 - Localize CDN imports in platform GH Pages

- Replaced rippleui@1.12.1 CDN link (4.7MB) with Tailwind CDN play script (~100KB, processes classes on-the-fly)
- Inlined webjsx@0.0.42 bundle (16KB) directly into page template — eliminates importmap + CDN dependency
- Platform pages now fully self-contained, no external asset fetches required for rendering

## 2026-04-18 - Fix Fragment/function-component crash in platform pages

- Fixed `Invalid element name` crash in all 12 platform GH Pages sites caused by webjsx not supporting function components passed to `h()` or `Fragment` wrapper in `App`
- `page-generator.js`: replaced destructured component calls with plain function calls, removed Fragment import, inlined `applyDiff` call with array of section results
- Added GH Pages workflow (`pages.yml`) + enabled GH Pages for 8 repos that were missing it: gm-hermes, gm-codex, gm-copilot-cli, gm-qwen, gm-vscode, gm-cursor, gm-zed, gm-jetbrains

## 2026-04-17 - PDF search across skills

- Propagated "PDFs searchable as code" capability through skills: code-search, planning, gm-execute, gm-emit, gm-complete.
- AGENTS.md: new caveat documenting rs-search PDF ingestion (pdf-extract crate, pdf-cache dir, ignore.rs changes).

# Changelog

## [Unreleased]
- Fix GC exec dispatch: use `plugkit exec --lang <lang> <code>` instead of positional arg (was treating lang as code)
- Deploy OC plugin (gm-oc.mjs) with all 5 handlers: session.closing, tool.execute.before, message.updated, experimental.chat.system.transform, experimental.chat.messages.transform
- Install gm-kilo plugin into ~/.kilocode: kilocode.json, gm-kilo.mjs, agents/, hooks/
- Deploy GC bin/ (plugkit.js + binaries) to ~/.gemini/extensions/gm/bin/
- Deploy updated GC hooks with exec dispatch to ~/.gemini/extensions/gm/hooks/
- Add validate/probe.js: 14-scenario parity harness for OC and GC hook scripts (14/14 passing)


### Fixed
- Align file-edit blocking rules across gc/kilo/oc to match cc exactly: add Edit tool to kilo/oc check, add edit_file to GC writeTools, add jest/vitest config and snap/stub/mock/fixture patterns to GC FORBIDDEN_FILE_RE, add /fixtures/ and /test-data/ to GC FORBIDDEN_PATH_RE
