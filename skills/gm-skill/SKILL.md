---
name: gm-skill
description: Plugkit-served instruction stream. Three-layer admission (cost, bounds, direction) over every mutation. Closure on first emit; partial = non-monotonic.
allowed-tools: Skill, Read, Write, Bash(node *), Bash(bun *)
---

# gm

**Done is what plugkit says is done — never your claim.** The COMPLETE gate is the single arbiter. If the chain is not at COMPLETE, there is a next transition to seek; idle mid-chain is a deviation.

**Every action begins and ends with `instruction`.** When in doubt, dispatch instruction. When denied, dispatch instruction. When the next move is unclear, dispatch instruction. There is no other recovery primitive and there is no situation in which improvising beats re-reading the prose.

**You are the state machine.** Plugkit is the durable memory and gate-checker you write into; you are the actor that walks PLAN → EXECUTE → EMIT → VERIFY → COMPLETE. Every phase transition, every PRD resolution, every mutable witness, every residual scan is a verb YOU dispatch by writing `.gm/exec-spool/in/<verb>/<N>.txt`. Plugkit does not advance. Plugkit does not validate in the background. Plugkit does not "process" while you wait. It serves a response file the moment you write a request file, and it sits inert otherwise. The phase you are in is the phase you last dispatched `transition` to land on — not the phase your narration is in. If gmsniff shows zero dispatches for this session, you have not walked the chain; you have hallucinated it.

This is the only thing that makes the discipline work. Drop this and every other rule collapses: mutables get resolved without witness, COMPLETE gets claimed without VERIFY, residuals get narrated away instead of scanned, and the chain becomes a story you tell instead of work you ship.

Every turn: dispatch `instruction` (you are the one dispatching it), read the response body, follow the imperative prose, dispatch the next verb the prose names. Re-dispatch `instruction` whenever you drift, stall, get denied at a gate, or feel uncertain about the next move — it is the cheap synchronous recovery primitive that puts you back on the chain. There is no cost to over-dispatching it and unbounded cost to acting without it. A session that stops dispatching instruction has stopped walking the chain. The phase-specific discipline lives in plugkit's instruction tables; this file does not duplicate it. What this file does is name the load-bearing identity: **you are the state machine, plugkit is your scratchpad and gate, no one else is going to walk the chain for you.**

**Boot before dispatching. Always check first.** Writing to `.gm/exec-spool/in/instruction/N.txt` while the watcher is dead is the canonical cold-start failure — the request sits forever, you read no response, you fabricate the chain from memory of the prose. The spool directory's existence does NOT mean the watcher is alive; `.status.json` mtime within the last 15s does. The leftover `.status.json` from yesterday's dead watcher is the most common trap.

Your first tool call of every session is the boot probe, in one Bash invocation:

```bash
cat .gm/exec-spool/.status.json 2>/dev/null; date +%s%3N
```

Compare the `ts` field to the printed epoch ms. If the gap is >15000, the watcher is dead — boot it:

```bash
bun x gm-plugkit@latest spool > /dev/null 2>&1 &
```

(`npx -y gm-plugkit@latest spool > /dev/null 2>&1 &` if `bun` missing.) Then wait ~8 seconds and re-`cat .gm/exec-spool/.status.json` to confirm a fresh `ts`. Only after a fresh heartbeat may you write to `instruction/`. Never write to `instruction/` while the heartbeat is stale; the request is silently dropped.

**Dispatch shape: Write + Read response in the SAME tool-call block.** Issuing the Write alone is not a dispatch — it's a request that goes nowhere visible. The shape is `Write .gm/exec-spool/in/instruction/<N>.txt` AND `Read .gm/exec-spool/out/instruction-<N>.json` (or `out/<N>.json` for nested verbs) in one parallel-tools block. The Read may return "file does not exist" on the first attempt while plugkit is mid-verb — in that case, re-Read in the next message. Do NOT proceed to any other tool, do NOT narrate "I have everything I need," do NOT begin work until you have READ the response and followed the `instruction` field. Declaring readiness without a response in hand is fabrication.

Never poll the spool dir with `sleep && ls` or `Start-Sleep && Test-Path` — plugkit is synchronous from your view; if the response is not there, the watcher is dead (re-check `.status.json` mtime) or the verb is slow (check `.gm/exec-spool/.watcher.log`), not "still processing."

First turn body must be `{"prompt":"<user request>"}` so orient_nouns and recall_hits derive from the request; subsequent turns in the same conversation may use empty body `{}`.

**Batch writes, waits, and reads together.** Each agent turn costs cycles; the dispatch shape `Write request → wait → Read response` is one logical step, not three. Issue all three in a single message — the Write tool call and the Read tool call go in the same `<function_calls>` block. The Read may return "file does not exist" if plugkit is mid-verb; that's fine, retry with one more Read in the next message rather than spreading the cycle across three turns. Fan-out is the same shape — dispatching three independent verbs (`prd-add g1`, `prd-add g2`, `prd-add g3`) means three Write tool calls in one block, then three Read tool calls in one block. Serial dispatch when you could be parallel is wasted cycles. The only sequencing constraint is real data dependency: if verb B needs the response of verb A, those go in separate turns; otherwise batch.

The chain is not COMPLETE until your changes are on origin. Commit and push at the end of every session that touched tracked files — you do not ask the user whether to push, you dispatch it. Asking is itself a deviation: you've already decided the work is done if you reached residual-scan, and the push IS the validation dispatch (`verify.rs`). The only thing that holds back the push is the porcelain check, and the fix to a dirty tree is to stage-and-commit or revert, not to stop and ask.

`git push` is admissible only when `git status --porcelain` reads empty. You dispatch the `git_push` verb (not raw Bash) — it gates on the porcelain probe, refuses dirty, and emits `deviation.push-dirty`. A raw `git push` via Bash bypasses the gate and is itself a deviation. Witness clean via `git_status`; witness pushed-to-remote via `branch_status` (ahead==0). The residual-scan and COMPLETE gate both refuse a dirty tree or a missing residual-check marker.

Response body is not a mutation surface. Memory writes route through `memorize-fire` only — another verb YOU dispatch. **Never** write persistent memory to platform-specific paths (`~/.claude/projects/*/memory/`, `~/.codex/memory/`, `~/.cursor/*`, etc.) — those don't transport between agent platforms and break the moment a session runs under a different harness. The only two portable surfaces are (a) dispatched `memorize-fire` (which writes through plugkit to the rs-learn store that travels with the project) and (b) `AGENTS.md` for project-tracked rules. If you reach for a `Write` tool on a memory directory under `~/`, stop — that's the lock-in anti-pattern.

On turn entry (first `instruction` dispatch after a >30s idle gap or session-start), plugkit attaches an `auto_recall` pack to your `instruction` response: `{query, hits, fired_at, turn_entry: true}`. The query is derived from `.gm/last-prompt.txt` / `.gm/turn-state.json`; hits are the top recall results plugkit pulled before serving your instruction. Read `auto_recall.hits` alongside the existing `recall_hits` (which is the phase+PRD-subject pack) — both surface prior memory, but `auto_recall` is the per-turn user-prompt pack and only fires on turn entry. Subsequent `instruction` dispatches in the same turn carry no `auto_recall` field (or carry the same pack from the turn-start fire); do not re-trigger it manually.
