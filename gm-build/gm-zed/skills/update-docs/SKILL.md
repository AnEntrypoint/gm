---
name: update-docs
description: UPDATE-DOCS phase. Refresh README.md, AGENTS.md, and docs/index.html to reflect changes made this session. Commits and pushes doc updates. Terminal phase — declares COMPLETE.
---

# GM UPDATE-DOCS

GRAPH: `PLAN → EXECUTE → EMIT → VERIFY → [UPDATE-DOCS] → COMPLETE`
Entry: feature verified, committed, pushed. From `gm-complete`.

**FORWARD**: docs updated + committed + pushed → COMPLETE
**BACKWARD**: unknown architecture change → `planning`

## Sequence

**1 — What changed**:
```
exec:bash
git log -5 --oneline
git diff HEAD~1 --stat
```

**2 — Read current docs**:
```
exec:nodejs
const fs = require('fs');
['README.md', 'AGENTS.md', 'docs/index.html', 'gm-starter/agents/gm.md'].forEach(f => {
  try { console.log(`=== ${f} ===\n` + fs.readFileSync(f, 'utf8')); }
  catch(e) { console.log(`MISSING: ${f}`); }
});
```

**3 — Write changed sections only**:

- **README.md**: platform count, skill tree diagram, quick start commands
- **AGENTS.md**: via memorize sub-agent only — never inline-edit. `Agent(subagent_type='gm:memorize', model='haiku', run_in_background=true, prompt='## CONTEXT TO MEMORIZE\n<learnings>')`
- **docs/index.html**: `PHASES` array, platform lists, state machine diagram
- **gm-starter/agents/gm.md**: skill chain line if new skills added

**4 — Verify from disk**:
```
exec:nodejs
const content = require('fs').readFileSync('/abs/path/file.md', 'utf8');
console.log(content.includes('expectedString'), content.length);
```

**5 — Commit and push**:
```
exec:bash
git add README.md docs/index.html gm-starter/agents/gm.md
git commit -m "docs: update documentation to reflect session changes"
git push -u origin HEAD
```

## Fidelity Rules

Every claim verifiable against disk: phase names match frontmatter, platform names match `platforms/`, file paths exist, constraint counts accurate. Unverifiable section → remove, don't speculate.

**Never**: write from memory | push without disk verify | add comments | claim done without witnessed push
**Always**: git diff first | read before overwriting | verify after write | push
