# 04-STATE

Owned state: none beyond the file text. The edit is a static frontmatter string; replaying it is idempotent (the new text is already present, so a second Edit with the same old_string is refused as absent, and the file stays as witnessed).
