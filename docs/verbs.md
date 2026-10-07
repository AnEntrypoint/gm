# gm verb inventory

Every tool an agent uses under gm is a dispatch verb. This file is the inventory: the exact verb
names, which ones answer a code question, the body shape each accepts, and one example each.

Two facts that stop most guessing:

1. **Code lookup exists.** `grep` answers "where is this string", `codesearch` answers "where is
   this concept", `fs_read` reads a file or a line range, and `callers`/`callees`/`impact` walk the
   symbol graph. `recall` is memory only -- it searches `.gm/memories/*.md`, never the tree.
2. **A directory under `.gm/exec-spool/in/` is not evidence that a verb exists.** The spool creates
   `.gm/exec-spool/in/<verb>/` before dispatch, so an unknown verb leaves a directory behind and
   replies `{"ok":false,"error":"unknown verb","error_code":"unknown_verb"}`. Retired verbs leave
   one too. Names seen in that directory but absent from the tables below are not verbs in the
   current build: `glob`, `fs_glob`, `fs_list`, `exec`, `exec_bash`, `similarity`, `git_clone`,
   `git_init`, `git_worktree`, `kv`, `kill-port`, `learn-debug`, `learn-status`,
   `submodule_drift_check`. Reach for `grep` where you would reach for `glob`, `fs_readdir` for
   `fs_list`, and `bash`/`exec_js` with `raw_body` for `exec_bash`.

## Dispatching

Through the MCP tool `gm`:

```
{ "verb": "grep", "session_id": "<your session id>", "cwd": "C:/dev/proj",
  "body": { "pattern": "kLinkQuantum", "output_mode": "content" } }
```

Plain-text-body verbs take `raw_body` instead of `body` (see "Execution" below).

Through the spool directly: write the body to `.gm/exec-spool/in/<verb>/<N>.txt` atomically, then
read `.gm/exec-spool/out/<verb>-<N>.json`. Prefix `N` with a session id.

`cwd` selects the project. `cwd` defaults to the process working directory, and gm resolves the
project root from it with `git rev-parse --show-toplevel`. Where cwd is not itself inside a git
repository, pass `git_root_override` in the body to pin the root.

## Code lookup

### `grep` (alias `rg`) -- where is this string

Exhaustive literal or regex scan, one hit per line, or a comment sweep with `mode:"comments"` (no
`pattern` needed). This is the verb for "where is symbol X
defined" when you know the spelling. `exclude` drops paths by glob -- one glob or an array,
`{"exclude":"vendor/**"}` / `{"exclude":["vendor/**","test/hardware/**"]}` -- so a scan that has to
skip a vendored or generated tree never needs a hand-written brace alternation; `codesearch`
accepts `exclude` under the same aliases.

```
{"pattern":"<text or regex>"}                    required (unless mode:"comments"); "query" is accepted too
{"path":"<dir or file>"}                         narrow the scan to one subtree or one file
{"glob":"**/*.rs"}                               narrow by path glob; "include"/"path_glob" are aliases
{"exclude":["vendor/**","test/hardware/**"]}     drop paths by glob: one glob or an array;
                                                 "exclude_glob"/"exclude_globs" are aliases, and a
                                                 "!"-prefixed entry inside "glob" excludes too
                                                 ({"glob":["**/*.rs","!vendor/**"]}). It comes back
                                                 as "exclude_glob", works under mode:"comments" too,
                                                 and never affects "exhaustive".
{"output_mode":"content"}                        "content" (default): counts[] ({path,count} per file)
                                                 plus output[] (one "path:line: text" per hit);
                                                 "files_with_matches"; "count"
{"detail":true}                                  in "content", answer structured matches[] objects
                                                 instead of output[]
{"columns":true}                                 keep each hit's column; occurrence_count is omitted
                                                 when it is 1
{"regex":true}                                   force regex on/off; unset, the pattern is auto-read
{"fixed_strings":true}                           match the pattern literally, never as a regex
{"case_insensitive":true}                        "ignore_case" is an alias
{"whole_word":true}
{"context":2}                                    include N lines before and after each hit
{"max_results":200}                              hit cap (default 200); aliases: maxResults, limit, max_matches, k
{"max_files":50000}                              file cap (default 50000)
{"refresh":true}                                 re-read from disk: walk instead of `git ls-files --cached`,
                                                 and bypass the mtime-keyed content cache, so uncommitted
                                                 edits and untracked files are visible. "file_source":"disk"
                                                 and "no_cache":true are aliases.
{"no_ignore":true}                               include files .gitignore would hide -- build output, vendored
                                                 trees, scratch scripts the project never committed -- so they
                                                 are listed and scanned like any other file. "include_ignored"
                                                 is an alias. .git is never listed either way.
{"mode":"comments"}                              find comment spans instead of a pattern (no "pattern" needed)
```

The pattern is read as a regex when it carries an alternation bar, a `\d`-style class escape, a
`[a-z]`-shaped range, or an edge anchor. A doubled `||` stays literal. A scan that hit a bound returns `exhaustive: false` and, beside it, `partial: true` with a
`partial_reason` naming the bound that fired, plus `exhaustive_note` on how to reach full coverage:
scope with `path`/`glob` and repeat per subtree.

Example, verified against this repo:

```
{"pattern":"fn (callers|callees|impact|codeinsight)\\(", "regex":true,
 "path":"rs-plugkit/crates/plugkit-core/src/wasm_dispatch/verbs.rs", "output_mode":"content"}
-> counts: [{path, count}, ...], output: ["<path>:<line>: <text>", ...], exhaustive: true
-> with {"detail":true}: matches: [{path, line, match, text, occurrence_count}, ...]
```

`mode:"comments"` returns `comments` and `directives` (`#!/bin/sh` shebangs, `# syntax=docker/...`,
`# shellcheck disable=...` land in `directives`, never in `comments`), plus `comment_count`,
`directive_count`, `files`, `output`, `file_source` and `exhaustive`.

### `codesearch` (aliases `code_search`, `search`) -- where is this concept

The canonical search verb: ranked BM25 plus vector retrieval.

```
{"query":"<text>"}                 required
{"mode":"dual"}                    "dual" (default): ranked BM25+vector retrieval;
                                   "literal"/"regex": exhaustive, every match with path:line, no ranking;
                                   "filename": matches paths only
{"k":10}                           result cap for "dual"; aliases: max_results, maxResults, limit
{"max_matches":1000}               hit cap for the exhaustive modes
{"max_files":50000}                file cap
{"path":"<dir or file>"}           narrow the scan
{"path_glob":"**/*.rs"}            narrow by glob; "glob" is an alias
{"combine":"phrase"}               "phrase" (default for a multi-word query), "and" (every term on one line),
                                   "or" (ranked union of any term)
{"case_insensitive":true, "whole_word":true}
{"refresh":true}                   re-read from disk for the exhaustive modes
{"no_ignore":true}                 include files .gitignore would hide, in every mode: build output,
                                   vendored trees and scratch scripts the project never committed
                                   are listed and scanned like any other file. "include_ignored"
                                   is an alias. .git is never listed either way.
```

Example, verified against this repo:

```
{"query":"verb dispatch table unknown verb", "mode":"dual", "k":3, "path_glob":"**/*.rs"}
-> bm25_hits: [{key, score, symbol:{kind,name,path,line_start,line_end}, text}, ...]
```

`dual` returns `vector_hits`, `bm25_hits`, `phrase_hits` and `commits`, each row carrying `key`,
`text`, `score` and a `symbol` (`{kind, name, path, line_start, line_end}`) when one was indexed.
Note `grep` is not `codesearch` and `search` is `codesearch`, not `grep`.

### `fs_read` -- read a file or a line range

```
{"path":"<relative path>"}     required, relative and within the project
{"offset":0, "limit":200}      read a line range; both clamp to the file's real line count, so an
                               offset past the end returns "" with "returned_lines":0 instead of failing.
                               Omit both for the whole file.
{"max_bytes":65536}            cap the returned chunk; "truncated_at_bytes" reports whether it fired.
{"allowOutsideRoot":true}      opt in to an absolute path outside the project root; required per call.
                               "allow_outside_root" is an alias. A path holding a ".." segment is
                               still refused, so the opt-in widens which root a read may address,
                               never whether it may climb out of one. The host sandbox is a second,
                               independent gate: outside the project root it serves only paths under
                               the user gm root or under a directory it will grant -- it grants the
                               path itself, else its parent directory, when that directory carries a
                               project marker (.git, .gm, package.json, Cargo.toml, go.mod,
                               pyproject.toml). So `C:/Users/user/.codex` is reached through its
                               parent `C:/Users/user`, which makes that parent readable too.
```

Paged replies add `total_lines`, `offset`, `returned_lines` and `has_more_lines`.

Example, verified against this repo:

```
{"path":"README.md", "offset":22, "limit":4}
-> ok:true, total_lines:215, returned_lines:4, has_more_lines:true, content:"curl -fsSL ..."
```

`fs_write` takes `{"path":"<relative path>","content":"<text>"}` (`data` is an alias) and returns
`{"bytes": <written>}`; a write outside the root is refused even with `allowOutsideRoot`, which
widens the read verbs only. `fs_readdir` takes `{"path":"<relative dir>"}` (default `.`). `fs_stat`
takes `{"path":"<relative path>"}`. `fs_readdir` and `fs_stat` take the same
`{"allowOutsideRoot":true}` opt-in as `fs_read`.

### `callers`, `callees`, `impact` -- the symbol graph

Backed by the treesitter index. All three route into the same handler and share these fields:

```
{"symbol":"<name>"}            required; "name" is an alias
{"limit":25}                   row cap (1..200); "k" is an alias
{"root":"<path>"}              another project root; "projectPath" is an alias
{"kind":"<symbol kind>"}       filter (find only)
{"path":"<path>"}              filter; "path_prefix" is an alias (find only)
```

`impact` adds `{"max_depth":3}` and `{"direction":"callers"|"callees"}` (default `callers`, i.e.
upstream). `callers` and `callees` return `symbol`, `defined_at` (one `path:line_start-line_end
<kind>` per definition), `edges` (`<path>:<line> <caller> -> <callee>`), `distinct_callers`,
`total` and `truncated`. `defined_at` is the answer to "where is symbol X defined".

Example, verified against this repo:

```
{"symbol":"dispatch_gated_verb"}
-> defined_at: ["rs-plugkit/crates/plugkit-core/src/wasm_dispatch/verbs.rs:5088-5211 function_item"]
   distinct_callers: 1, total: 1
   edges: ["rs-plugkit/crates/plugkit-core/src/wasm_dispatch/verbs.rs:5014 dispatch_verb_inner -> dispatch_gated_verb"]
```

The graph comes from the treesitter index, so run `codeinsight_index` on a fresh checkout before
trusting an empty reply.

### `codeinsight`, `codeinsight_index` -- index state and symbol overview

`codeinsight` is the same handler with `action:"overview"`. Passing `{"action":"..."}` or
`{"mode":"..."}` selects any of `overview`, `status`, `sync`, `outline`, `find`, `callers`,
`callees`, `impact`, `hotspots`, `orphans`. `outline` requires `path`; `find` requires `symbol`.

`codeinsight_index` builds the index: `{"root":"<path>"}` (`projectPath` is an alias),
`{"max_files":500}`, `{"dead_code":true}`, `{"dead_code_limit":200}`.

## Memory

`recall` searches `.gm/memories/*.md` and its derived vector index. It is namespace-aware, scores
cosine times recency, and does not touch the source tree.

```
{"query":"<text>"}        required
{"limit":8}               row cap
{"namespace":"default"}   memory namespace
```

`memorize` writes to that index: `{"text":"<memo>","namespace":"default"}`, or a raw text body.
`memorize-fire` flushes the corpus, `memorize-prune`, `memorize-vacuum` and `memorize-retention`
maintain it, `forget` removes, `auto-recall` attaches per-prompt recall to an `instruction`.

A `recall` reply carries `hits` (the ranked list) and `vector_hits` (the same rows before scoring).
The MCP wire compactor drops `vector_hits` when every row in it is already in `hits` and names it
in `wire_compacted.omitted`; pass `{"full_response": true}` to the MCP tool to keep both.

## Filesystem

| verb | body | purpose |
|---|---|---|
| `fs_read` | `{"path", "offset"?, "limit"?, "max_bytes"?, "allowOutsideRoot"?}` | read a file or a line range |
| `fs_write` | `{"path", "content"}` | write a file inside the project |
| `fs_readdir` | `{"path"?, "allowOutsideRoot"?}` | list one directory |
| `fs_stat` | `{"path", "allowOutsideRoot"?}` | stat one path |
| `scan_deps` / `scan-deps` | `{}` | supply-chain scan of the dependency tree |

## Execution

`exec_js` (aliases `nodejs`, `javascript`, `node`, `js`) and every language stem --
`bash`, `sh`, `shell`, `zsh`, `python`, `py`, `powershell`, `ps1`, `ssh`, `go`, `rust`, `c`, `cpp`,
`java`, `deno` -- take a **plain text body**, never a JSON object. Pass it as `raw_body`. The first
line is `timeoutMs=<ms>`; it is mandatory for the exec family and defaults to 300000 when absent.
`lang` selects a language stem by name. `filter` compacts stdout (grep, ls, tree, JSON, diff).

```
raw_body: "timeoutMs=30000\nconsole.log(process.version)\n"
```

## Git

`git_status`, `branch_status`, `git_push`, `git_add`, `git_commit`, `git_finalize`, `git_log`,
`git_diff`, `git_show`, `git_fetch`, `git_pull`, `git_poll`, `ci-status` (alias `ci_status`),
`git_branch`, `git_branch_delete`, `git_checkout`, `git_merge`, `git_merge_abort`, `git_stash`,
`git_stash_pop`, `git_stash_drop`, `git_stash_list`, `git_rm`, `git_revert`, `git_reset`,
`git_worktree_add`, `git_worktree_list`, `git_worktree_remove`, `git_worktree_prune`.

Each takes `{}`, or `{"cwd"|"repo"|"root"|"projectPath": "<path>"}` to target another repository.
The git verbs check a clean porcelain status before they run, and a gate can deny any of them; a
denial names the verb to dispatch next.

The four `git_worktree_*` verbs are the sanctioned way to work in an isolated worktree -- never raw
`git worktree` through `bash`:

```
{"path":"C:/dev/proj-sweep","ref":"sweep/comments","create":true}   git_worktree_add: -b <ref> <path>
{"path":"C:/dev/proj-sweep"}                                        git_worktree_add: <path> <HEAD>
{"path":"C:/dev/proj-sweep"}                                        git_worktree_remove (force:true to drop a dirty one)
{}                                                                  git_worktree_list / git_worktree_prune
```

`git_worktree_add` answers `{root, path, branch, created}`; `git_worktree_list` answers
`{count, worktrees:[{path, head, branch, bare, detached, locked, prunable}]}` parsed from
`git worktree list --porcelain`. All four refuse unknown fields, a `path` containing `..`, and a
path under `.gm/` or `.agentplug*`; an absolute path outside the repository root needs
`allowOutsideRoot:true`.

## Web

`serp` (web search), `browser` (headless engine, no Chrome process: navigate, evaluate, DOM query,
markdown extraction), `cdp` (a real Chrome over the DevTools Protocol: screenshots, `capture`,
`profile`, `trace`, `viewport=`). `browser` and `cdp` take a plain-text command body through
`raw_body`. `fetch` takes a JSON body and is HTTP(S)-only.

### `serp` -- web search

A plain text body is the query itself; a JSON body `{"query":"<text>"}` is the same request.

```
raw_body: "RigL dynamic sparse training from scratch"
{"query":"RigL dynamic sparse training from scratch"}
```

It queries DuckDuckGo's lite endpoint over the same HTTP transport `fetch` uses and returns a
compact ranked list, capped at 10 rows with each snippet clipped to 200 characters:

```
-> ok:true, query:"RigL dynamic sparse training from scratch", engine:"duckduckgo-lite",
   status:200, count:10, results:[{title, url, snippet}, ...]
```

A reply with `count: 0` is an error, never an empty answer: the endpoint answered with a bot
challenge page (HTTP 202/403) or the transport failed, and `error` names which. Retry once, then
reach a known URL with `fetch` instead.

## Orchestration and state

These drive the phase machine. Dispatched through the same spool.

`instruction`, `transition`, `transition-revert`, `phase-status`, `residual-scan`, `claim-audit`,
`submodule-check`, `prd-add`, `prd-resolve`, `prd-list`, `prd-defer`, `mutable-add`,
`mutable-resolve`, `mutable-list`, `mutable-defer`, `task-spawn`, `task-list`, `task-stop`,
`task-output`, `memorize-fire`, `memorize-backfill`, `memorize-continue`, `auto-recall`,
`discipline`, `discipline-note`, `discipline-check-removal`, `discipline-audit`, `fsm-vendor`,
`fsm-validate`, `fsm-propose-override`, `predicates-md`, `capability-resolve`,
`memory-namespace-audit`, `codeinsight-namespace-audit`, `calculus-model-check`,
`component-loader-reconcile`, `component-loader-hmr`, `dream-policy-register`,
`dream-evaluator-receipt`, `dream-discovery-record`, `dream-world-seal`, `dream-replay`,
`dream-replay-round`.

`instruction` is the entry point: it serves the prose for the current phase and a gate denial names
the recovery verb. A long idle gap makes every other verb return
`gate_denied` / `long-gap-no-instruction` until `instruction` is dispatched again.

## Storage, cache and diagnostics

`sql_open`, `sql_close`, `sql_list_dbs`, `sql_exec`, `sql_query`, `sql_smoke`, `sql_serialize`,
`sql_deserialize`, `cache_get`, `cache_put`, `cache_invalidate`, `cache_stats`, `kv_get`, `kv_put`,
`kv_query`, `env_get`, `health`, `status`, `close`, `config_resolve`, `config-sync-now`,
`dataflow_resolve`, `tencentdb-compat-probe`, `tencentdb-memory-import`.

`wait` and `sleep` return `unsupported_by_design`: wasm has no real timer here. `learn` is retired.

## Two verbs the native host answers

The agentplug daemon, not the gm plugin, handles these:

| verb | purpose |
|---|---|
| `background-convert` | run a conversion off the dispatch thread |
| `plugin-refresh` | force the plugin and runner update poll to fire on the next loop tick |

## Getting a verb's own documentation

Six verbs publish their parameter doc: pass `{"help": true}` as the body of `grep`, `codesearch`,
`fs_read`, `fs_write`, `fs_readdir` or `fs_stat` and the reply is
`{"help": true, "verb": ..., "parameters": "<doc>"}`. Any other verb replies with an error naming
the fields it accepts once you pass it a body it rejects.
