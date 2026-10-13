# Migrating gm's own memories into the `tencentdb_backend` store

Distinct from the migration in `SKILL.md` section 3 (that's the standalone system's own internal format
evolution). This is for a project that already has gm-native memories
(`.gm/memories/*.md`, written by `memorize`/`memorize-fire` before
`memory.tencentdb_backend` was enabled) and wants them carried over once a
namespace opts into the Tencent-compatible backend, so recall doesn't go
cold on the switch.

Two ways to run this migration -- same underlying write path
(`tencentdb_memory::write_cfg`), pick whichever fits the situation:

- **From within a live agent session**: dispatch the
  `tencentdb-memory-import` verb: `{"source_namespace": "default",
  "dest_namespace": "<routed-namespace>", "kind": "l1"}`. It reads every
  `.md` doc in the source namespace and re-embeds through gm's own 384-dim
  pipeline.
- **Batch/CLI, outside an agent session**: `node
  scripts/migrate-memory-to-tencentdb.mjs --project <path> --namespace
  <ns> [--dry-run] [--archive]`. Same write path, but also applies the
  derivable-state discard filter (git-log-derivable facts, dated audit
  entries, historical framing) the verb does not -- prefer this for a bulk
  migration where discarding superfluous content matters, and the verb for
  a single dispatch from an already-running session.

Both refuse up front unless the destination namespace's resolved
`memory.tencentdb_backend.vectors_db_dims` is exactly `384` -- gm's
embedder cannot produce vectors at any other width, and a namespace
configured for externally-embedded 768-dim content (the default) cannot
safely receive them (recall queries that namespace through the
project-resolved dim, not a per-import override, so a dim mismatch there
is a real defect, not a formality). A project wanting both kinds of
content needs two separate `tencentdb_backend`-routed namespaces, each at
its own dim.

By default this is a one-way copy, not a move: the source `.md` files and
their `rssearch_vectors` index rows are left untouched, so the default
backend keeps working for any namespace not also switched over. Pass
`archive_source: true` (verb) or `--archive` (script) to opt into moving
each successfully-migrated source file to
`.gm/memories-archive-tencentdb/<namespace>/<filename>` instead of leaving
it in place -- content stays inspectable, but the live `.gm/memories/`
corpus no longer duplicates what the new backend now serves.
