# RES

Failure modes run:
- SKILL.md missing: fs_stat would error. It returned a file. Not triggered.
- Routing reply absent: instruction returned ok true with routing content. Not triggered.
- Partial failure (size below 28 KB but a reference dangling): references in header resolve to existing files (fs_stat via codesearch hits on each named path). Not triggered.
