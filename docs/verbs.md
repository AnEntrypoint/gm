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
   `git_init`, `kv`, `kill-port`, `learn-debug`, `learn-status`,
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

The watcher launch command is in `skills/gm/spool-adapter.md`.

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
{"refresh":true}                                 re-read from disk: walk instead of `git ls-files` (tracked
                                                 plus untracked files git does not ignore), and bypass the
                                                 mtime-keyed content cache. An unscoped walk also skips noise
                                                 and hidden directories, so its file set can be smaller.
                                                 "file_source":"disk" and "no_cache":true are aliases.
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

Comment syntax is mapped per extension. JS-family files (`.js`, `.ts`, `.rs`, `.go`, `.c`, ...) take `//` and `/* */`, and their string, regex and template-literal bodies are never comments; `${...}` interpolations are code. CSS takes `/* */` only. Shell, YAML, TOML, Python and similar take `#`. HTML takes `<!-- -->` plus the `<script>` and `<style>` bodies. WebAssembly text takes `;;` and `(; ;)`. A `.template` file takes the syntax of its stem. Only shebangs and tool pragmas land in `directives`. A file with no mapping is counted in `files_skipped_no_syntax_count`; `files_skipped_no_syntax` holds a sample and `files_skipped_no_syntax_file` (when present) lists every such path.

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
{"no_ignore":true}                               include files .gitignore would hide, in every mode: build output,
                                                 vendored trees and scratch scripts the project never committed
                                                 are listed and scanned like any other file. "include_ignored"
                                                 is an alias. .git is never listed either way.
```

Example, verified against this repo:

```
{"query":"verb dispatch table unknown verb", "mode":"dual", "k":3, "path_glob":"**/*.rs"}
-> bm25_hits: [{key, score, symbol:{kind,name,path,line_start,line_end}, text}, ...]
```

`dual` on a multi-word query returns compact `hits` rows `{at, sym, snip, lit}`, where `lit` is true when the row holds the query verbatim. Doc sections are hidden and counted in `docs_hidden`, and `commits` is omitted, unless `docs: true`. Hits are nearest neighbours, so a term absent from every hit is not proven absent: `literal` decides it. Commit hits are leads, confirmed with `git_show`. Each raw row carries `key`, `text`, `score` and a `symbol` (`{kind, name, path, line_start, line_end}`) when one was indexed.
Four modes: `dual` ranks; `literal` and `regex` are exhaustive and read the tree directly, answering in about
one second on a large workspace where `dual` costs minutes; `filename` matches paths only. An unknown `mode`
is an error that names the valid set, never a silent `dual`. A `dual` query that is one identifier-shaped
token (3-96 characters) is answered by an exhaustive whole-word scan: `mode: "symbol"` lists `definitions`
before `references`, and a miss retries as `symbol_substring`. `verbose: true` returns the raw `bm25_hits`,
`vector_hits` and `commits` channels.
Completeness: a `literal` or `regex` reply is complete only when it carries `exhaustive: true`. `partial_reason`
names the bound or skip that fired (`matches_truncated`, `files_truncated`, `budget_exhausted`,
`files_skipped_too_large`, `files_unreadable`, `git_listing_incomplete`, `walk_listing_incomplete`,
`excluded_by_rule`, `glob_matched_no_files`). Rule exclusions (`excluded_by_rule`, `excluded_by_rule_count`)
never affect `exhaustive`. Missing optional diagnostics never prove completeness.

Scope: `literal` and `regex` scan git's view of the worktree (`file_source: "git"`): tracked files, submodule
contents, and untracked files git does not ignore. A `root` or `path` naming a gitignored directory or a folder
outside any git worktree is walked instead (`file_source: "walk"`, with `walk_reason`). `path_glob` is a real
glob (`**/*.{js,mjs}`), matched case-insensitively; a glob that admits no file sets `glob_matched_no_files: true`
and `exhaustive: false`. `timeout_ms` bounds the scan (default 20000 for regex); an overrun answers
`timed_out: true`, `exhaustive: false` and `budget_ms`. Past `max_chars` (24000) the rest spills to
`spill_file` with `reply_truncated: true`. `output` is `matches` (default), `compact` (`path:line: text`),
`files` or `count`.

Query and body: `query` is required in every mode; `pattern` and `literal` are not fields. Any other body
field is refused with the supported list, and `path` or `glob` sent to `dual` is refused, so a scope never
silently widens. A multi-word query matches as one phrase; `combine: "or"` ranks any-term hits with all-term
lines first, and `combine: "and"` requires every term on one line. `term_combination` names the reading that
ran. A `regex` query carrying a metacharacter is matched as one regular expression, and `combine` has no
effect on it. Give the result limit as `max_results` or `k`, never both with different values.

`grep` answers the same way: its reply's `mode` names the reading that ran, and a pattern that will not
compile is refused with the regex error text rather than an empty result.

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

`fs_write` takes `{"path":"<relative path>","content":"<text>"}`. `data` and `text` are aliases of
`content`, and the value may be a JSON string (with `\n` for each newline) **or an array of lines**,
which is joined with `\n` plus a trailing newline. A raw, non-JSON body is accepted too when its
first line is a `path=<relative path>` directive and everything after it is the file contents. There
is no append mode: a write replaces the whole file. It returns `{"bytes": <written>}`; a write outside
the root is refused even with `allowOutsideRoot`, which widens the read verbs only. `fs_readdir` takes `{"path":"<relative dir>"}` (default `.`). `fs_stat`
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
| `fs_write` | `{"path", "content"}` (string or array of lines) | write a file inside the project (replaces; no append) |
| `fs_readdir` | `{"path"?, "allowOutsideRoot"?}` | list one directory |
| `fs_stat` | `{"path", "allowOutsideRoot"?}` | stat one path |
| `scan_deps` / `scan-deps` | `{}` | supply-chain scan of the dependency tree |

## Execution

`exec_js` (aliases `nodejs`, `javascript`, `node`, `js`) and every language stem --
`bash`, `sh`, `shell`, `zsh`, `python`, `py`, `powershell`, `ps1`, `ssh`, `go`, `rust`, `c`, `cpp`,
`java`, `deno` -- take a **plain text body**, never a JSON object. Pass it as `raw_body`. The optional
first line `timeoutMs=<ms>` is an enforced wall-clock limit (default 300000, hard ceiling 900000).
`lang` selects a language stem by name. `filter` compacts stdout (grep, ls, tree, JSON, diff).

```
raw_body: "timeoutMs=30000\nconsole.log(process.version)\n"
```

`exec_js` evaluates its raw body in a separate Node process, delivered on the child's stdin, so the body is never part of its command line and a process-listing query that filters command lines for a marker string cannot match the runner itself. It does not inject the caller's `tools` object. A `.js` scratch file in a repo whose package.json says `"type": "module"` is ESM: give a scratch file that uses `require` the `.cjs` extension. To run a command, use Node's argument-safe API: `const { execFileSync } = require("node:child_process"); return execFileSync("command", ["arg"], { encoding: "utf8" });`.

At `timeoutMs` expiry the child's whole process tree is killed, the dispatch slot is released, and the reply is `ok: false, timed_out: true, killed: true, error_code: exec_timeout` with `limit_ms` and the partial `stdout`/`stderr`; nothing keeps running afterwards. The MCP wrapper polls for that budget plus 5 s when `timeout_seconds` is omitted; an explicit `timeout_seconds` sets the requested polling budget. Every MCP call caps applied polling at 240 s without changing the native execution limit. A polling timeout returns the original task handle: pass it as `resume_task` to re-poll that dispatch without redispatching.

A server that must outlive the call is started detached: `spawn(process.execPath, [script], {detached: true, stdio: "ignore", windowsHide: true}).unref()` survives the call and is stopped in a later call by its pid; never pass `stdio: "inherit"`.

Output fields (`stdout`, `stderr`, `result`, a structured `result` included) show up to 16000 characters; a longer field ends in `OUTPUT TRUNCATED` naming `result_file`, a plain text file (`## result`, `## stdout`, `## stderr` sections, un-escaped) that can be read directly. Use a language verb such as `bash` only when the request specifically needs shell syntax.

## Git

`git_status`, `branch_status`, `git_push`, `git_add`, `git_commit`, `git_finalize`, `git_log`,
`git_diff`, `git_show`, `git_fetch`, `git_pull`, `git_poll`, `ci-status` (alias `ci_status`),
`git_branch`, `git_branch_delete`, `git_checkout`, `git_merge`, `git_merge_abort`, `git_stash`,
`git_stash_pop`, `git_stash_drop`, `git_stash_list`, `git_rm`, `git_revert`, `git_reset`,
`git_reset_head`, `git_worktree_add`, `git_worktree_list`, `git_worktree_remove`, `git_worktree_prune`.

`git_reset_head` moves HEAD backward without touching the worktree -- `{"count":1}` or `{"to":"<rev>"}`,
`mode` `mixed` (default) or `soft`. It refuses when the commit at HEAD is reachable from any
`refs/remotes/` ref (`pushed_commit_refused`), when the index holds staged paths not named by the
request (`staged_paths_present`, overridden by `allow_staged:true`), and when the target is not an
ancestor of HEAD. `git_commit {"amend":true}` rewrites the current commit instead of stacking a
child, and refuses when that commit is already published (`pushed_commit_refused`).

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

### `git_worktree` — linked checkouts

| action | body | result |
|---|---|---|
| list | `{"action":"list"}` | `worktrees` from Git's NUL-delimited porcelain records |
| add | `{"action":"add","path":"/absolute/checkout","ref":"HEAD","detach":true}` | `added`, `ref`, `detached` |
| remove | `{"action":"remove","path":"/absolute/checkout"}` | `removed` |

Add defaults to a detached checkout at `HEAD`. Set `detach:false` with an existing local branch name to attach it. Remove supplies no force flag: Git refuses dirty or locked worktrees. Each action rejects unknown fields; repository selectors and session fields are accepted. Relative paths resolve against the selected repository.

Enabling `extensions.worktreeConfig` requires moving common `core.worktree` into the primary `config.worktree`; move `core.bare` there if true. Preserve the primary path semantics, then use `git config --worktree` for per-worktree author configuration. Verify `git rev-parse --show-toplevel` in both checkouts. A common `core.worktree` with the extension enabled can send subsequent GM dispatches to an administrative gitdir.

## Web

`fetch` takes a JSON body and is HTTP(S)-only.

### `crawl` -- browse pages through one of two engines

`crawl` takes a **plain text body**, never a JSON object. Pass it as `raw_body`. The first line
selects the engine; the rest is the crawl request (URLs and steps).

| engine | runs | window |
|---|---|---|
| `cdp` (default when the first line is absent) | the host drives a real Chrome over CDP through its `crawl_cdp` entry point | **HEADFUL**: a visible browser window |
| `lightpanda` | the host's warm lightpanda process, through the `lightpanda` plugin's `crawl` verb | **HEADLESS**: no window |

Lightpanda is HEADLESS and cdp is HEADFUL. Choose `lightpanda` when no window should appear;
choose `cdp` when the page must render in a visible browser.

```
raw_body: "engine=cdp\nhttps://example.com/\n"
raw_body: "engine=lightpanda\nhttps://example.com/\n"
```

The reply is the host's JSON object, passed through unchanged: `ok`, `engine`, `headless`,
`stdout`, `stderr`, `exit_code`, `duration_ms`, and any further fields the host adds. An unknown
engine answers `ok: false` with `error_code: "unknown_engine"`, naming `cdp` and `lightpanda`.

The standalone `cdp` verb is removed; `crawl` with `engine=cdp` replaces it.

### Browser steps for `engine=cdp`

A `cdp` body may open with `session=<name>`, then one step per line. The steps reimplement the documented behaviour of [chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp) (Apache-2.0) over the shared headful Chrome lease, so every step runs in a visible window.

- `session=<name>` (1-64 letters, digits, `-`, `_`) keeps the tab and its uid map across calls, in `.gm/crawl-cdp-sessions/<name>.json`. Calls on one session are serialized. A corrupt state file is refused, never reset.
- A session's tab lives as long as the shared Chrome, which closes 15 minutes after its last lease. Without `session=`, a call opens its own tab and closes it when it ends.

| Step | Does |
|---|---|
| `url=<url>`, or a bare URL | navigate and wait for the load |
| `snapshot` | accessibility tree; each element line starts `uid=N` |
| `click=<uid>`, `dblclick=<uid>`, `hover=<uid>` | mouse input at the element's centre |
| `click_at=<x>,<y>` | mouse click at CSS pixels |
| `fill=<uid> <value>` | text replaces the value; a select takes an option's value or label; a checkbox or radio takes `true` or `false` |
| `type=<text>` | key events into the focused element |
| `press=<key>` | `Enter`, `Tab`, `Escape`, arrows, `Home`, `End`, `F1`-`F12`, `Control+A`, `Control++` |
| `upload=<uid> <path>[;<path>]` | file input |
| `wait_for=<text>` | until the page shows the text |
| `reload`, `back`, `forward` | navigate |
| `console` | console messages, uncaught errors and dialogs |
| `network`, `network=<reqid>` | requests; one request with its headers and body |
| `dialog=accept\|dismiss` | policy for JavaScript dialogs; default accept |
| `screenshot=<path>`, `screenshot_full=<path>`, `screenshot_uid=<uid> <path>` | PNG, or `.jpg` / `.webp` by extension |
| `trace_start`, `trace_stop[=<path>]` | performance trace; the reply carries a summary; a `.gz` path compresses |
| `eval=<js>` | page script; returns its value |

A uid is the number a snapshot printed for an element. It stays with that element across re-snapshots and across calls on the same session. A uid that no snapshot of the session has printed is refused with an error. Console and network capture start when a call attaches. Chrome replays a tab's earlier console messages on attach; network events are seen from attach onward.

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

Pass the `instruction_hash`/`policy_hash` of the prior `instruction` response back as `known_instruction_hash`/`known_policy_hash` in the new body. An unchanged match suppresses the prose and discipline-policy blocks from the reply (`instruction_unchanged`/`discipline_policies_unchanged: true`, fields omitted); a mismatch or first dispatch returns them in full. Assert only a hash read off a response actually received. This is a response-size optimization only: phase, PRD, mutables and recall data return every time.

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
