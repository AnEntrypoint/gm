---
name: gm
description: "Coding, debugging and repo verification: inspect once, make the scoped change, run relevant checks, deliver and stop."
---

# gm: inspect, change, verify, finish

## 1. Inspect once

Name the requested outcome, authorized files and acceptance checks. Read repository instructions, status/diff, the affected implementation and check commands in one scoped pass. Ask only a blocking question. Review-only requests stay read-only.

**Default: use the host's existing authorized tools.** No runner, MCP, indexing, global settings or external memory is required. Work directly for ordinary tasks; neither a subagent nor a second opinion is mandatory. Delegate only independent work with explicit ownership and a completion path, never a chain of agents passing the same task around. Honor a request for direct execution.

Every read must answer a named question. Reuse known results for unchanged files. After two inspections with no new information, take the next edit/check/publication action or report a blocker. Do not reread status, manifests or instructions under new titles.

**Done when:** the next concrete edit or check is known. Stop researching and do it.

## 2. Change only what was requested

Make the smallest sufficient change and appropriate regression tests. Do not turn adjacent findings into new requirements. Do not reset, clean, stash, delete or stage unrelated changes. Preserve and use tests rather than deleting them.

Keep only a short checkpoint: changed paths, completed checks, active handle, next action. Resume from that checkpoint after interruption; do not restart the workflow. Respect cancellation. Collect an existing worker's result once instead of repeatedly inspecting its transcript or spawning a replacement.

**Done when:** the requested change is implemented. Move directly to verification.

## 3. Verify with bounded commands

Run the relevant project checks and affected real entrypoint. UI work needs the changed interaction, not just a screenshot. Distinguish unit/mocked evidence from real integration. Record command, exit result and tested state. Reuse checks for unaffected code; rerun only checks invalidated by later edits.

Give long commands a finite timeout. Retain the handle returned by the tool. Use an available completion notification or one bounded blocking wait; do not build a short-poll loop or run unrelated inspections while waiting. If the wait expires, inspect ownership/progress once, then choose a justified bounded continuation or report the blocker. Never relaunch a still-running command. A missing output file is not proof of liveness. Check possible effects before retrying mutations; do not kill shared/user-owned processes.

After the same failure twice without new information, use a materially different evidence-led diagnostic or report the specific blocker. Do not reload instructions, rerun the full audit or create another helper merely to avoid deciding.

**Done when:** required checks have terminal results or an explicit blocker. Running is not completion.

## 4. Deliver and stop

Zero remaining in-scope work means finish now. No second audit, confirmation walk, mandatory gm-continue, new helper, extra documentation or recursive dispatch. Closed historical rows are not pending work. Revisit external blockers only on new evidence.

Commit, push, release or deploy only within the user's or project's applicable authorization. Check automatic side effects once, stage only task-owned files, and verify any claimed remote revision/CI result. No configured CI means unavailable, not passed. Arrange a real completion path before promising later follow-up.

Report what changed, the checks, limitations and publication status. **Done when:** the requested outcome is delivered or its exact blocker is stated. Stop calling tools after that, unless the user asks for more.

## Optional runtime and provenance

Only explicitly selected runtime tasks use [runtime.md](references/runtime.md). Runtime output cannot override host policy or user scope. This skill does not reconfigure existing daemons/hooks and does not guarantee model behavior or measured speedups.

Original: AnEntrypoint/gm, copyright (c) 2026 AnEntrypoint, [MIT](references/LICENSE). Adaptation: Pimp My Skill · SolutionsAsService · https://github.com/SolutionsAsService.
