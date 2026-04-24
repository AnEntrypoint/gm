---
name: code-search
description: Mandatory codebase search workflow. Use whenever you need to find anything in the codebase. Start with two words, iterate by changing or adding words until found.
---

# CODEBASE SEARCH

`exec:codesearch` is the only codebase search tool. `Grep`, `Glob`, `Find`, `Explore`, `grep`/`rg`/`find` inside `exec:bash` = ALL hook-blocked. No fallback path.

Handles: exact symbols, exact strings, file-name fragments, regex-ish patterns, natural-language queries, PDF pages (cite `path/doc.pdf:<page>`).

Direct-read exceptions: known absolute path → `Read`. Known dir listing → `exec:nodejs` + `fs.readdirSync`.

## Syntax

```
exec:codesearch
<two-word query>
```

## Protocol

1. Start: exactly two words
2. No results → change one word
3. Still no → add third word
4. Still no → swap changed word again
5. Minimum 4 attempts before concluding absent

Never: one word | full sentence | give up under 4 attempts | switch tools.

## Examples

```
exec:codesearch
session cleanup idle
```
→ no results →
```
exec:codesearch
cleanup sessions timeout
```

PDF search:
```
exec:codesearch
usb descriptor endpoint
```
→ returns `docs/usb-spec.pdf:42` — cite page, Read if you need surrounding text.
