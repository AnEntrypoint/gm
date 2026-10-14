# PROVE

Precondition: row pending, tree clean for the four gm skill paths (dispatch 1791957423454-500-7b3ca1654e3ecf1d).
Invariant: SKILL.md header routes to section files by name.
Postcondition checks run:
1. fs_stat skills/gm/SKILL.md: size 22588, isFile true (dispatch 1791957373403-500-bc63b8e6c4af3da4). Bytes below 28466: PASS.
2. codesearch heading inventory across skills/gm: 45 headings, exhaustive true (dispatch 1791957380960-500-928305d51026e661). Header line 10 names docs/rationale.md, docs/verbs.md, spool-adapter.md: PASS.
3. Live gm trigger: instruction dispatch returned ok true with the routing payload, not an error (dispatch 1791957410871-500-bfd4c547eb059bc9): PASS.
Leader probe separation: H2 predicted SKILL.md would still hold verb grammars; the heading inventory shows none, so H2 is refuted by a run.
