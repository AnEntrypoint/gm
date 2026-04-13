---
name: update-docs
description: UPDATE-DOCS phase. Refresh README.md, AGENTS.md, and docs/index.html to reflect changes made this session. Commits and pushes doc updates. Terminal phase — declares COMPLETE.
---

# GM UPDATE-DOCS — Documentation Refresh

You are in the **UPDATE-DOCS** phase. Feature work is verified and pushed. Refresh all documentation to match the actual codebase state right now.

**GRAPH POSITION**: `PLAN → EXECUTE → EMIT → VERIFY → [UPDATE-DOCS] → COMPLETE`
- **Entry**: Feature work verified, committed, and pushed. Entered from `gm-complete`.

## TRANSITIONS

**FORWARD**: All docs updated, committed, and pushed → COMPLETE (session ends)

**BACKWARD**:
- Diff reveals unknown architecture change → invoke `planning` skill, restart chain
- Doc write fails post-emit verify → fix and re-verify before advancing

## EXECUTION SEQUENCE

**Step 1 — Understand what changed**:

```
exec:bash
git log -5 --oneline
git diff HEAD~1 --stat
```

Witness which files changed. Identify doc-sensitive changes: new skills, new states in the state machine, new platforms, modified architecture, new constraints, renamed files.

**Step 2 — Read current docs**:

```
exec:nodejs
const fs = require('fs');
['README.md', 'AGENTS.md', 'docs/index.html',
 'gm-starter/agents/gm.md'].forEach(f => {
  try { console.log(`=== ${f} ===\n` + fs.readFileSync(f, 'utf8')); }
  catch(e) { console.log(`MISSING: ${f}`); }
});
```

Identify every section that no longer matches the actual codebase state.

**Step 3 — Write updated docs**:

Write only sections that changed. Do not rewrite unchanged content. Rules per file:

**README.md**: platform count matches adapters in `platforms/`, skill tree diagram matches current state machine, quick start commands work.

**AGENTS.md**: Launch memorize sub-agent in background with session learnings. Do not inline-edit AGENTS.md — the memorize agent handles extraction, deduplication, and writing. Use: `Agent(subagent_type='memorize', model='haiku', run_in_background=true, prompt='## CONTEXT TO MEMORIZE\n<session learnings>')`

**docs/index.html**: `PHASES` array matches current skill state machine phases. Platform lists match `platforms/` directory. State machine diagram updated if new phases added.

**gm-starter/agents/gm.md**: Skill chain on the `gm skill →` line updated if new skills were added.

```
exec:nodejs
const fs = require('fs');
fs.writeFileSync('/abs/path/file.md', updatedContent);
```

**Step 4 — Verify from disk**:

```
exec:nodejs
const fs = require('fs');
const content = fs.readFileSync('/abs/path/file.md', 'utf8');
console.log(content.includes('expectedString'), content.length);
```

Witness each written file from disk. Any variance from expected content → fix and re-verify.

**Step 5 — Commit and push**:

```
exec:bash
git add README.md docs/index.html gm-starter/agents/gm.md
git diff --cached --stat
```

Witness staged files. Then commit and push:

```
exec:bash
git commit -m "docs: update documentation to reflect session changes"
git push -u origin HEAD
```

Witness push confirmation. Zero variance = COMPLETE.

## DOC FIDELITY RULES

Every claim in docs must be verifiable against disk right now:
- State machine phase names must match skill file `name:` frontmatter
- Platform names must match adapter class names in `platforms/`
- File paths must exist on disk
- Constraint counts must match actual constraints

If a doc section cannot be verified against disk: remove it, do not speculate.

## CONSTRAINTS

**Never**: skip diff analysis | write docs from memory alone | push without verifying from disk | add comments to doc content | claim done without witnessed push output

**Always**: witness git diff first | read current file before overwriting | verify each file from disk after write | push doc changes | confirm with witnessed push output

---

**→ COMPLETE**: Docs committed and pushed → session ends.
**↩ SNAKE to PLAN**: New unknown about codebase state → invoke `planning` skill.
