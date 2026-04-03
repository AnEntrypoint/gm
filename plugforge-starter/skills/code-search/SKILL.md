---
name: code-search
description: Mandatory codebase search workflow. Use whenever you need to find anything in the codebase. Start with two words, iterate by changing or adding words until found.
---

# CODEBASE SEARCH — Mandatory Workflow

`exec:codesearch` is the only way to search the codebase. Glob, Grep, Find, Explore are hook-blocked.

## Syntax

```
exec:codesearch
<natural language query>
```

## Mandatory Search Protocol

**Start with exactly two words.** Never start broader. Never start with one word.

**Iterate by changing or adding words** — do not switch approach or give up until the content is found:

1. Start: two-word query most likely to match
2. No results → change one word (synonym, related term)
3. Still no results → add a third word (narrow scope)
4. Still no results → swap the changed word again
5. Keep iterating — changing or adding words each pass — until content is found

**Never**: start with one word | start with a sentence | give up after one miss | switch to a different tool | declare content missing after fewer than 4 search attempts

**Each search is one `exec:codesearch` call.** Run them sequentially — use each result to inform the next query.

## Examples

Finding where a function is defined:
```
exec:codesearch
session cleanup idle
```
→ no results →
```
exec:codesearch
cleanup sessions timeout
```
→ found.

Finding config format:
```
exec:codesearch
plugin registration format
```
→ no results →
```
exec:codesearch
plugin config array
```
→ found.
