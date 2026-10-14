# 09-DECIDE: BLOCKER-SKILLGM-codesearch-body-schema

session: gm-drain-bounded-15

Outcome: blocked. No new blocker row filed; the open row BLOCKER-SKILLGM-codesearch-body-schema-blocker-gm-drain-w1-28 already names the missing fact.

Live probes this session:
- prd_list {"id":"BLOCKER-SKILLGM-codesearch-body-schema"}: pending, subject asks grep {help:true} to serve body enums and defaults, then delete the SKILL.md table.
- describe("grep"): body_schema.declared=false, note "gm-mcp declares no body schema for this verb".
- codesearch literal "body_schema" in gm-mcp/src: gm-mcp/src/codemode.js:178 `body_schema: schema.declared`. The declaration source is gm-mcp verb-table.js.
- codesearch literal "Code lookup" in skills/gm/docs/verbs.md: line 50 `## Code lookup` exists. The SKILL.md line 46 pointer has a live target, so the w3-47 blocker premise ("pointer needs a target") is refuted.
- skills/gm/SKILL.md section 1 holds no body table (the codesearch bullet points to docs/verbs.md).

Reason: the table-deletion half is already done. The remaining acceptance (grep served body schema with enums and defaults) needs a gm-mcp change. gm-mcp is a dirty submodule with other writers' hunks, so this run did not edit or publish it.

Row text: blocked_by added to .gm/prd/blocker-skillgm-codesearch-body-schema-6bfc25c240b6f844.yml. The row stays pending.

Witness: none issued. No witness dispatch id exists for this run.

Files changed in this run: .gm/prd/blocker-skillgm-codesearch-body-schema-6bfc25c240b6f844.yml (blocked_by line), this receipt.
