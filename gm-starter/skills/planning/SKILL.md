---
name: planning
description: State machine orchestrator. Mutable discovery, PRD construction, and full PLAN→EXECUTE→EMIT→VERIFY→COMPLETE lifecycle. Invoke at session start and on any new unknown.
allowed-tools: Skill, Read, Write
---

# planning — PLAN

Every turn begins with prior memory already loaded by auto-recall. PLAN adds targeted reconnaissance on top of that injection. Before any unknown is named as absent, it has been searched for. Before an abstraction is designed, the codebase has been checked for one that already exists.

## ORIENT

The first action of PLAN is a parallel pack: 3–5 `exec:recall` calls and 3–5 `exec:codesearch` calls against the request's nouns, dispatched in one message. Hits become weak_prior — still witnessed before adoption. Misses confirm the unknown is fresh. The pack is free relative to the duplicated discovery and disagree-with-prior-witness risk it prevents. Serial probing of nouns one-at-a-time is the failure mode this discipline guards against.

Spool the pack as the opening move:

```
.gm/exec-spool/in/recall/1.txt   "<noun phrase 1>"
.gm/exec-spool/in/recall/2.txt   "<noun phrase 2>"
.gm/exec-spool/in/recall/3.txt   "<noun phrase 3>"
.gm/exec-spool/in/codesearch/1.txt   "<two-word phrase 1>"
.gm/exec-spool/in/codesearch/2.txt   "<two-word phrase 2>"
.gm/exec-spool/in/codesearch/3.txt   "<two-word phrase 3>"
```

All in one message. Read `out/*.json` together.

## Maximal Cover

Scope-exceeds-reach is a planning condition, not a stopping condition. The covering family is the plan. Enumerate every bounded subset of the request witnessable from this session; write the family into `.gm/prd.yml` with the dependency graph explicit. Residuals within the spirit of the ask AND reachable from this session are self-authorized — expand the PRD and declare the read in one line ("treating X as in-spirit because Y"). Only out-of-spirit or unreachable residuals are name-and-stop.

## Mutables File

`.gm/mutables.yml` is co-equal with `.gm/prd.yml`. Every unknown surfaced lands as a row with `status: unknown`. The hook layer hard-blocks Write, Edit, `git commit`, `git push`, and stop while any row remains unknown. Rows flip to `witnessed` only when `witness_evidence` carries concrete proof — file:line, codesearch hit, exec output snippet. Narrative resolution is rejected on read. PLAN exits only at ε = 0 on the final pass.

## Dispatch

`phase-status` to read FSM state. `transition` to advance. `mutable-resolve` to mark witnessed (auto-fires memorize). Plus the usual `recall`, `codesearch`, `memorize`, `health`, language stems.

## Transition

Read `out/<N>.json::nextSkill`. Invoke `Skill(skill="gm:<nextSkill>")` immediately.
