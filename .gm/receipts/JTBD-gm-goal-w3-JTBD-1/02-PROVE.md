# 02-PROVE

Precondition: `skills/gm-hop/SKILL.md` exists; frontmatter `name: gm-hop`. Verified (exec_js dispatch 1791958607200-500-b26c506038b07bcc: nameOk true).

Invariant: name unchanged; no BOM (bom false); body unchanged except the description line.

Postcondition: description opens with a trigger clause ("Use when a gm walk must ...") and states the outcome ("returns one receipt naming the next principle, so the traversal advances ..."). Verified by the same dispatch: useWhen true, outcomeClause true.

Leader probe: the hypothesis "description omits trigger situation" predicted useWhen false on the pre-edit text. The pre-edit line (read at SPECIFY) begins "One traversal hop:" and has no "Use when", so the probe separates the leader from the rival "description already complete". Rival refuted by the pre-edit read.

Installed copy: `~/.claude/skills/gm-hop/SKILL.md` equals the source (installedMatchesSource true), so the edit is served on the next dispatch.

Witness dispatch: 1791958607200-500-b26c506038b07bcc.
