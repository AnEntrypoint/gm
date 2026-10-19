# gm verb inventory

Every operation an agent runs under gm is a dispatch verb, a named operation such as `codesearch` or `fs_read`. This file is the inventory: the exact verb
names, which ones answer a code question, the body shape each accepts, and one example each. Each section marks its verbs as
`query` (no observable side effect) or `command` (changes state).

Two facts that stop most guessing:

1. **Code lookup exists.** `grep` answers "where is this string", `codesearch` answers "where is
   this concept", `fs_read` reads a file or a line range, and `callers`/`callees`/`impact` walk the
   symbol graph (the call graph that `codeinsight_index` builds).
2. **A directory under `.gm/exec-spool/in/` is not evidence that a verb exists.** The spool creates
   `.gm/exec-spool/in/<verb>/` before dispatch, so an unknown verb leaves a directory behind and
   replies `ok: false`, `error_code: unknown_verb`, and an `error` that begins `unknown verb:`. Retired verbs leave
   one too. Names seen in that directory but absent from the tables below are not verbs in the
   current build: `glob`, `fs_glob`, `fs_list`, `fs_delete`, `fs_remove`, `exec`, `exec_bash`,
   `similarity`, `git_clone`, `kv`, `kill-port`, `learn-debug`, `learn-status`,
   `submodule_drift_check`. Use `grep` in place of `glob`, `fs_readdir` in place of
   `fs_list`, and `bash` or `exec_js` with `raw_body` in place of `exec_bash`. There is no delete verb: remove
   a file inside the project with `exec_js` (`require('fs').rmSync(<relative path>)`).

## Dispatching

Through the MCP tool `gm_codemode`, the only tool the server registers. Each verb is a function on `gm` inside the code body:

```
gm_codemode({ "code": "return await gm.codesearch({body: {query: \"kLinkQuantum\", mode: \"literal\", path: \"src\"}})",
  "cwd": "C:/dev/proj" })
```

Plain-text-body verbs take `raw_body` instead of `body` (see the "Execution" section below).

Through the spool directly: write the body to `.gm/exec-spool/in/<verb>/<N>.txt` atomically, then
read `.gm/exec-spool/out/<verb>-<N>.json`. Make `N` `<session id>-<counter>`, never a bare integer, so two sessions cannot collide.

The launch command for the spool watcher (`agentplug-runner spool`) is in `skills/gm/spool-adapter.md`, under its Starting the watcher heading.

`cwd` selects the project. Without `cwd`, gm uses `GM_MCP_DEFAULT_CWD` or `CLAUDE_PROJECT_DIR`, else the process working directory when it is a git root, and refuses with `error: "cwd-required"` otherwise. gm resolves the
project root from it with `git rev-parse --show-toplevel`. A cwd outside any git
repository is its own root. A body field `git_root_override` pins the root for any verb.

`bin/gm` is the shell entrypoint: `gm <verb> [flags]` forwards to gm-mcp's own `dispatch`
subcommand, so a plain shell runs a verb without an MCP client or a daemon of its own.
Search verbs also take a shorter command-line form: `gm codesearch literal <needle> --path <dir> --glob <glob>`. It builds `{"query","mode"}` plus `path`, with `--glob` as `path_glob`. The shorter form exists because a bare mode word such as `literal` is not a dispatch body. It applies to `grep`, `rg`, `codesearch`, `code_search` and `search` only.

Inside `gm_codemode`, `gm.grep` and `gm.codesearch` are the functions on `gm` for the search verbs. `rg`, `code_search` and `search` are not functions on `gm`, and `gm.list()` does not list them.

Any argument starting with `{` or `@`, and every non-search invocation, is forwarded untouched, so the launcher never reinterprets a real dispatch. `--cwd`, `--timeout` and `--no-ignore` stay dispatch flags, never body fields. `bin/gm` is exposed for `npm link` as `gm-dispatch`.

## Code lookup

Every verb in this section is `query` except `codeinsight_index` and `codeinsight` with `action` `sync`, which are `command` (they build or refresh the index).

### `grep` (dispatch alias `rg`): where is this string

Exhaustive literal or regex scan, one hit per line, or a comment sweep with `mode:"comments"` (no
`pattern` needed). Use `grep` for "where is symbol X
defined" when you know the spelling. `exclude` drops paths by glob: one glob or an array,
`{"exclude":"vendor/**"}` / `{"exclude":["vendor/**","test/hardware/**"]}` , so a scan that has to
skip a vendored or generated tree never needs a hand-written brace alternation; `codesearch`
accepts `exclude` under the same aliases.

```
{"pattern":"<text or regex>"}                    required (unless mode:"comments"); "query" is accepted too
{"mode":"pattern"}                               default: a pattern with regex metacharacters reads as a regex;
                                                 "literal" matches verbatim, "regex" always compiles,
                                                 "comments" sweeps comments; an output shape ("content",
                                                 "files", "files_with_matches", "count") as mode sets output_mode;
                                                 "dual"/"filename" are refused with a pointer to codesearch
{"path":"<dir or file>"}                         narrow the scan to one subtree or one file
{"glob":"**/*.rs"}                               narrow by path glob; "include"/"path_glob" are aliases
{"exclude":["vendor/**","test/hardware/**"]}     drop paths by glob: one glob or an array;
                                                 "exclude_glob"/"exclude_globs" are aliases, and a
                                                 "!"-prefixed entry inside "glob" excludes too
                                                 ({"glob":["**/*.rs","!vendor/**"]}). The reply reports the exclude value
                                                 as "exclude_glob", works under mode:"comments" too,
                                                 and never affects "exhaustive".
{"output_mode":"content"}                        "content" (default): counts[] ({path,count} per file)
                                                 plus output[] (one "path:line: text" per hit);
                                                 "files_with_matches" ("files" is accepted as an alias); "count"
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
                                                 content cache keyed by file modification time (mtime). An unscoped walk also skips noise
                                                 and hidden directories, so its file set can be smaller. Gitignored trees (target/, weights/) are never listed by the git scan, so a `.codesearchignore` rule over them is witnessed only by a refresh walk.
                                                 "file_source":"disk" and "no_cache":true are aliases.
{"no_ignore":true}                               include files .gitignore would hide: build output, vendored
                                                 trees, scratch scripts the project never committed, so they
                                                 are listed and scanned like any other file. "include_ignored"
                                                 is an alias. .git is never listed either way.
{"mode":"comments"}                              find comment spans instead of a pattern (no "pattern" needed)
```

The pattern is read as a regex when it carries a `|`, a `\d`-style class escape, a
`[a-z]`-shaped range, or an edge anchor (a leading `^` or a trailing `$`). A doubled `||` stays literal. A scan that reaches a limit returns `exhaustive: false` and, beside it, `partial: true` with a
`partial_reason` naming the limit that fired, plus `exhaustive_note` on how to reach full coverage:
scope with `path`/`glob` and repeat per subtree.

Example:

```
{"pattern":"fn (callers|callees|impact|codeinsight)\\(", "regex":true,
 "path":"rs-plugkit/crates/plugkit-core/src/wasm_dispatch/verbs.rs", "output_mode":"content"}
-> counts: [{path, count}, ...], output: ["<path>:<line>: <text>", ...], exhaustive: true
-> with {"detail":true}: matches: [{path, line, match, text, occurrence_count}, ...]
```

`mode:"comments"` returns `comments` and `directives` (`#!/bin/sh` shebangs, `# syntax=docker/...`,
`# shellcheck disable=...` land in `directives`, never in `comments`), plus `comment_count`,
`directive_count`, `files`, `output`, `file_source` and `exhaustive`. `glob` (one string or an array,
with `!` entries excluded) and `output_mode` apply here too: `files_with_matches` and `count` drop
`comments`, `directives` and `output`, keeping `files`, the counts and `file_source`.

Comment syntax is mapped per extension. JS-family files (`.js`, `.ts`, `.rs`, `.go`, `.c`, ...) take `//` and `/* */`, and their string, regex and template-literal bodies are never comments; `${...}` interpolations are code. CSS takes `/* */` only. Shell, YAML, TOML, Python and similar take `#`. HTML takes `<!-- -->`. WebAssembly text takes `;;` and `(; ;)`. A `.template` file takes the syntax of its stem. A file with no mapping is counted in `files_skipped_no_syntax_count`; `files_skipped_no_syntax` holds a sample and `files_skipped_no_syntax_file` (when present) lists every such path.

### `codesearch` (aliases `code_search`, `search`): where is this concept

The canonical search verb: ranked BM25 plus vector retrieval.

```
{"query":"<text>"}                 required
{"mode":"dual"}                    "dual" (default): ranked BM25+vector retrieval, except a single
                                   identifier-shaped token (3-96 characters) routes to mode "symbol" (see below);
                                   "literal"/"regex": exhaustive, every match with path:line, no ranking;
                                   "filename": matches paths only
{"k":10}                           result cap for "dual"; aliases: max_results, maxResults, limit
{"max_matches":1000}               hit cap for the exhaustive modes: it caps the rows returned,
                                   never the files scanned: every file in scope is still read,
                                   and the cap is off by default
{"max_files":50000}                file cap
{"path":"<dir or file>"}           narrow the scan
{"paths":["skills/gm/SKILL.md","skills/gm/docs/"]}    narrow it to exactly those files and directories; "files" is an alias
{"exclude":["vendor/**"]}          drop paths from the scan: one glob or a list of them, matched like
                                   "glob", so name a whole tree as "vendor/**"; "exclude_glob" and
                                   "exclude_globs" are aliases
{"path_glob":"**/*.rs"}            narrow by glob; "glob" is an alias
{"combine":"phrase"}               "phrase" (default for a multi-word query), "and" (every term on one line),
                                   "or" (ranked union of any term)
{"case_insensitive":true, "whole_word":true}     literal and regex are case-SENSITIVE by default; "case_insensitive" folds case (alias "ignore_case" in grep); the reply echoes it as `case_insensitive`
{"refresh":true}                   re-read from disk for the exhaustive modes
{"no_ignore":true}                               include files .gitignore would hide, in every mode, under the
                                                 rule `grep`'s `no_ignore` entry states above.
{"head_limit":10}                                alias of `k`; `{"verbatim":true}` means `combine:"phrase"`.
{"no_cache":true, "force_disk":true}             aliases of `refresh`.
{"docs":false}                                   in the exhaustive modes, exclude docs (`*.md`, `*.mdx`, `*.rst`, `*.adoc`,
                                                 `docs/` and `doc/` trees); `{"mode":"comments"}` (or `comments`/`comments_only`)
                                                 runs the comment scan instead, with no `query` needed.
```

A request field `exhaustive: true` only implies `no_ignore`. In a reply, `exhaustive` reports coverage and does not widen the scan.
Coverage is reported back, and `exhaustive: false` there means the scan stopped early.
Every exhaustive reply names the corpus it answered on: `file_source` (`git`, `walk` or `file`) with `file_source_detail`,
and, when git contributed to it, `tracked_files_listed` and `untracked_files_listed`. `nested_worktrees` counts the nested
worktrees (submodule checkouts) whose untracked files were joined into that corpus, because a file written inside one belongs
to the nested repository and is not in this worktree's own `git ls-files`. When the listing of one of them fails,
`nested_worktrees_unlisted: true` and `nested_worktrees_note` say so: those files are then missing from the corpus and a zero
over it is **not** a finding for them, so re-dispatch with `refresh: true`, or scope `path` to the worktree, before concluding
a name is absent.

A zero is only exhaustive when the reply says `exhaustive: true`; a root-wide scan over a checkout with stale submodules or unlisted nested worktrees never says so, so scope `path` to the worktree before concluding a name is absent.

Example:

```
{"query":"verb dispatch table unknown verb", "mode":"dual", "k":3, "path_glob":"**/*.rs"}
-> bm25_hits: [{key, score, symbol:{kind,name,path,line_start,line_end}, text}, ...]
```

`dual` on a multi-word query returns compact `hits` rows `{at, sym, snip, lit}`, where `lit` is true when the row holds the query verbatim. In `dual` mode, doc sections are hidden and counted in `docs_hidden`, and `commits` is omitted, unless `docs: true`. Hits are nearest neighbours, so a term absent from every hit is not proven absent: `literal` decides it. Commit hits are leads, confirmed with `git_show`. Each `bm25_hits` row carries a `key` and, when one is indexed, a `symbol` (`{kind, name, path, line_start, line_end}`).
Four modes, plus the comment scan (`mode:"comments"`): `dual` ranks; `literal` and `regex` are exhaustive and read the tree directly.
`filename` matches paths only. An unknown `mode`
is an error that names the valid set, never a silent `dual`. A `dual` query that is one identifier-shaped
token (3-96 characters) is answered by the identifier route: an exhaustive whole-word scan whose reply has `mode: "symbol"`, `definitions` and `references`. A request whose body names `mode: "symbol"` is refused
and the refusal names the valid set. `k` caps the result count; `0` means unlimited for
`literal`, `regex` and `filename`, and is refused for `dual`, which is ranked top-k. `verbose: true` returns the
raw `bm25_hits`, `vector_hits` and `commits` channels.
Completeness: a `literal` or `regex` reply is complete only when it carries `exhaustive: true`. `partial_reason`
describes each bound or skip that fired and sets its flag in the reply (`matches_truncated`, `files_truncated`, `budget_exhausted`,
`listing_incomplete` (with `walk_reason`), `glob_matched_no_files`, `glob_outside_path`, and the oversize or unreadable files, which `partial_reason` names in prose.
Rule exclusions (`excluded_by_rule`, `excluded_by_rule_count`)
of gm's own state (`gm_state_dir`, `agentplug_kv_cache`) are counted in `excluded_by_rule_summary`, which counts every rule; they never affect `exhaustive`; every other rule (`gitignore`, `hidden_dir`, `noise_dir_name`) drops code, so it clears `exhaustive`. `excluded_by_rule` rides only when a rule dropped code, and names the first five such paths. A `path_glob` brace alternative whose directory lies outside `path` is named in `glob_outside_path`, which clears it too. Missing optional diagnostics never prove completeness.

Scope: `literal` and `regex` scan git's view of the worktree (`file_source: "git"`): tracked files, submodule
contents, and untracked files git does not ignore. A `root` (the project root to scan, alias `projectPath`) or `path` naming a gitignored directory or a folder
outside any git worktree is walked instead (`file_source: "walk"`, with `walk_reason`). `path_glob` is a real
glob (`**/*.{js,mjs}`), matched case-insensitively; a glob that admits no file sets `glob_matched_no_files: true`
and `exhaustive: false`. `timeout_ms` bounds the scan (default 20000 for regex); an overrun answers
`timed_out: true`, `exhaustive: false` and `budget_ms`. Past `max_chars` (24000) the rest spills (a file that holds reply data the reply does not carry inline) to
`spill_file` with `reply_truncated: true`. `output` is `matches` (default), `compact` (`path:line: text`),
`files` or `count`. A spill also carries `counts_by_file` inline (`N path` rows, busiest first), so the per-file answer never waits on the spill file.
Coverage: git's view is not the whole tree, so a gitignored subtree a query asked for would be unsearched, not empty. When a `literal` or `regex` reply is empty, or partial without the listing itself having been cut, the same scope is re-listed with the ignore rules off and whatever the first pass did not cover is read from disk with the same matcher, same shape and same caps. The reply then carries `files_scanned_indexed` (what the indexed cover read), `files_scanned_uncovered` (what that pass added) and `uncovered_scan` (`files_listed`, `files_scanned`, `files_with_matches`, `complete`, plus the skip counters that fired). `exhaustive: true` then requires both passes to have finished; a rule exclusion the second pass read no longer clears it. `files_scanned` is always reported, so `0 hits` never reads as `nothing was searched`.

Split-form matches: a `literal` query shaped like `apps/<surface>/<file>` also matches path segments written as separate quoted arguments on one line that spell the same path, such as `join(ROOT, 'apps', 'world', '_fixtures', 'e2e-ci-arena.js')` (the last segment may carry a file extension). Those hits sit in `split_form_matches`, counted by `split_form_count` and `split_form_files`, and never in `matches`, `count` or `occurrence_count`; `split_form_truncated` past 50. A `regex` or `dual` reply for such a query carries `split_form_not_searched` instead.

Query and body: `query` is required in every mode; `pattern` is an alias of `query` and, in dual mode, selects `literal`; `"literal": true` and `"regex": true` select those modes. Any other body
field is refused with the supported list, and `path` or `glob` scope `dual` too (its ranked rows and its literal fallback), so a scope never
silently widens. A multi-word query matches as one phrase; `combine: "or"` ranks any-term hits with all-term
lines first, and `combine: "and"` requires every term on one line. `term_combination` names the reading that
ran. A `regex` query carrying a metacharacter is matched as one regular expression, and `combine` has no
effect on it. Give the result limit as `max_results` or `k`, never both with different values.

`grep` answers the same way as `codesearch`: its reply's `mode` names the reading that ran, and a pattern that will not
compile is refused with the regex error text rather than an empty result. The grep body does not declare `combine`, `term_combination` or `verbatim`, so each is refused as an undeclared key; the multi-term reading (`combine`) is codesearch's only.


### `fs_read`, `fs_write`, `fs_readdir`, `fs_stat`: read a file or a line range, write a file, list a directory, stat a path

```
{"path":"<relative path>"}     required, relative and within the project
{"max_bytes":65536}            cap the returned chunk; "truncated_at_bytes" reports whether it fired.
{"allowOutsideRoot":true}      opt in to an absolute path outside the project root; required per call.
                               "allow_outside_root" is an alias. A path holding a ".." segment is
                               still refused, so the opt-in only changes which root a read may address:
                               it does not change whether a path may climb out of that root. The host sandbox is a second,
                               independent gate: outside the project root it serves only paths under
                               the user gm root or under a directory it grants. It grants a directory
                               only when that directory itself carries a
                               project marker (.git, .gm, package.json, Cargo.toml, go.mod,
                               pyproject.toml).
```

Line ranges. Every alias is **1-based and inclusive on both ends**: the start alias names the first line
returned, `endLine`/`end`/`to` the last line returned, and `limit`/`count`/`lines` a number of lines, never
an end line. Accepted aliases, resolved in this order (the first pair with a key present wins):

```
startLine / endLine     start / end (and start / count)     from / to     offset / limit     line / lines
```

The `line` and `lines` aliases name a start line and a line count, as `offset` and `limit` do.

So `{"startLine":1040,"endLine":1100}` and `{"from":1040,"to":1100}` and `{"offset":1040,"limit":61}` all
return lines 1040-1100. A request `offset` is the 1-based first line, unlike the 0-based `offset` in a reply. An end line past the last line clamps, and the reply then carries
`clamped_to_total_lines` plus `end_line_requested`; a start line past the last line is an error naming the
file's line count, as is a start of 0, an end before the start, or any range on an empty file. A key that
looks like a range but is not one of these (`start_line`, `endline`, `firstLine`, ...) is refused by name
instead of being ignored: unknown range keys never silently return the whole file.

Ranged replies add `total_lines`, `start_line`, `end_line`, `returned_lines`, `has_more_lines`,
`next_start_line` (while lines remain) and a 0-based `offset` kept for compatibility; `range_basis` states the convention in the
reply itself. Omit every range key to read the whole file; without `max_bytes` the reply is the plain file text.

Paged example:

```
{"path":"skills/gm/docs/verbs.md","startLine":232,"endLine":244}
-> ok:true, total_lines:<n>, start_line:232, end_line:244, has_more_lines:true, next_start_line:245,
   content:"<lines 232 to 244>"
```

A reply longer than the cap that `reply_max_chars` reports is spilled to the file named by `spill_file`, with the same range, and the
notice reports `spill_range: lines 232-244 of <n> (1-based, inclusive)`, `spill_lines`. While lines remain, the notice also carries `next_range`, a JSON range with `startLine` and `endLine` that `fs_read` takes for the next page.
Page the rest with the `gm_result` MCP tool on that file.

`fs_write` takes `{"path":"<relative path>","content":"<text>"}`. `data` and `text` are aliases of
`content`, and the value may be a JSON string (with `\n` for each newline) **or an array of lines**,
which is joined with `\n` plus a trailing newline. A raw, non-JSON body is accepted too when its
first line is a `path=<relative path>` directive and everything after it is the file contents. There
is an append mode, which runs only when the body sets `append: true`; a whole-file write to the append-only path `.gm/witness-log.md` is refused with `append_only_rewrite_refused`, and any other write replaces the whole file. It returns `{"bytes": <written>}`; a write outside
the root is refused even with `allowOutsideRoot`, which widens the read verbs only. `fs_readdir` takes `{"path":"<relative dir>"}` (default `.`). `fs_stat`
takes `{"path":"<relative path>"}`.

### `callers`, `callees`, `impact`: who calls a symbol and what a change reaches

Backed by the codeinsight symbol index, which `codeinsight_index` builds. All three route into the same handler and share these fields:

```
{"symbol":"<name>"}            required; "name" is an alias
{"limit":25}                   row cap (1..200); "k" is an alias
{"root":"<path>"}              another project root; "projectPath" is an alias
{"kind":"<symbol kind>"}       filter (`find` action only)
{"path":"<path>"}              filter; "path_prefix" is an alias (`find` action only)
```

`impact` adds `{"max_depth":3}` (default 3, clamped to 1 through 10) and `{"direction":"callers"|"callees"}` (default `callers`, i.e.
upstream). `callers` and `callees` return `symbol`, `defined_at` (one `path:line_start-line_end
<kind>` per definition), `callers` adds `edges` (`<path>:<line> <caller> -> <callee>`) and `distinct_callers`; `callees` adds a `callees` list ranked by call count, and `distinct_callees`,
`total` and `truncated`. `defined_at` is the answer to "where is symbol X defined".

Example:

```
{"symbol":"dispatch_gated_verb"}
-> defined_at: ["rs-plugkit/crates/plugkit-core/src/wasm_dispatch/verbs.rs:3071-3081 function_item"]
   distinct_callers: 1, total: 1
   edges: ["rs-plugkit/crates/plugkit-core/src/wasm_dispatch/verbs.rs:2900 dispatch_verb_inner -> dispatch_gated_verb"]
```

The graph comes from the codeinsight index, so run `codeinsight_index` before
trusting an empty reply on a checkout whose index has not been built.

### `codeinsight`, `codeinsight_index`: index state and symbol overview

`codeinsight` runs `overview` unless its body names an `action` or `mode`. Passing `{"action":"..."}` or
`{"mode":"..."}` selects any of `overview`, `status`, `sync`, `outline`, `find`, `callers`,
`callees`, `impact`, `hotspots`, `orphans`. `outline` requires `path`; `find` requires `symbol`. The body takes no `query` key: a body with `query` is refused as an undeclared key. Text search goes through `codesearch`, not `codeinsight`.

`codeinsight_index` builds the index: `{"root":"<path>"}` (`projectPath` is an alias),
`{"max_files":500}` (default 500), `{"dead_code":true}`, `{"dead_code_limit":200}` (default 200).

Every action except `outline` and `sync` drives sync passes to completion before it answers, for at most 45 s and six passes. An index that is still incomplete is answered with `index_current: false` and an `index_incomplete_reason`, unless
the root is not granted to the host, or the index is incomplete and its store is busy. Both cases are refused with
`error_code: "failed"` and `next_dispatch_hint: "codeinsight"`; `callers` answers a busy store instead of refusing, and its `error` names the
sync refresh that clears it, run as `codeinsight {"action":"sync","root":"<root>"}`. Sync is incremental,
so a pass that does not finish still advances the index and a further pass finishes it. The
reply and the refusal carry the counters of the sync pass that ran, as `key=value` plus at most two deferred file names;
the full `deferred_set` lives in the sync report, never in the message.

### `code_index`: chunk and embed one file for the code index

`code_index` is the dataflow pipeline `code_index` in `rs-plugkit/crates/plugkit-core/src/dataflow.rs`. Its three steps run in order: `chunk` (plugin `gm`, verb `extract_chunks`, fed from the request fields `path`, `source` and `lang`), `embed_batch` (plugin `bert`, over the chunk bodies), and `cache_write` (plugin `libsql`, verb `upsert_chunks`, which stores the chunks with their embeddings). The chunk step parses through the `treesitter` plugin, so the host links no tree-sitter grammar.

## Memory

Agents do not call these verbs for memory. Memory is the flat-file store that `skills/gm/SKILL.md` (Invariants) describes; the verbs stay in the code.

`recall`, `auto-recall`, `memorize-fire`, `memorize-prune`, `memorize-vacuum` and `memorize-retention` do not resolve in the current build: `gm.describe` fails for each, and rs-plugkit's source holds no dispatch for them. `memorize-continue` is the memory verb that resolves.

## Filesystem

| verb | body | purpose | kind |
|---|---|---|---|
| `fs_read` | `{"path", "startLine"?, "endLine"? (or "start"/"end", "from"/"to", "offset"/"limit", "line"/"lines", "start"/"count"), "max_bytes"?, "allowOutsideRoot"?}` | read a file or a 1-based inclusive line range | query |
| `fs_write` | `{"path", "content"}` (string) | write a file inside the project (replaces; `append: true` appends) | command |
| `fs_readdir` | `{"path"?, "allowOutsideRoot"?}` | list one directory | query |
| `fs_stat` | `{"path", "allowOutsideRoot"?}` | stat one path | query |
| `scan_deps` / `scan-deps` | `{}` | supply-chain scan of the dependency tree; `root` or `projectPath` selects the tree and `full: true` forces a full scan | command |

## Execution

`exec_js` (aliases `nodejs`, `javascript`, `typescript`, `node`, `js`) and every language stem
`bash`, `sh`, `shell`, `zsh`, `python`, `py`, `powershell`, `ps1`, `ssh`, `go`, `rust`, `c`, `cpp`,
`java`, `deno`, take a **plain text body**, never a JSON object. Pass the source as `raw_body`. The
typed `timeoutMs` field is the enforced wall-clock limit for the child, in milliseconds (default
300000, floor 100, ceiling 900000); the runner delivers it to the body itself, so never send it in
the body as well. `lang` selects a language stem by name. `filter` compacts stdout (grep, ls, tree,
JSON, diff).

```
exec_js {"raw_body":"console.log(process.version)\n","timeoutMs":30000}
```

`exec_js` evaluates its raw body in a separate Node process, delivered on the child's stdin, so the body is never part of its command line and a process-listing query that filters command lines for a marker string cannot match the runner itself. It does not inject the caller's `tools` object, which means the `gm` functions that `gm_codemode` provides. A `.js` scratch file in a repo whose package.json says `"type": "module"` is ESM: give a scratch file that uses `require` the `.cjs` extension. To run a command, use Node's argument-safe API: `const { execFileSync } = require("node:child_process"); return execFileSync("command", ["arg"], { encoding: "utf8" });`.

**Windows `cmd` inside a shell-stem body.** On Windows the `bash`/`sh`/`shell`/`zsh` stems run under MSYS2 git-bash, which rewrites every argument that starts with `/<letter>` into a drive path before the native program ever sees it: `node args.js /c` prints `["C:/"]`. So `cmd /c "node s.js < p.json"` reaches `cmd.exe` with no `/c` switch: `cmd` starts interactive, reads the dispatch's stdin (already drained, because the runner feeds the body in as `bash -c 'eval "$(cat)"'`), hits EOF and exits 0 printing nothing. That is argument rewriting, not a stdin failure: `< p.json` works the moment `cmd` gets its switch. Write `cmd //c "..."` (MSYS collapses `//c` back to `/c`), or `MSYS_NO_PATHCONV=1 cmd /c "..."` on that one line: the variable only has to be set, so `MSYS_NO_PATHCONV=0` also turns conversion off. Never export it over the whole body: it also stops `/tmp/x.js` reaching a native binary as a Windows path. `exec_js` is unaffected: `execFileSync("cmd", ["/c", "node s.js < p.json"])` and a bare `node s.js < p.json` return the same redirected stdin, and so is `powershell`, which is the stem to pick when the work needs cmd syntax.

At `timeoutMs` expiry the child's whole process tree is killed, the dispatch slot is released, and the reply is `ok: false, timed_out: true, killed: true, error_code: exec_timeout` with `limit_ms` and the partial `stdout`/`stderr`; nothing keeps running afterwards. When `timeout_seconds` is omitted, the MCP wrapper polls for the body's `timeoutMs` budget plus 5 s (never less than 120 s), or for 120 s when the call sets no typed `timeoutMs`; an explicit `timeout_seconds` sets the requested polling budget and, when the call sets no typed `timeoutMs` of its own, also raises that native execution limit to the same budget minus 5 s, with that budget capped at the poll ceiling (600000 ms by default), then held between the 300000 ms exec default and the 900000 ms hard ceiling, so a caller asking to wait 400 s is not answered "still in flight" for work the daemon reaped at 300 s. Every MCP call caps applied polling at 600 s, the harness tool-call maximum (`GM_MCP_POLL_TIMEOUT_CEILING_MS` moves it). A polling timeout does not kill the child: it returns the dispatch's `task` id plus `poll_timeout_ceiling_ms`, `poll_timeout_cap_reason`, and for exec verbs `exec_limit_ms` and an `exec_child` sentence naming when the daemon will reap it. Pass that `task` id as `resume_task` to re-poll that dispatch without redispatching.

A child a dispatch starts outlives the dispatch when it holds no pipe back to the runner. The runner holds the exec child and its whole tree in a Windows Job Object that carries no `KILL_ON_JOB_CLOSE`, so closing that handle when the dispatch returns leaves the tree running, and `terminate_containment` stays the only path that kills it (at `timeoutMs` expiry, and on `task-stop`). The one supported way to start durable background work is a redirected, subshell-detached child with its own log file: `( nohup bash /abs/path/script.sh >/abs/path/log 2>&1 & )`. Both halves are required: the redirect keeps the child off the runner's stdout and stderr, because a child that keeps those pipes open is instead adopted as a task and lives only until that task times out (30 minutes, not a daemon), and the subshell detaches it from the dispatch's shell so the shell does not wait on it. No breakaway call (a process start outside the job, such as `([wmiclass]'Win32_Process').Create` or `setsid`) is needed: the job no longer ends with the dispatch. Confirm survival from a SEPARATE dispatch, by pid or by the log that child appends, because a child checked only inside the dispatch that started it has not yet outlived anything.

Output fields (`stdout`, `stderr`, `result`, a structured `result` included) show up to 16000 characters; a longer field ends in `OUTPUT TRUNCATED` naming `result_file`, a plain text file (`## result`, `## stdout`, `## stderr` sections, un-escaped) that can be read directly. Use a language stem such as `bash` only when the request specifically needs shell syntax.

## Git verbs

Each git verb is a `query` or a `command`.

Query verbs:

- `git_status`, `branch_status`, `git_log`, `git_diff`, `git_show`, `git_poll`, `ci-status` (alias `ci_status`), `ci-log` (alias `ci_log`), `git_remote`, `git_stash_list`, `git_worktree_list`

Command verbs (every other git verb):

- `git_push`, `git_add`, `git_commit`, `git_amend`, `git_rewrite_authors`, `git_finalize`, `git_fetch`, `git_pull`, `git_init`, `git_branch`, `git_branch_delete`, `git_checkout`, `git_merge`, `git_merge_abort`, `git_stash`, `git_stash_pop`, `git_stash_drop`, `git_rm`, `git_revert`, `git_reset`, `git_submodule_add`, `git_submodule_update`, `git_worktree_add`, `git_worktree_remove`, `git_worktree_prune`

Single accepted shape for `git_commit` and `git_push`: each key is accepted at the top level or under `body`, and both forms reach the same commit or push path. `git_commit {message, paths?, files?, allow_whole_index?, author_name?, author_email?}`: `message` is the commit subject plus optional body, subject at most 50 characters. `git_push {rev?, remote?, branch?, force?, recover_remote_moved?, allow_foreign_commits?}`: only `rev` is top-level; the other push fields are body-only. `{"message":"..."}` and `{"body":{"message":"..."}}` are the same call; a key named in both takes its value from `body`. A key outside a verb's list is refused, naming the declared fields.

`git_finalize {message, paths?, files?, allow_whole_index?, untrack?, recover_remote_moved?, source_ref?, rev?, author_name?, author_email?}` stages and commits in one step. `untrack: true` with only tracked `.agentplug*` paths commits their index removal and leaves the files on disk.

`git_submodule_add {url, path, branch?}` adds a submodule: `git submodule add [-b <branch>] -- <url> <path>`. `url` must be `https://` with a host (no `user:password@`, no whitespace); `path` is relative to the repo root with no `.`, `..` or `.git` segment; `branch` (optional) holds only letters, digits, `.`, `_`, `-`, `/` and does not start with `-`. The same protected-path gate as `git_add` applies to `path`. It stages `.gitmodules` and the gitlink, and answers `{path, url, branch, staged}`. It does not commit: publish with `git_commit` then `git_push`.

`git_submodule_update {path, recursive?}` initialises and checks out a submodule at the parent gitlink: `git submodule update --init [--recursive] -- <path>`. `path` is the submodule path relative to the repo root, and `recursive: true` also initialises nested submodules. The same protected-path gate as `git_add` applies to `path`. It moves only the submodule checkout; it does not stage or commit the parent, which already records the gitlink.

`ci-status {sha?|rev?, github_repo?, ignore_workflows?}` answers `run_status` (`success`, `failure`, `pending`, `unknown`, `no_applicable_workflow`), `failing_jobs` as `[{name, workflow, job_id, run_id, log_url}]`, `pending_count` (jobs not yet completed) and `job_counts`; a run that failed with no failing job (a stale in-progress run) is listed under `failing_runs`. Pass a `failing_jobs` entry's `job_id` straight to `ci-log`.

`ci-log` reads what a step printed, which `ci-status` cannot answer: it answers a job's text, not its conclusion. Step names come from the run's job list (GitHub's jobs API, matched by each line's timestamp), since `gh` labels every line `UNKNOWN STEP`; `step_labels.source` says which source named them. `failed_only:true` reads only the failing steps of the failing jobs and answers `failures` as `[{job, job_id, log_url, step, step_number, error_lines, tail?}]`: `error_lines` are the lines matching `##[error]`, `error`, `fatal`, `panicked`, `failed` or `failure` (or `pattern`, when given) with ANSI colour codes stripped, each followed by its next 2 lines, capped by `max_lines`, and a failing step with no such line beyond the generic `##[error]Process completed with exit code` carries its last `tail_lines` (default 10) lines under `tail`. Name `run_id` (every `ci-status` job row carries one) or `sha`, optionally `job_id` to read one job instead of the whole run, then filter with `job`, `step` and `pattern` (`mode` is `literal` or `regex`, and `ignore_case` folds all three). Each returned line is split into `{n, job, step, at, text}`, so three jobs' output compares without anyone parsing the `job\tstep\ttimestamp\t` prefix by hand. Default caps are `max_lines` 40 and `max_chars` 8000, so a 1900-line multi-job run is never dumped into context; the reply carries `lines_scanned`, `matched_lines`, `returned_lines`, `truncated` and `truncated_by` so a cap is visible rather than silent. It reads through the `gh` CLI, so an absent or unauthenticated `gh` is a clear `ok: false` naming the reason, never a hang. Inside `gm_codemode`, `max_chars` is the wrapper's whole-reply cap and never reaches the verb, so set the verb's own cap through `body`:

```
ci-log {"github_repo":"lanmower/oscraft","run_id":38538275222,"step":"state hashes","pattern":"sha256"}
ci-log {"run_id":39101942533,"failed_only":true}
```

`git_remote` takes `{}` and answers `{branch, remotes, upstream}`. It inspects the configured remote URLs and the current branch's upstream without fetching or mutating state.

`git_pull` performs the ordinary fetch-and-integrate path (a merge, `--no-rebase`, by default). Opt-in body fields: `rebase:true` replays the local commits onto the fetched tip (`--rebase`), and `autostash:true` shelves local changes around the pull (`--autostash`); both default to `false`, so existing callers are unchanged. `git_stash` shelves (stashes) all work by default, including untracked files, but never the project's own `.gm/` or `.agentplug*` (listed in the receipt's `excluded`), and refuses more than 2000 untracked files (pass `paths:[...]` or `include_untracked:false`). `git_stash_pop` restores a shelf and drops it after a successful restore; a conflicted pop leaves the shelf, and `git_stash_drop` removes it afterwards. `git_stash_list` lists shelves. All stash verbs refuse unknown fields. `git_checkout` switches branch; `git_checkout` with `paths` restores only those paths (pathspecs, git's path patterns) in the working tree from `ref` (default the index), refusing an empty list, a leading `-` or `:`, `..`, an absolute path outside the repo and anything under `.gm/` or `.agentplug*` other than the transient scan-deps and codeinsight-edge caches; its receipt is `{restored, source, output}`. `git_finalize {message}` bundles the add, commit, porcelain gate, push and `ci-status-check` steps; if the build does not serve it, compose the same steps by hand. When another agent shares the worktree, pass `paths:[...]` to `git_commit`/`git_finalize`: only those pathspecs are staged, committed and porcelain-gated. With `rev`, `git_finalize` skips the commit and publishes that ref through `git_push`. The sanctioned publish is `git_push {rev:"<sha>"}` naming the commit you made: the full sha or the short sha (`git_push {rev:"d56ebcae"}` is accepted and ships the chain up to that commit). `rev:"HEAD"` is symbolic: it is accepted only when the branch has no unpushed commit, and otherwise refused with `error_code: gate_denied`, listing the unpushed commits. `git_push {rev:"<full sha>", allow_foreign_commits:true}` is the sanctioned push of a commit you already made over another writer's uncommitted changes: name the sha of the tip you mean to publish and pass the flag, because `rev:"HEAD"` is symbolic and the gate refuses it (`error_code: gate_denied`, "this push names no commit ... would ship every unpushed commit on main") while any commit on the branch is unpushed. A lane publishing only the commit it just made names that sha, `git_push {rev:"<own sha>"}`, and needs no flag. A push publishes a chain of commits, not one commit: `git_push` sends `git push origin <rev>:<branch>` (`<rev>:refs/heads/<branch>` for a full sha), so `rev` must name a commit and every commit on local `main` the remote lacks ships with it, including a commit another lane authored. On shared linear main that is the intended contract: no refspec publishes a commit without its ancestors, so `rev` names the tip, it never narrows the set. `git_commit` does not publish. Publishing goes through `git_push`, and `git_finalize` publishes by calling it. `git_log` with `paths` keeps only commits touching those pathspecs; `max_count` (aliases `n`, `limit`, `count`) caps the number of commits. `git_fetch` takes the refspec as `ref` (also `rev` or `refspec`), the first non-blank one naming it; `remote` defaults to `origin`. `git_diff` scopes the same way. `git_show`: `path` prints that file at the revision (same as `rev: "<rev>:<path>"`); `paths` limits a commit's diff; output is paged at 60000 bytes by `offset`, and the reply carries `total_bytes` and `next_offset` (`null` on the last page), so a long diff is read page by page; `full: true` returns the whole blob or diff in one reply, with `truncated: false`. These three refuse unknown fields, naming `unknown_fields` and `accepted_fields`. `git_status` scopes to `paths`; `summary: true` returns counts by status plus the first `limit` (default 20) `first_paths`, and without `summary`, `limit` caps each status list (default 10), and `truncated` is set when a list overflows.

`git_rewrite_authors` rewrites the author identity on the commits of local `main` (the range `since..HEAD`, or all of `HEAD` when `since` is absent; `since` is a hex sha of 7 to 64 digits). It refuses any branch other than `main`, a merge in progress and a worktree with changes outside `.gm/`. With `apply` unset it reports the plan; `apply:true` also needs the `confirm` field set to `"rewrite-pushed-history"`, because the rewrite changes commits that may already be published.

`git_reset` accepts `ref` or `rev` for the target, and `mode` (`mixed` default, `soft`, `hard`) or `hard:true`; `paths`/`files` limit the reset to those paths in the index. Unknown fields are refused. Naming `ref` and `rev` with different values, or `mode` and a conflicting `hard`, refuses with `conflicting_fields`; `paths` require `mode` `mixed` (`accepted_modes_for_paths`); `.gm/` and `.agentplug*` pathspecs are refused as protected. `mode` `hard` runs `git reset --hard` and rewrites the worktree. `git_commit {"amend":true}` rewrites the current commit instead of stacking a child, and refuses when that commit is already published (`pushed_commit_refused`, amend path in `rs-plugkit/crates/plugkit-core/src/wasm_dispatch/verbs/git.rs`). `git_amend` is that same rewrite as its own verb: it requires `message`, is answered by the `git_commit` handler, and carries the same `pushed_commit_refused` refusal.

`git_status {"eol":true}` adds `eol`, one `{path, index, worktree, attr}` entry per tracked path from
`git ls-files --eol` (index and worktree line endings plus the attribute text), with `eol_count` and
`eol_mismatch_count` (paths whose index and worktree endings differ). Scope it with `paths`, since the
whole tracked tree is a long reply. The `eol` array holds at most `limit` entries (default 10, the same
bound as the default listing); `eol_count` and `eol_mismatch_count` stay exact over every entry. When the
array is capped, `eol_truncated` is `true`, the full raw `git ls-files --eol` listing is written to
`eol_spill_file` under `.gm/exec-spool/out/`, and `eol_spill_write_failed` is set if that write fails.
Spill retention: `spill_file` and `eol_spill_file` both use the `git_status-` prefix; the newest 20
`git_status-*.txt` files are kept in `.gm/exec-spool/out/`, and each git_status call that writes a spill
deletes the older ones. A reply that wrote a spill names this rule in `spill_retention`.

`git_commit` takes `{"message":"<commit message>", "paths":["<path>", ...]}`. `message` is required. Its subject (the first line) must be 50 characters or fewer; a 51-or-longer subject is refused before the commit runs with a message naming the 50-character limit. `paths` (or `files`) limits the commit to those paths: the commit takes only the named paths and every other staged entry stays staged. Without `paths`, a commit refuses when a blanket stage would sweep other dirty entries (`error_code` `blanket_stage_refused`, with `would_stage_count`); `allow_whole_index:true` accepts the whole index explicitly, and a commit that takes the whole index reports `whole_index_commit` with `staged_paths`. The reply carries `committed`, `sha` and `summary`, plus `excluded` (the pathspecs the commit withheld: `.agentplug*` and each other dirty path the `paths` do not cover; at most 5 shown) with `excluded_count` for the full count, and `excluded_but_dirty` (the withheld dirty entries as `status path` rows, at most 50) with `excluded_but_dirty_count`.

`git_commit {"patch":"<unified diff against HEAD>", "message":"..."}` or `git_commit {"hunks":{"<path>":[<1-based hunk numbers>]}, "message":"..."}` commits only the named hunks, numbered as in `git diff HEAD -- <path>`. Pass exactly one of `patch` or `hunks`; both at once, or either with `paths`, `files`, `add_all`, `amend` or `allow_empty`, is refused. The commit is built in a temporary index, so the work tree is not touched; the reply carries `index_synced` and `index_left_staged` for the real index, and `selected_hunks`. `git_add` stages whole paths only and refuses `hunks`. An unscoped `git_commit` also carries the paths this session staged earlier with `git_add` (recorded under kv namespace `git_add_staged`, still staged) rather than only the blanket index.

`claim_only:true` on `git_commit` (with a non-empty `paths` array) only claims those paths in `.gm/lane-claims.json` for `SESSION_ID` and does not commit or publish.

Commit identity: the author is the gm config `git.author_name` and `git.author_email`, or the built-in default when unset. A body `author_name` or `author_email` that differs from that identity is refused (`commit_author_override_refusal`), so an agent cannot override the author. Each git invocation that writes a commit (`git_commit`, `git_pull`, `git_merge`, `git_cherry_pick`, `git_revert`, reland) passes the identity per invocation as `-c user.*`, `-c author.*` and `-c committer.*`; the repository's own config is neither read nor written.

`git_finalize` takes the same body, `{"message":"<commit message>", "paths":["<path>", ...]}`, and is the form that also pushes. Name `paths` every time: an unscoped `git_finalize` refuses with `error_code` `blanket_stage_refused` and `would_stage_count`, because a blanket commit carries another writer's in-flight edits with it. In a shared work tree it is not the default publish path: it commits locally and then refuses to push while the `push-dirty` scope check (`push_dirty_scope`) blocks, which is the normal state. The refused push leaves a local commit redundant with content already published and widens the gap between local HEAD, the work tree and remote main. Publish through the GitHub Git API instead (create blobs, a tree with `base_tree: <remote tip>`, a commit parented on that tip, PATCH `refs/heads/main` with `force` unset), then re-read `/repos/<owner>/<repo>/contents/<path>?ref=main` and verify each blob. A local commit whose push is refused is redundant, never unpushed work, and never erased by resetting `refs/heads/main` while lanes are running. `git_commit` with no `message` replies `error: message required` and commits nothing.

`.agentplug*` is runtime state. `git_add`, `git_commit`, `git_finalize` and `git_reset` refuse any add or modify of it, and the refusal carries `reason`. A tracked `.agentplug*` path is untracked with `git_finalize {"untrack":true, "message":"<subject>", "paths":["<path>", ...]}`: every path must name a literal tracked `.agentplug*` entry (no glob, no `..`), and nothing else may be named. The commit removes those entries from the index only (`git rm --cached` semantics; the files stay on disk), built on a temp index so other staged entries are untouched, then pushes. Its reply carries `untracked`, `removed`, `sha`, `work_tree_touched:false` and `push_result`. An untracked or non-`.agentplug*` path is refused with `reason`.

Each git verb in this section takes `{}`, or `{"cwd"|"repo"|"root"|"projectPath": "<path>"}` to target another repository.
The publishing verbs (`git_push`, `git_finalize`) read git's machine-readable status (porcelain) before they run, and a gate can deny them; a
denial names the verb to dispatch next.

`git_merge_abort` answers `{aborted, merge_in_progress, head}`. A repository with no merge in
progress is a clean reply (`aborted:false, merge_in_progress:false`) and never a raw git error.
The abort runs `git merge --abort`, which is `git reset --merge` and refuses while the index and the worktree disagree for a
path: typically a file git auto-merged that another session then edited afterwards. The verb
shelves exactly those paths (`git stash push --keep-index -- <paths>`, which leaves the index
content in the worktree so the reset can run), aborts, then pops the shelf so the edits land back
in the worktree as unstaged edits; the reply carries `preserved_paths` and `restored`. Nothing is
discarded silently: when the shelf or the pop cannot run, the reply names the stash entry that
still holds the edits. Unmerged (conflicted) paths are never shelved. They come back in
`conflicted` and the verb refuses rather than rewriting a conflict another session is resolving. A
refusal names every blocking path in `blocking_paths` plus `next_dispatch`: `git_add {paths:[...]}`
to accept the worktree version, or `git_stash {paths:[...]}` then `git_merge_abort` then
`git_stash_pop`. `{"preserve":false}` shelves nothing and reports instead of working around.

**Main only: work in the shared work tree; collisions are recovered, not avoided.** No lane (one parallel agent session) opens a
worktree, side branch or scratch checkout to obtain a clean HEAD: every extra tree ends in a
consolidation run (a merge back into the shared tree), and a publish from one merges back into the tree every other lane is writing. In a shared work tree that merge is exactly where lanes sweep each other's uncommitted edits.
Isolation buys a clean HEAD and costs a merge; recovery is cheaper. A blocked lane re-reads the row
or file, reapplies the change on current state and retries. A READ question is answered without a
second checkout: one file with `gh api /repos/<owner>/<repo>/contents/<path>?ref=main`; a whole tree
with `git archive <remote sha>` into a temp dir, used read-only and deleted afterwards.

The `git_worktree_*` verbs below are therefore a LAST RESORT with exactly one legitimate use: a
read-only reproduction of another commit: bisecting a regression by running the red-capable
command at a candidate sha, which is removed again with `git_worktree_remove`. Never edit, commit
or publish from one, and never reach for one to get a clean HEAD. Where that use applies, these four
are the sanctioned way to do it, and never raw `git worktree` through `bash`:

```
{"path":"C:/dev/proj-sweep","ref":"sweep/comments","create":true}                 git_worktree_add: -b <ref> <path> <HEAD>
{"path":"/tmp/sweep","ref":"sweep/comments","rev":"5ba0bd4a","create":true}       git_worktree_add: -b <ref> <path> <rev>
{"path":"/tmp/bisect","rev":"5ba0bd4ae70006e4fa0de8d95984559e7ccdf408"}           git_worktree_add: --detach <path> <rev>
{"path":"/tmp/bisect","ref":"5ba0bd4a","create":true}                             git_worktree_add: --detach <path> <ref>
{"path":"C:/dev/proj-sweep"}                                                      git_worktree_add: <path> <HEAD>
{"path":"C:/dev/proj-sweep"}                                                      git_worktree_remove (force:true to drop a dirty one)
{}                                                                                git_worktree_list / git_worktree_prune
```

`rev` (also `commit` or `start_point`) names the commit to land on, and `ref` names a branch, so a
caller that wants a specific commit sends `rev`. With `create:true` and both fields, `rev` is the
start point of the new branch named by `ref`. With `create:true` and `ref` alone, a `ref` that
resolves to a commit and names no existing branch DETACHES at that commit (`--detach`) rather than being passed to `-b`. `create:true` with a `ref` naming an existing
branch is refused rather than re-pointed. After every add the verb reads the new worktree's `HEAD`
and, when it is not the requested commit, refuses and removes the worktree again: a worktree at
the wrong commit is never reported as `ok:true`.

`git_worktree_add` answers `{root, path, branch, detached, rev, created, output}`; `git_worktree_list` answers
`{count, worktrees:[{path, head, branch, bare, detached, locked, prunable}]}` parsed from
`git worktree list --porcelain`. The four verbs refuse unknown fields. `add` and `remove` also refuse a `path` containing `..` or a path under `.gm/` or `.agentplug*`, and an absolute path outside the repository root needs `allowOutsideRoot:true`.

### `git_worktree`: linked checkouts by action (`add`, `list`, `remove`)

| action | body | result |
|---|---|---|
| list | `{"action":"list"}` | `worktrees` from Git's NUL-delimited porcelain records |
| add | `{"action":"add","path":"/absolute/checkout","ref":"HEAD","detach":true}` | `added`, `ref`, `detached` |
| remove | `{"action":"remove","path":"/absolute/checkout"}` | `removed` |

The `git_worktree_add`, `git_worktree_list` and `git_worktree_remove` verbs serve the same operations with their own body fields, shown in the examples above, and `git_worktree_prune` has no action here. Add defaults to a detached checkout at `HEAD`. Set `detach:false` with an existing local branch name to attach it. The `remove` action refuses `force`. To drop a dirty checkout, dispatch `git_worktree_remove` with `force:true`, which runs `git worktree remove` with `--force` only when `force` is true. Each action rejects unknown fields; repository selectors and session fields are accepted. Relative paths resolve against the body's `cwd`, falling back to `repo`, `root` or `projectPath`.

## Web

`fetch` takes a JSON body and is HTTP(S)-only.

### `fetch`: one page as readable markdown, or a web search

`fetch` is the web-reading verb, and it returns the **readable page**, not the transport payload:

1. the response body is fetched over `host_fetch`, which the native WASM host provides to the guest (HTTPS and HTTP only, no `file://`, no whitespace in the URL, 2048 bytes at most);
2. when the body is HTML, it is converted to markdown **before** it is returned: `head`, `script`, `style`, `svg`, `nav`, `header`, `footer`, `aside`, `form`, `iframe`, `template`, `select`, `button`, `input`, `meta`, `link`, `canvas`, `object` and `embed` blocks are dropped, `article` or `main` wins over the rest of the document, and headings, lists, links, images, code fences and tables are kept as markdown; entities are decoded and blank runs are collapsed;
3. a body that is not HTML (JSON, plain text, CSV, base64) is returned as it arrived.

```
body: {"url":"https://github.com/OpenBW/openbw"}
body: {"url":"https://example.com/", "prompt":"what license does this project use?"}
body: {"url":"https://example.com/", "raw":true, "max_chars":200000}
body: {"url":"https://raw.githubusercontent.com/AnEntrypoint/gm/main/README.md", "offset":24000, "length":24000}
body: {"url":"https://raw.githubusercontent.com/AnEntrypoint/gm/main/README.md", "start_line":800, "end_line":900}
```

| body field | does |
|---|---|
| `url` | the page to fetch. Required unless `query` is given |
| `query` | with no `url`, the call becomes a **web search**: aliases `q` and `search`. Discovery therefore lives on the same verb as reading, so no agent needs a second tool for it |
| `backend` | which keyless search backend to try, alias `engine`: a name, a comma-separated list, or a results-page URL template containing `{q}`. The `GM_SEARCH_BACKEND` environment variable sets the same order |
| `count` | hits returned by a search. Default **10**, ceiling 50; `limit`, `max_results`, `k` and `n` are aliases |
| `prompt` | answers the question in `prompt` against the converted page and returns the matching passages **instead of** the page. gm holds no outbound model credential, so answering is **extractive**: the passages are verbatim from the page, scored by how much of the prompt they cover, and `answer_mode` is always `"extractive"` |
| `max_chars` | cap on characters returned. Default **6000**, ceiling 4000000, so one fetch can never dump a 45k-character page into context; the default is small enough to read inline, and a clipped tail names how many characters were dropped |
| `offset`, `length` | read one **bounded page** of the document instead of its head, so a document longer than the cap is readable end to end. `offset` is a 0-based character offset, `length` the number of characters to return (`len` is an alias); a page defaults to **24000** characters, not 6000, and an explicit `max_chars` still caps it |
| `start_line`, `end_line`, `lines` | the same paging by line: 1-based and inclusive (aliases `startLine`, `endLine`), or `start_line` plus `lines` (aliases `line_count`, `lineCount`) as a count. Never mix a character key with a line key in one call: that is refused, not silently read as a head read |
| `answer_max_chars` | cap on a prompt answer. Default 4000 |
| `raw` | `true` (aliases `full_response`, `fullResponse`) is the escape hatch: the original body, no conversion, no prompt answering. Its default `max_chars` is 1000000 |
| `method`, `headers`, `body`, `opts`, `timeoutMs` | passed to the transport. `timeoutMs` defaults to 60000, ceiling 600000 |

The reply carries `url`, `status`, `content_type`, `body_chars`, `converted`, `max_chars` and `truncated`, and then either
`content` (the markdown) or `prompt`, `answer`, `answer_mode`, `answer_status`, `answer_chars` and `passages` (one row per passage, with
`score` and `matched_terms`). On `fetch`, `help:true` returns its parameter text and sends no request.

A paged read (`offset`/`length`, or `start_line`/`end_line`/`lines`) adds `offset`, `length`, `total_chars`, `has_more` and
`next_offset`, or `start_line`, `end_line`, `lines`, `total_lines`, `has_more` and `next_start_line`, so the next page is one
dispatch away; a page is never padded with the `...[+N chars clipped]` tail a clipped whole-document read carries.

`answer_status` is what separates the two ways a prompt answer can be empty, and it is on every prompt reply:
`matched` (passages were selected), `no_match` (the page has text and none of it scored against the prompt) and
`empty_source` (the retrieval or the conversion produced no text at all). An `empty_source` reply is **not** a finding that the
page lacks the answer: it comes back `ok:false` with `error_code: "fetch_empty_source"`, so an empty answer is never
indistinguishable from a failed retrieval.

`fetch {}` answers `url required (or query, q or search for a web search)`.

#### `fetch {query}`: web search

A `query` with no `url` walks a list of **keyless** backends in order until one parses into hits, so no API key and no
listening port are ever involved: `duckduckgo` (`https://html.duckduckgo.com/html/`), `mojeek`, `bing`, `searxng`,
`brave`, `marginalia`. At most 4 are tried per call; every failed attempt is reported in `attempts` with its status, so
a challenge page (a bot check served in place of the results) is visible rather than silent. `backend` (alias `engine`) or `GM_SEARCH_BACKEND` picks the order, and a
value that is a URL names a results-page template (`{q}` is replaced by the encoded query).

```
body: {"query":"floating point determinism", "count":5}
body: {"query":"rust wasm component", "backend":"mojeek,bing"}
body: {"query":"openbw", "allowed_domains":["github.com"]}
```

A search reply carries `mode:"search"`, `query`, `backend`, `endpoint`, `status`, `count`, `found`, `limit`,
`truncated`, `filters`, `attempts` and `results`, one row per hit: `rank`, `title`, `url`, `host`, `snippet`, each
snippet clamped at 400 characters. Ten hits are a few KB, and **raw HTML is never returned unless `raw:true`**. An empty
run across every backend is an error naming the backends tried and their failures.

### `websearch`: web search results as rows

`websearch` (aliases `web_search`, `web-search`; `search` stays an alias of `codesearch`) keeps discovery on the same
verb: it fetches a search engine results page through `fetch`'s transport and returns compact rows.

```
body: {"query":"openbw starcraft engine"}
body: {"query":"rust wasm component", "limit":5, "allowed_domains":["github.com"]}
body: {"url":"https://html.duckduckgo.com/html/?q=openbw", "prompt":"what is openbw?"}
```

| body field | does |
|---|---|
| `query` | what to search for; `q` is an alias. Required unless `url` is given |
| `url` | read this results page instead of building one from `query`. Use it when the default endpoint answers a challenge or consent page, or to reach another search backend |
| `engine` | `duckduckgo`, the default search backend, read from `https://html.duckduckgo.com/html/`, which needs no credential and no API key. Any other keyless backend is reached by naming it here or in `backend` (or in `GM_SEARCH_BACKEND`): `mojeek`, `bing`, `searxng`, `brave`, `marginalia` are all built in, and any other results page arrives by passing it as `url`. `fetch {query}` walks the same list with fallback |
| `limit` | rows returned. Default 8, ceiling 25; `max_results`, `maxResults` and `k` are aliases |
| `allowed_domains` | keep only results whose host matches one of these suffixes |
| `blocked_domains` | drop results whose host matches one of these suffixes |
| `prompt` | answered against the kept rows, the same extractive way `fetch` answers a prompt |
| `max_chars`, `raw`, `timeoutMs` | as on `fetch`; `timeoutMs` defaults to 30000 |

Both filters take host suffixes, so `example.com` matches `www.example.com` and `docs.example.com`, and either one
accepts an array or a comma-separated string. The reply carries `query`, `engine`, `endpoint`, `status`, `count`,
`found`, `limit`, `truncated`, `filters` and `results` (one row per hit: `rank`, `title`, `url`, `host`, `snippet`, each
snippet clamped at 400 characters), plus `prompt`/`answer` when a prompt is given. An empty `results` comes with a
`note` naming the usual cause, a challenge page, and the two ways past it: `url` or `fetch` on a known URL.

### `crawl`: browse pages through one of two engines

`crawl` takes a plain text body (see Execution). The first line
selects the engine; the rest is the crawl request (URLs and steps).

| engine | runs | window |
|---|---|---|
| `cdp` (default when the first line is absent) | the host drives a real Chrome over the Chrome DevTools Protocol (CDP) through its `crawl_cdp` entry point | **HEADFUL** (a visible window), always |

The `cdp` engine always runs **HEADFUL**: a `headless` line is refused with an error. `cdp` is the only crawl engine.

```
raw_body: "engine=cdp\nhttps://example.com/\n"
```

The `cdp` reply is the host's JSON object, passed through unchanged: `ok`, `engine`, `headless`,
`stdout`, `stderr`, `exit_code`, `duration_ms`, `timed_out`, `target_id`, `tab`, `steps`, `pages` and `error`. `steps` holds one record per browser step (`index`, `action`, `tab`, `tab_state`, `url_before`, `url_after`, `closed`), and `tab` holds the target's `targetId`, `state` (`opened` or `reused`) and `url`. An unknown
engine answers `ok: false` with `error_code: "unknown_engine"`, naming `cdp`.

The standalone `cdp` verb is removed; `crawl` with `engine=cdp` replaces it. The `cdp` engine serves the whole step grammar,
including raw `cdp <Domain.method>` commands and event capture.

### `chrome`: the CDP crawl as a named verb

`chrome` takes the same **plain text body** as `crawl` and runs the same browser steps (listed below) on the `cdp` engine, so the engine line is optional. The window is always headful. The verb answers the same host JSON object.

```
raw_body: "https://example.com/\nsnapshot\n"
```

### Browser steps for `engine=cdp`

A `cdp` body may open with `session=<name>`, then one step per line. The steps run over the single Chrome that a project root shares.

- `session=<name>` (a crawl session name, not a gm `session_id`; 1-64 letters, digits, `-`, `_`) keeps the tab and the `uid=N` numbers it assigned across calls, in `.gm/crawl-cdp-sessions/<name>.json`. Calls on one crawl session are serialized. A corrupt state file is refused, never reset. `sessionId=<name>` is an alias of `session=<name>`; a body that gives both is refused.
- The shared Chrome stays open after its last lease is released. It closes after 15 minutes with no holder or waiter. A lease is the hold one call keeps on the shared Chrome. Without `session=`, a call opens its own tab and closes it when it ends.

| Step | Does |
|---|---|
| `url=<url>`, or a bare URL | navigate and wait for the load |
| `snapshot` | accessibility tree; each element line starts `uid=N` |
| `click=<uid>`, `dblclick=<uid>`, `hover=<uid>` | mouse input at the element's centre |
| `click_at=<x>,<y>` | mouse click at CSS pixels |
| `fill=<uid> <value>` | text replaces the value; a select takes an option's value or label; a checkbox or radio takes `true` or `false` |
| `type=<text>` | key events into the focused element |
| `press=<key>` | `Enter`, `Tab`, `Escape`, arrows, `Home`, `End`, `F1`-`F12`, `Control+A`, `Control++` |
| `press_uid=<uid> <key>` | focuses the element at `uid`, then presses `<key>` (same keys as `press`) |
| `upload=<uid> <path>[;<path>]` | file input |
| `wait_for=<text>` | until the page shows the text |
| `reload`, `back`, `forward` | navigate |
| `console` | console messages, uncaught errors and dialogs |
| `network`, `network=<reqid>` | requests; one request with its headers and body |
| `dialog=accept\|dismiss` | policy for JavaScript dialogs; default accept |
| `screenshot=<path>`, `screenshot_full=<path>`, `screenshot_uid=<uid> <path>` | PNG, or `.jpg` / `.webp` by extension |
| `trace_start`, `trace_stop[=<path>]` | performance trace; the reply carries a summary; a `.gz` path compresses |
| `wait=<ms>`, `wait <ms>` | waits that many milliseconds; 60000 is the maximum |
| `eval=<js>` | page script; returns its value |
| `cdp <Domain.method>` | one raw CDP command; its params are the JSON object on the next line, omitted when the command takes none |
| `events <Domain.event> [where <field>~<value>] [limit=N]` | collect CDP events, keeping at most N (default 200, at most 10000) |

Working console recipe, filtering page `console.*` calls whose first argument contains `terrain`:

```
events Runtime.consoleAPICalled where args.0.value~[terrain] limit=200
```

The `where` filter reads `args.0.value`, so it matches only string and number first arguments. An object first argument has no `value`; match its `args.0.description` instead.

A `cdp` step's reply entry is the CDP command's own result, so `cdp Runtime.evaluate` yields
`result` and `cdp Page.captureScreenshot` yields `data`. The command runs on the page's CDP session.

An `events` step arms its capture when the call attaches to the shared Chrome, not where the line sits, so events fired
by an earlier step are still collected; the events entry keeps filling until the call ends. `where` keeps
the events whose dotted field, read out of the event params, contains (`~`), equals (`=`) or differs
from (`!=`) the value; an absent field never matches. `limit` caps the events kept and counts the
rest in `dropped`. The CDP domain (the part before the dot) is enabled for you. An `events` step such as `events Debugger.scriptParsed` sends
`Debugger.enable`.

```
raw_body: "engine=cdp\nsessionId=example-1\nevents Debugger.scriptParsed where url~example limit=600\ncdp Page.navigate\n{\"url\":\"https://example.com/\"}\nwait 3000\ncdp Runtime.evaluate\n{\"expression\":\"location.href\",\"returnByValue\":true}\n"
```

A uid is the number a snapshot printed for an element. It stays with that element across re-snapshots and across calls on the same session. A uid that no snapshot of the crawl session has printed is refused with an error. Console and network capture start when a call attaches to the shared Chrome.

## Phase machine, PRD rows and pool

The verbs below drive the phase machine. They are dispatched through the same spool.

**The graph is a set of independent nodes, not a sequence of stages.** `gm-config/fsm/graph.json` declares its states (the nodes) and its edges, and `rs-plugkit` compiles its own lean graph, `rs-plugkit/crates/plugkit-core/src/orchestrator/lean_graph.json`, through `include_str!`. A node
is a principle, a tension, a gate or a terminal, and each has its own prose, keyed by that
node's `prose_key`. An edge's `kind` is `forward` or `backreference`.
A node is entered from any neighbour that has an edge to it and left along any edge out of it, so
a walk is a graph walk with many distinct paths. The runtime word `phase` is the node key you
currently stand on: `policy.initial_phase` and `policy.terminal_phase` name two nodes. `skills/dream-rsi/gm-graph.json` is the authored catalogue the walk is measured
against; its nodes carry a `provenance` field (`null` or a label such as `P1`).

`phase-status`, `comment-audit`, `submodule-check`, `prd-list`, `mutable-list`, `task-list`, `task-output`, `discipline`, `discipline-audit`, `fsm-validate`, `predicates-md`, `capability-resolve`, `memory-namespace-audit`, `calculus-model-check`, `component-loader-hmr`, `dream-replay`, `dream-round` and `pool-brief` are `query`; `instruction`, `transition`, `transition-revert`, `residual-scan`, `claim-audit`, `prd-add`, `prd-resolve`, `prd-defer`, `mutable-add`, `mutable-resolve`, `mutable-defer`, `task-spawn`, `task-stop`, `memorize-backfill`, `memorize-continue`, `discipline-note`, `discipline-check-removal`, `fsm-vendor`, `fsm-propose-override`, `codeinsight-namespace-audit`, `component-loader-reconcile`, `dream-policy-register`, `dream-evaluator-receipt`, `dream-discovery-record`, `dream-world-seal`, `dream-replay-round`, `dream-replay-cycle`, `prd-block`, `prd-witness-request`, `expansion-audit`, `prd-repair`, `subagent-start`, `subagent-end`, `browser_lease_acquire` and `browser_lease_release` are `command`; `browser_lease_status` is `query`. `memorize-fire` and `auto-recall` keep the classes given with the memory verbs.

`prd-add` takes `id`, `subject`, `description`, `acceptance_criteria`, `witness_plan`, `status`, `blockedBy`, `overwrite`, `repair`, `owner` (the accountable lane or session; defaults to the filer's session_id), `disposition` (`open`, `accepted`, `rejected` or `deferred`; a reason belongs in `description`) and `recheck_by` (a session that re-checks the finding; must differ from `owner`), at the top level or inside `body` (the same call either way). `description` is the row's long-form prose: it is stored on the row as `description`, never as the dispatch body, so `{"subject":"<intent>","description":"<prose>"}` is the correct shape. `prd-list` brief rows carry the row's text in `title`, clamped to a fixed length. Full rows (`{"id":...}` or
`{"full":true}`) return the stored row as `prd-add` wrote it. The brief `title` is the row's `title`, or its `subject` when it has no `title`. `status` matches a row's `status` string exactly. A row that `prd-add` writes without a `status` gets `pending`, and `pending` lists the folder rows whose status is `pending`.

The closed statuses are `done`, `complete`, `completed` and `resolved` (the `prd_closed_statuses` policy default). A closed status also reads resolved rows from the log, and `all` returns every open and resolved row. The source defines no `ready` or `blocked` row status, so a filter on either finds only a row whose file holds that exact string.

`offset` with `limit` pages the listing: `next_offset` names the next page, null when done.

**Where the rows live.** One file per row: a PRD row is `.gm/prd/<id>.yml` and a mutable (an open condition) is
`.gm/mutables/<id>.yml`. The folder IS the index: there is no second list to keep in step with it,
and no verb writes a file that holds another lane's rows, so two lanes adding two different rows can
never lose each other's work to one whole-file rewrite. A file is a single YAML mapping (or a
sequence of blocks when a row has more than one), so it is editable by hand. Writing one row is a
compare-and-swap (the write proceeds only while the file still holds the bytes read earlier) of that row's file alone, under a temp file renamed over the row, so a partial write cannot
leave a row unreadable.

**Resolution moves the row.** `prd-resolve` (and `mutable-resolve`) append the row's material to
`.gm/prd-log.jsonl` (`.gm/mutables-log.jsonl`) and remove the row file, so the folder holds open
work only. The log is append-only and hash-chained: every line carries `prev`, the sha256 of the
line before it, plus `ts`, `ts_ms`, `session_id` when a dispatch session is known, and the resolved row's YAML blocks, converted to JSON, as `material`, so a
truncation or an edit is visible rather than silent. The resolve reply names `filed_to`, `filed_at`
and `row_file_cleared`. After resolution the id is still readable: `prd-list {"id":"<id>"}` reads the log
and returns the row with `resolved: true`.

**Migration.** The legacy single files `.gm/prd.yml` and `.gm/mutables.yml` are still read and are
split into the folders on the first write that touches them, after which a marker
(`.gm/prd.absorbed.json` for PRD rows, `.gm/mutables.absorbed.json` for mutables) lets reads skip them. No row is dropped and no flag day is needed: a
legacy row whose id already has a file is merged into that file, and a legacy row already in `.gm/prd-log.jsonl` is skipped, so closed work is not resurrected. The legacy files are never rewritten and never deleted, because projects
track and commit them.

`instruction` is the entry point: it serves the prose for the current phase and a gate denial names
the recovery verb. A long idle gap makes orchestrator verbs and state-changing verbs return
`gate_denied` with the `long-gap-no-instruction` gate text until `instruction` is dispatched again, except the verbs listed in `longgap_exempt_verbs`.

Pass the `instruction_hash`/`policy_hash` of the prior `instruction` response back as `known_instruction_hash`/`known_policy_hash` in the new body. An unchanged match empties the `instruction` field and sets `instruction_unchanged: true`, and the `discipline_policies` field is omitted; a mismatch or first dispatch returns them in full. Send only a hash read from a response you received. The hash check only shrinks the reply. The fields phase, `prd_pending_count`, `mutables_pending_count` and `prd_items` are restated in every reply where `instruction_unchanged` is true.

`prd-block` takes `{"id":"<row id>","note":"<text>"}` and appends the note to the row's `blocker_notes` list in one compare-and-swap write of that row's file. Both fields are required, and an id with no row is refused.

`mutable-add` stamps the dispatch `session_id` on the unknown. Re-adding an id whose open entry belongs to another `row` (or, when either side names no row, another session) is refused as `mutable-add-id-collision` with the owner and a `suggested_id` of `<row>/<id>`; nothing is written. Namespace unknown ids by row, or pass `rescope:true` to replace the open entry deliberately.

`unknown-add`, `unknown-list`, `unknown-resolve` and `unknown-defer` are aliases of `mutable-add`, `mutable-list`, `mutable-resolve` and `mutable-defer`, with the same bodies and replies. The spool accepts the `unknown-*` names; `gm_codemode` exposes only `gm.mutable_*` as callable names, so `gm.unknown_*` is refused.

`prd-witness-request` takes `{"id":"<row id>","note":"<what to observe>"}`, records `witness_request` (requester session, `ts_ms`, note) on the open row, and answers `executor_session`, `excluded_sessions` and a `verifier_brief` for a gm-prd `mode=witness` lane in a new session. The `prd-resolve-self-witness` refusal names it as `next_verb`. Every witness refusal of `prd-resolve` names the failing field in `field` or `missing_fields`.

`expansion-audit` takes `{"scope":"<what was swept>","rows_added":<n>,"unknowns_added":<n>}` (optional `result`, `note`), derives `result` (`fixed_point` when both counts are zero, else `expanded`; a contradicting `result` is refused), counts the open PRD rows and unknowns live, and appends a hash-chained entry to `.gm/expansion-audit.jsonl`. `verifiable_end_state` is true only for a fixed point with zero open rows and unknowns, so a goal stop cites that entry's `sha256`. `{"list":true,"limit":<n>}` returns `latest` and the last entries.

`prd-repair` reads the PRD file at `path` (default `.gm/prd.yml`) and repairs the YAML faults in it. A file that already parses is left as it is. Otherwise the repair copies the file to `<path>.bak-<ms>` and writes the repaired text back by compare-and-swap. `dry_run:true` reports `would_change`, `rows_after` and `faults` without writing, and `max_passes` (default 16) bounds the repair loop.

`dream-round` takes `baseline_policy_id` and `candidate_policy_ids`, evaluates the baseline and each candidate policy over the recorded observations, and returns the rankings sorted by `score`, highest first.

`dream-strategy-propose` takes no body fields beyond the envelope. It reads the owner session's newest automatic replay, sets `proposed_selection` from that replay's `selection` (`continue-current-exploration` when none is named), writes `.gm/dream-rsi/<session_id>/proposed-strategy.json` and answers `kind: strategy-proposal` with `owner_session_id`, `proposed_selection`, `replay` and `path`. It only proposes: nothing deploys the selection. The session id must be safe (ASCII letters, digits, `-`, `_` or `.`, at most 256 bytes, never `.` or `..`), and the verb runs only in the wasm guest.

`dream-replay-cycle` takes `session_id` (the owner, which must equal the dispatch session) and optional `cycle_id` and `after_dispatch_id`. It replays the owner's newest verified observation and answers `status: replayed`. When nothing verified is new it answers `status: deferred` with `reason` `no-verified-observations` or `no-new-verified-observations`.

`dream-replay` takes `world_ids` (array of sealed world ids), `baseline_policy_id`, `policy_ids` (array), and `beta1` and `beta2` (non-negative numbers). It refuses a body carrying `worlds`, since worlds are never caller-supplied. Its witness chain, in order, each step naming the field the next step reads:

1. `dream-policy-register` with `policy` (carrying `id`, `roots`, `max_nodes`, optional `max_online_rounds`) and `deployed:true` on the baseline. Its `roots` must be discovery ids that step 4 seals into the world, since replay refuses a root the world did not observe (`asks world for unobserved node`). Deploying a second policy needs an existing replay win over the deployed baseline, so a fixture whose baseline is already deployed runs in a fresh session id.
2. `dream-evaluator-receipt` with `receipt_id`, `policy_id`, `dispatch_id` (a completed gm dispatch) and the evaluator fields.
3. `dream-discovery-record` with `id`, `evaluator_receipt_id`, `policy_id`, `dispatch_id` (a completed, successful dispatch), optional `round` (required when the policy caps `max_online_rounds`) and optional `parent_id`.
4. `dream-world-seal` with `world_id` and `discovery_ids` (array of discovery ids). Each listed discovery must exist, belong to the session, and match its evaluator receipt's `policy_id` and `dispatch_id`, or the seal is refused.
5. `dream-replay` with the sealed `world_ids` from step 4 and the registered `baseline_policy_id` and `policy_ids`.

Every record is owned by the dispatch session, so the whole chain runs under one session id.

`subagent-start` takes `parent_session_id` and `subagent_session_id` (both validated), with optional `cwd` and `slice_id`, and records the subagent's start in `.subagent-ledger.jsonl` in the gm state directory. `subagent-end` takes the same two ids and a `status` of `done` (the default), `failed` or `stopped`. The native build refuses both lifecycle writes with `subagent lifecycle requires the wasm32 host`.

`browser_lease_acquire` and `browser_lease_release` take `agent`, with optional `ttl_ms` (lease time-to-live in ms before a silent holder counts as dead) and `wait_ms` (ms to wait for the lease before refusing), and `browser_lease_status` takes no agent. Acquire waits up to 600 s for the shared browser lease and answers `port`, `chrome_pid` and `lease_file`. A holder whose heartbeat is older than 120 s counts as dead. Release answers the lease state with `released` set to the agent, and status answers the lease state alone.

`pool-brief` hands one subagent its brief for one PRD row. Its body takes three non-empty string
fields: `row` (a PRD row id), `session` (the subagent's SESSION_ID: the key is spelled `session`,
never `session_id`) and `role` (one of `resolver`, `traversal`). A missing or empty field is refused
with the list of what is required.

`pool-observe` writes `.gm/pool/` state (the count of record, the spawn ceiling and the held rows). It reports the pool's slot state and the launches it advertises. Its body takes `live`
(the ListAgents count of running subagents). The count is written to
`.gm/pool/count-of-record.json`, which keeps it for 5 minutes. `held` is an array of the row id of every running
worker, which is kept for 30 minutes. `refusal` is the text of a spawn refusal, which records the spawn
ceiling in `.gm/pool/ceiling.json`. Every field is optional. `limit` caps each displayed list
(default 12), `rules: true` adds the pool rules to the reply, `blocker_notes: true` adds the open
rows that carry blocker notes, and `scanned_nodes` records traversal nodes as scanned. That scan leases
each one for 6 hours. A reply carries `floor`, `ceiling`, `count_of_record`, `refill_needed`,
`launch` (one item per id to launch now, each with `id`, `role` and `reason`), `shortfall`, `unfilled_shortfall`, `sufficient`, `traversal`, and
a `slots` block with `open_rows`, `live_rows`, `live_rows_unmatched`, `aging_heartbeats`,
`candidates`, `candidates_removed`, `launch_filters` and `already_fixed_on_head`. A `live` count under
the floor while rows are open is refused with `error_code` `floor_gate_denied` when launchable rows are advertised but not launched. When no open row is launchable and no traversal node is due, the reply is ok with `state` `supply_exhausted`, `held_rows` (running rows, the only supply) and `unlaunchable_open_rows`: wait for the held rows to complete, then re-observe; a retry cannot change the answer. Example body:
`{"live":4,"held":["<row-id>"]}`.

### `session_handover`: transfer session ownership

`session-handover` (the `session_handover` form is the same verb) makes `body.session_id` the owner of the project session. The envelope session id is not used, so a body without `session_id` is refused and the owner is unchanged. The field also takes the aliases `SESSION_ID` and `sessionId`.

## Storage, cache and diagnostics

`sql_list_dbs`, `sql_query`, `sql_serialize`, `cache_get`, `cache_stats`, `kv_get`, `kv_query`, `env_get`, `health`, `status`, `dataflow_resolve` and `tencentdb-compat-probe` are `query`; `sql_open`, `sql_close`, `sql_exec`, `sql_smoke`, `sql_deserialize`, `cache_put`, `cache_invalidate`, `kv_put`, `close`, `config_resolve`, `config-sync-now` and `tencentdb-memory-import` are `command`.

`wait {"ms":N}` idles the caller for N milliseconds. It is a `command`, since it dispatches a host `exec_js` call. `ms` takes a positive integer from 1 to 600000 (10 minutes, echoed as `max_ms` in a refusal), so a longer incident wait is one dispatch, not a chain. The body also takes `durationMs` (already milliseconds), or `seconds` (also `secs`, `durationSeconds`, `durationSecs`), scaled by 1000 to milliseconds. A wait that completes replies `completed:true` and `waited_ms:N`. Any other value is refused with `error_code:"invalid_args"` and `max_ms:600000`, and echoes the value as `received` when one is supplied.

`sleep {"ms":N}` shares `wait`'s handler (the orchestrator maps both names to `wait::handle`), so it takes the same body, enforces the same range and returns the same reply and has the same query or command class.

`wait-for-task {"id":"<task id>","timeout_ms":N}` blocks until the background task leaves `running`, then answers its output. `id` is required (`task_id`, or a bare string body, also names it). `timeout_ms` defaults to 100000 and must be an integer from 1 to 100000; at the deadline the reply carries `timed_out: true` instead of the output.

`wait_for_task` is the served name of `wait-for-task` (`gm.list` and `gm.describe` report it under that name), so it takes the same body and returns the same reply.

`learn` is retired.

## Two verbs the native host answers

The agentplug daemon, not the gm plugin, handles these:

| verb | purpose |
|---|---|
| `background-convert` | mark an in-flight dispatch `{verb, task}` as converted (`converted: true`), or answer `already_completed` or `unknown_task` |
| `plugin-refresh` | force the plugin and runner update poll to fire on the next loop tick |

## Getting a verb's own documentation

Twelve verbs publish their parameter doc: pass `{"help": true}` as the body of `grep`, `codesearch`,
`fs_read`, `fs_write`, `fs_readdir`, `fs_stat`, `prd-add`, `prd-resolve`, `codeinsight`, `comment-audit`, `git_merge_abort` or `git_worktree` and the reply is
`{"help": true, "verb": ..., "parameters": "<doc>"}`. Any other verb answers `help` with an error that says no parameter documentation is published for it.

`gm.describe(name)` in `gm_codemode` answers `{name, verb, summary, docs, input_schema, body_schema}`. `summary` is the verb's table description (null when the table has none; `docs` then names the heading to search for). `input_schema` is `{shared: "dispatch_envelope"}` when the verb takes the common dispatch envelope (body, raw_body, session_id, cwd, timeout_seconds and the rest); that schema is returned once by `gm.help().dispatch_envelope`.

## Body field index

Every body field a verb declares, grouped by verb. The contract check (`scripts/check-verb-body-contract.mjs`) requires each name to appear here or in a section above.

- `fs_write`: `append`, `allow_empty`
- `fetch`: `wiki`, `user`, `stars`
- `websearch` and `web_search`: `wiki`, `user`, `stars`
- `git_push`: `recover_remote_moved`, `allow_foreign_commits`
- `git_commit`: `allow_whole_index`, `allow_foreign_rows`
- `git_finalize`: `allow_whole_index`, `untrack`
- `git_log`: `range`. Commit count is `limit`; `max_count` is its git-native alias, and `limit` wins when both are present (default 10). `count` and `n` are refused as unknown fields.
- `git_diff`: `range`, `staged`, `stat`
- `git_show`: `rev`, `ref`, `sha`, `commit`, `stat`, `path`, `paths`, `files`, `offset`, `full`. `full: true` returns the whole blob (no 60000-byte page), and `next_offset` pages the rest.
- `git_submodule_update`: `recursive`
- `git_checkout`: `create`
- `git_merge`: `ff_only`
- `git_merge_abort`: `preserve`
- `git_branch_delete`: `remote_name`
- `git_rm`: `cached`
- `git_reset`: `allow_rewrite`
- `git_pull`: `ff_only`, `rebase`, `autostash`, `user_name`, `user_email`
- `git_stash`: `include_untracked`
- `git_init`: `user_name`, `user_email`, `initial_branch`
- `git_worktree_add`: `create`
- `git_worktree_remove`: `allow_rewrite`
- `codeinsight`, `callers`, `callees`, `impact`: `verb`, `max_depth`, `direction`, `through_ambiguous`, `language`
- `codesearch`: `max_matches`, `max_files`, `whole_word`, `verbatim`
- `grep`: `max_matches`, `max_files`, `whole_word`, `context`, `include`, `detail`, `columns`, `fixed_strings`, `fixedStrings`
- `ci_log`: `github_repo`, `failed_only`
- `exec_js`: `code`
- `lang`: `code`
- `task_spawn`: `code`, `permissionMode`
- `instruction`: `full`
- `prd_list`: `full`, `brief`
- `prd_resolve`: `witness_evidence`, `witness_dispatch_id`, `witness_root`, `witness_exit_code`, `witness_output_sha256`, `witness_output_path`, `witness_ts`, `resolution`, `commit_sha`, `commit_comment`, `keep_status`. `witness_root` is the root the witness ran in: an absolute path under /config/tmp or the row's own root, whose `.gm/exec-spool/.dispatch-ledger.json` holds `witness_dispatch_id`; passed through unchanged.
- `expansion_audit`: `scope`, `rows_added`, `unknowns_added`