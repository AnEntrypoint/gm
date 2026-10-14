# 07-RES

Failure modes run:
- Frontmatter YAML breakage: description still a double-quoted scalar on one line; name line intact (witness nameOk true).
- Installed copy drift: installedMatchesSource true (witness).
- Partial failure (edit landed, witness absent): the witness dispatch is held, so the change is not reverted.
- The skill-listing description is served to matching; the new text contains no double quote inside the scalar.
