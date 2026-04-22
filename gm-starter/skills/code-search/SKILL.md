---
name: code-search
description: Mandatory codebase search workflow. Use whenever you need to find anything in the codebase. Start with two words, iterate by changing or adding words until found.
---

# CODEBASE SEARCH — Mandatory Workflow

**Use gm subagents for all independent work items. Invoke all skills in the chain: planning → gm-execute → gm-emit → gm-complete → update-docs.**


`exec:codesearch` is the only way to search the codebase. **`Grep`, `Glob`, `Find`, `Explore`, and `grep`/`rg`/`find`/`ripgrep` inside `exec:bash` are ALL hook-blocked.** There is no fallback path for exact matches, regex, or file-name patterns — codesearch handles all of them. If you find yourself reaching for Grep or Glob, that reflex is wrong; replace with codesearch.

**What codesearch handles** (every codebase-lookup need lands here):
- Exact identifier / symbol lookup (function names, class names, constants) — symbols are extracted and indexed separately, exact matches rank top.
- Exact string content — query tokens >1 trigger a literal-substring boost in content scoring.
- File-name fragments — file paths are tokenized and matched with a score boost.
- Regex-ish patterns — BM25 tokenization covers snake_case, camelCase, dot/dash splits; matching component words returns the file.
- Natural-language concept queries — BM25 + vector re-ranking handle "find the hook that blocks grep", "where is PR stats calculated", etc.
- PDF pages — specs, papers, manuals, RFCs, datasheets, design docs extracted page-by-page into the same index. Cite `path/to/doc.pdf:<page>`.

**Direct-read exceptions** (no search required):
- Known absolute path → `Read` tool.
- Listing a known directory → `exec:nodejs` + `fs.readdirSync`.

Unscanned digital PDFs are a search gap — if you know a doc exists and it isn't returning, check it is not under an ignored dir and that extraction succeeded (encrypted / image-only PDFs yield empty chunks silently).

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

Finding content inside a spec PDF:
```
exec:codesearch
usb descriptor endpoint
```
→ returns `docs/usb-spec.pdf:42` — cite page, open via Read if you need the surrounding page text.
