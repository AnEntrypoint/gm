# Default-workflow audit

Date: 2026-10-07. Baseline: `f33963e1a4e95698d5957bac30ccfb19742b7c88` on SolutionsAsService/gm main. Scope: shipped skills, discovery/contributor instructions, default installer, automatic registration and fork publication workflows. No upstream Rust/WASM/submodule source or live runtime was changed.

Pimp My Skill · SolutionsAsService · https://github.com/SolutionsAsService. Original gm copyright (c) 2026 AnEntrypoint, MIT; original notices retained.

## Findings and implemented corrections

Line references below refer to the baseline commit, not the rewritten files.

| Severity | Evidence | Failure mechanism | Correction |
| --- | --- | --- | --- |
| High | `skills/gm/SKILL.md:72-85,395-399` | Every task becomes exhaustive, adjacent work enters scope, uncertainty/retry returns to instruction. A successful inspection can repeat indefinitely because only repeated failures were bounded. | Bounded outcome, two no-progress inspections then a concrete next action, checkpoint reuse, scoped searches and no automatic adjacent work. |
| High | `skills/gm-continue/SKILL.md:8-22,30` | Mandatory callback, any PRD item interpreted as remaining work, and an empty first pass re-enters gm anyway. The later recursion cap conflicts with earlier no-other-exit language. | Optional resume; resolved rows stay resolved; actionable unresolved rows only; empty pass stops immediately, no counter/recursive confirmation. |
| High | `skills/gm/SKILL.md:174-184` | Missing output treated as proof of a running dispatch. Stale claims/crashes can become indefinite polling. | Explicit unknown state, request/owner identity, finite deadline, resume original handle, effect check before retries; quiet output does not authorize a second watcher. |
| High | `skills/gm/SKILL.md:307-316` and CONTRIBUTING | Tests banned, including removal of existing tests. Reliable reusable checks are replaced by repeated exhaustive manual work. | Preserve tests, add regression checks, keep live integration proof distinct from unit/mocked evidence. |
| High | `skills/gm/SKILL.md:8-19,89-93,162-172` | Mandatory tool routing and missing-runner stop make simple work depend on infrastructure; remotely served text can supersede local workflow fixes. | Host tools by default, runtime opt-in, safe conflict reporting, no claim that a skill patch fixes enabled upstream gates. |
| High | `bin/gm-install.js:211-219` | Installing the fork fetches upstream skill text, installs MCP and starts a runner by default, defeating local fixes and adding subprocess/network startup. | Copy bundled fork skills locally; explicit runtime flags; finite child/network budgets; isolated installer verification. |
| High | `.github/workflows/skill-release.yml:4-7,67,79-106` | A skill push triggers version mutation and targets AnEntrypoint/gm rather than this fork. | Manual release, current-repository target, no automated source bump. Site publication also manual. |
| Medium | `README.md:Install` and `.mcp.json` | Universal gm/fan-out advice and implicit MCP registration make lightweight use fragile; docs mix HTTP and stdio claims. | One clear default install path, no implicit clone-time MCP server, transparent advanced-mode/migration limits. |

The visible user incident was repeated unchanged-file inspection after passing checks, with no active subprocess remaining. It is evidence of missing progress/stop discipline, **not proof that the upstream daemon hung**. The baseline prompt contains several mechanisms likely to amplify this behavior; attribution to a particular runtime bug would require a separate live reproduction.

## Acceptance scenarios

| Scenario | Expected behavior | Evidence type |
| --- | --- | --- |
| Small local fix, no runner installed | Use existing host tools; no bootstrap | Static skill contract; actual default installer |
| Two unchanged status/file inspections | Advance to edit/check/new diagnostic/blocker | Static instruction regression (not model benchmark) |
| A command remains running | Keep handle, bounded wait, no duplicate launch | Static instruction/runtime reference regression |
| Missing response or stale claim | Unknown outcome; inspect owner/effects before retry | Static instruction regression |
| User interrupts/resumes | Reuse verified checkpoint, respect cancellation | Static instruction regression |
| No pending work; historical PRD rows exist | Summarize and stop, no confirmation walk | Static continuation regression |
| Existing tests and unrelated dirty work | Preserve; stage only authorized changes | Static policy and actual installer preservation checks |
| Default install into temporary project/home | Bundled fork files, no MCP/runner/config changes | Actual CLI filesystem regression |
| Explicit runtime mode | Finite setup operations; upstream policy not silently rewritten | Source review; full runtime setup not executed |
| Fork release | Manual current-repository publication, no upstream target | Workflow contract check; no release dispatched |

## Verification and limits

Run `npm test` for contract guards and real isolated installer checks. Validate both skill frontmatters with a skill validator. `npm pack --dry-run --ignore-scripts` checks the shipping file list; the cross-platform workflow runs on Linux, Windows and macOS. Report actual provider results separately from local success.

The canonical gm prompt was 31,495 bytes at baseline. The new prompt stays below 10 KB, with optional runtime details loaded only when relevant. This is a measured reduction in mandatory text, not an end-to-end latency or quality benchmark. Prompt checks cannot prove how every model will behave.

This pass does not claim repaired daemon internals, changed remote gm-config policy, validated self-update behavior, or removed old host registrations/global instructions. Those are explicit migration boundaries. Existing runtime users must review them separately; incompatible enforced gates are reported, not bypassed. Other inherited skills and historical runtime/site documentation are not installed by default.

Legacy whole-tree doc drift/prose scans remain available manually because they target the inherited optional runtime and submodules. The new default verification checks the actual default distribution. No failing result is relabeled as a pass; old runtime gates are not a substitute for these checks.
