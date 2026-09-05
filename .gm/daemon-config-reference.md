# Daemon lifecycle configuration

agentplug-runner reads `~/.agentplug/daemon-config.json` at startup for the timing
constants governing its own lifecycle. This is machine-scoped (not per-project) because
the daemon is a single shared process across every registered project -- a per-project
override would be ambiguous when multiple projects are registered.

All fields optional; a field's absence (or the whole file's absence) falls back to the
value already documented in the field descriptions below. An unconfigured machine
behaves byte-identically to before this file existed.

```json
{
  "registry_poll_interval_secs": 5,
  "heartbeat_interval_secs": 10,
  "plugin_update_poll_interval_secs": 600,
  "runner_update_poll_interval_secs": 600
}
```

`max_concurrent_projects` and `gm_concurrency` are absent from this example on purpose. When they are unset, each daemon boot derives a default from this machine's own `std::thread::available_parallelism()`. The same config file then behaves correctly on a 4-core box and on a 64-core box. Set them only to override that host-derived default. `side_plugin_concurrency` defaults to 1 on every host (see its entry below).

- `registry_poll_interval_secs` (default 5) -- how often the daemon re-reads
  `daemon-registry.txt` to notice newly-registered projects.
- `heartbeat_interval_secs` (default 10) -- how often the daemon writes its
  `.status.json` heartbeat and re-checks single-instance ownership authority.
- `plugin_update_poll_interval_secs` (default 600) -- how often the daemon checks
  each loaded plugin's remote release for a newer version, only when genuinely idle.
- `runner_update_poll_interval_secs` (default 600) -- how often the daemon checks
  its own executable's remote release for a newer version, only when genuinely idle.
- `max_concurrent_projects` (default: this host's
  `std::thread::available_parallelism()`, e.g. 4 on a 4-core box) -- how many
  project-worker threads run concurrently in the daemon's own dispatch loop.
  Each worker pulls the next registered root off a shared queue and may block
  for the duration of a slow exec_js/browser dispatch, so this is the real
  ceiling on how many projects can be mid-dispatch at once. Set explicitly to
  override the host-derived default.
- `gm_concurrency` (default: same as `max_concurrent_projects`, so also
  host-core-derived unless set explicitly) -- the worker-thread budget for
  cross-project gm dispatch and the multiplier behind
  `shared_store_recycle_dispatches`. It no longer sizes the `gm` Store pool.
  The runner keeps exactly one hot `gm` Store and serializes gm calls through
  it. One Store stays loaded between calls, so per-call latency stays fast,
  and no project ever pays for a second copy of gm's linear memory. `gm` is
  stateless: its real state lives in each project's own `.gm/` files, never
  in wasm memory, so the single Store serves every project.
- `side_plugin_concurrency` (default 1) -- how many live Stores EACH of
  bert/treesitter (the non-`gm` shared plugins) holds. Each extra slot is a
  full copy of that plugin's Store; for bert that is its own copy of the
  loaded model weights, live-measured at about 140 MB of linear memory per
  slot before any batch embed. The default was once half the host's cores,
  and on a 16-core host that derived 8 bert slots; two or three of them
  filling under ordinary use pushed the process past 1.7 GB. Raise this
  only after `plugin_pool_busy_timeout` or queuing shows in `.watcher.log`
  under real concurrent load, never from the number of registered projects
  alone. `libsql` is a per-project Store and this key does not apply to it.

  Real load witnessed 2026-07-23, when `max_concurrent_projects`/
  `gm_concurrency`/`side_plugin_concurrency` were still hardcoded to a
  static `4`/`4`/`1` (before both were made host-core-derived): 12
  registered projects sharing one daemon at that fixed 4/4/1 produced
  sustained `plugin gm not loaded` errors -- root-caused to a DIFFERENT bug
  (a Trap in a shared plugin, bert in particular, left its pool slot
  poisoned instead of being evicted and reinstantiated; fixed in
  `d3c159316e35320fb61e688651af1468a6ca41dc`,
  "Evict poisoned shared-plugin Store after a dispatch error instead of
  reusing it"), not by `side_plugin_concurrency` itself being undersized.
  With the eviction fix in place, a poisoned slot self-heals on the very
  next dispatch instead of staying wedged for 1-2 minutes, which removes
  the actual mechanism that produced the sustained symptom -- raising
  `side_plugin_concurrency` would not have prevented that specific failure
  mode (a poisoned slot behaves the same regardless of pool width; eviction,
  not pool width, was the missing piece). Today's host-derived default
  remains a reasonable starting tradeoff absent a DIFFERENT, still-live
  symptom (`plugin_pool_busy_timeout` or queuing visible in `.watcher.log`
  under concurrent load with the eviction fix already applied) -- raise it
  further only once that distinct symptom is actually observed post-fix,
  not preemptively from the presence of many registered projects alone:
  `max_concurrent_projects` still caps how many projects are ever genuinely
  mid-dispatch at once regardless of how many are registered, so
  registering many more projects than that cap does not by itself imply
  more real concurrency against the side-plugin pools.

  The same investigation also found and fixed a genuine fairness bug in
  `SharedPluginPool::acquire`'s fallback path (agentplug commit following
  d3c1593): when the initial single sweep across all slots found every slot
  momentarily busy, the fallback poll loop retried ONLY `slots[0]` for the
  full 20s `ACQUIRE_TIMEOUT_MS`, ignoring slots 1..N even if they freed up
  first -- for `gm_concurrency`'s default pool size of 4 this artificially
  serialized contention onto a single slot instead of using the other three,
  worsening exactly this kind of multi-project contention. Fixed to re-sweep
  every slot on each poll iteration.

Changing `heartbeat_interval_secs`, `max_concurrent_projects`, `gm_concurrency`,
or `side_plugin_concurrency` requires a daemon restart to take effect (read
once at startup, not re-read per tick, since these govern the daemon's own
loop timing and pool sizing).

## Memory

One daemon serves every registered project, so its resident memory is the
sum of three parts. Each part has its own control.

1. Compiled plugin modules. The runner compiles each `<plugin>.wasm` once
   into `~/.agentplug/precompiled/<plugin>-<sha16>-<engine-key>.cwasm` and
   maps that file on every later load. The mapping is file-backed and clean.
   The kernel can drop those pages under pressure and re-read them, so they
   never count toward `private_bytes`. The old `wasmtime-cache` directory is
   removed on first use. A plugin whose bytes change gets a new artifact and
   the superseded one is deleted. Measured on Linux with all four default
   modules loaded and no instance live: 118 MB RSS, down from about 300 MB
   when the artifact was copied into anonymous memory.
2. Plugin Stores. A Store is one live wasm instance with its own linear
   memory. `gm`, `bert` and `treesitter` are shared across projects (one hot
   Store each). `libsql`, `oxibrowser`, `crux` and any extra plugin get one
   Store per project. Only `gm` is instantiated when a project first
   dispatches. Every other plugin is instantiated on its first
   `host_plugin_call` or `host_vec_embed`, and the watcher log records
   `plugin_lazy_loaded` with the plugin, scope and load time. A project that
   never searches code never holds a `treesitter` Store, and a project that
   never opens a page never holds an `oxibrowser` Store.
3. Wasm linear memory growth. A wasm linear memory never shrinks in place.
   A large `codesearch` or `memorize-fire` leaves its peak resident inside
   the Store until that Store is dropped. Two controls bound this. The
   per-plugin ceiling below drops one Store the moment a dispatch leaves it
   over its ceiling. The process-wide recycle gate below drops every shared
   Store when the whole process crosses its limit.

Keys, all machine-scoped in `~/.agentplug/daemon-config.json`:

- `plugin_store_linear_memory_ceiling_mb` (default 512) -- the ceiling for a
  plugin with no entry in the per-name table. After each successful
  dispatch the runner reads the Store's linear memory size. A Store above
  its ceiling is evicted at once. The next dispatch re-instantiates it from
  the mapped module, which costs milliseconds for `gm` and `treesitter` and
  one model load (seconds) for `bert`. The watcher log records
  `plugin_store_evicted_linear_memory_ceiling` with the verb, the size and
  the ceiling.
- `plugin_store_linear_memory_ceiling_mb_by_name` (default `{"gm": 384,
  "treesitter": 256, "libsql": 256, "oxibrowser": 256, "crux": 128, "bert":
  768}`) -- per-plugin overrides. `bert` is high because its weights alone
  occupy about 140 MB of linear memory and every batch embed grows it
  (measured 283 MB after one `codesearch` index pass on a small repo, on
  the f32 weight build; the f16 build halves the file image but the F32
  tensors in linear memory stay the same, measured 215 MB after one embed).
  Set a value to 0 to disable the ceiling for that plugin. A ceiling below
  a plugin's post-load floor evicts that plugin after every dispatch;
  bert's floor is about 140 MB, witnessed with a 128 MB ceiling that
  evicted bert three times in three embeds. An `oxibrowser`
  Store holds that project's `serp` session, so its eviction ends the
  session; keep its ceiling above the session's real working set.
- `shared_store_recycle_private_mb` (default 768, floor 256) -- the
  process-wide gate. `private_bytes` is `RssAnon + RssShmem + VmSwap` on
  Linux and the process private commit charge (`PrivateUsage`) on Windows,
  which can exceed the working set. File-backed module pages
  are excluded on purpose. Crossing the limit releases every free shared
  Store (`gm`, `bert`, `treesitter`).
- `shared_store_recycle_dispatches` (default 500 x `gm_concurrency`, floor
  100 when unset; a configured value has floor 1, so 0 means a release after
  every dispatch) -- the
  same release on a cumulative shared-dispatch count, independent of memory.
- `shared_store_recycle_min_interval_secs` (default 120) -- the shortest gap
  between two pressure-driven releases. Without it a resident baseline that
  sits above `shared_store_recycle_private_mb` releases and reloads `bert`
  on every tick. When the gap suppresses a release the daemon log says so
  and names the key to raise.
- `project_idle_evict_secs` (default 1800, floor 60) -- drops a project's
  per-project Stores after that long without a dispatch.
- `shared_plugin_release_idle_secs` (default 1800, floor 300) -- drops the
  shared Stores after that long with no dispatch across every project.

The heartbeat file `~/.agentplug/daemon-status.json` reports the live
numbers: `memory` (`rss_bytes`, `anon_bytes`, `file_bytes`, `shmem_bytes`,
`swap_bytes`, `private_bytes`), `plugin_store_bytes` (per plugin:
`instances`, `total_bytes`, `max_bytes`, `ceiling_bytes`),
`shared_dispatches_since_release` and `last_shared_store_release` (`ts`,
`trigger`, `reason`, `released`, `private_bytes_before`,
`private_bytes_after`). gmsniff reads these fields and prints them as
measurements. Use them before changing a key.

## Heartbeat independence

The heartbeat write and single-instance-ownership re-check run on their own
dedicated ticker thread (`spawn_heartbeat_ticker`), independent of the
per-tick worker-pool `thread::scope` that dispatches project work. Before
this, both lived only at the top of the main loop, gated behind that
iteration's `thread::scope` fully joining every worker -- one worker occupying
a slot for up to `DISPATCH_CALL_DEADLINE_SECS` (40s, a slow exec_js/browser
call or a stuck pool-acquire wait) delayed the heartbeat write for that same
duration, risking a live daemon's heartbeat going stale long enough for a
competing process to claim ownership out from under it. The ticker thread
never touches `projects`/`plugin_modules`/worker state directly (only the
filesystem, via the same primitives the old inline check already used); on
losing authority it raises a shared flag the main loop polls cheaply (both at
the top of every loop iteration and immediately after each dispatch batch)
and performs the actual session-owning shutdown itself.

## Mid-batch verb starvation

Within one `dispatch_project` call, newly-arrived requests in ANY verb
directory (not just `background-convert`, which had this fix first) are
re-scanned and spawned into the same in-flight batch on every ~50ms poll
tick, rather than waiting for the batch's original members to finish and the
next `dispatch_project` call for that root to pick them up. Without this, an
ordinary request (e.g. `phase-status`) landing on a busy project's spool
while an unrelated slow dispatch (e.g. `codesearch`, `exec_js`) from the same
claim-snapshot was still in flight sat unclaimed for the full duration of
that slow sibling.

## Per-project fairness cap (not machine-wide)

`gm_concurrency` above is the actual TOTAL pool size and stays strictly
machine-wide -- one shared daemon process, so no per-project override of the
real pool size is admissible (a project raising its own share would be raising
it for every other registered project too, since they all draw from the same
pool).

A registered project can still set its OWN fairness ceiling: how many of that
shared pool's slots ITS OWN dispatches may occupy concurrently, as a
self-limiting cap that can only ever lower a project's effective share, never
raise the machine total. Configured per-project, read fresh on every dispatch
(same precedent as `.gm/browser-config.json`'s `BrowserConfig::load(cwd)`),
at:

```
<project>/.gm/daemon-project-config.json
```

```json
{
  "gm_concurrency_limit": 1
}
```

- `gm_concurrency_limit` (default: unset -- unbounded from this project's own
  side, i.e. bounded only by the machine-wide `gm_concurrency` pool size) --
  the maximum number of this project's own `gm` dispatches allowed in flight
  at once. A dispatch beyond this project's own limit waits (polls a
  process-wide in-flight counter keyed by project root) for one of this same
  project's earlier dispatches to finish, BEFORE it takes a slot from the
  shared pool -- it never grants extra pool slots, it only restricts how many
  of the ones the pool already has this one project may hold simultaneously.
  Released automatically (RAII guard) when the dispatch completes or panics,
  so a crash mid-dispatch cannot wedge the project at a permanently-held
  fairness slot.

Missing file, or the field absent, is byte-identical to behavior before this
file existed -- no wait loop is entered, no shared map is touched, zero
overhead beyond one file read that fails.

Note: a single project's own `gm` dispatches CAN now run genuinely concurrent
against each other -- see `background-convert` below. This fairness cap is the
real, observable ceiling on that concurrency, not a forward-looking no-op:
once a dispatch has been background-converted, the project's remaining queued
dispatches proceed against the shared pool while the converted one is still
running, and `gm_concurrency_limit` (if configured) bounds how many of that
project's own dispatches -- background-converted or not -- may hold a pool
slot at the same time.

## `background-convert` -- agent-initiated dispatch backgrounding

Each of a project's spool requests is spawned onto its own OS thread the
moment it is claimed; the daemon's own worker normally waits for that thread
to finish (bounded-poll `is_finished()` check, ~50ms cadence) before writing
the response and moving on -- functionally identical timing to a plain
synchronous call. `background-convert` lets an agent that already dispatched
a slow verb (`exec_js`, `browser`, or any other -- the mechanism is
verb-agnostic, the daemon does not need to know what a verb does to detach
the thread running it) tell the daemon mid-flight: stop waiting on this one,
keep it running, and free the worker/tick immediately. This is agent-
initiated only -- there is no timer/threshold that backgrounds a dispatch
automatically. It is unrelated to `exec_js`'s own internal `timeoutMs`-based
subprocess backgrounding (`host_task_proc`/`task.rs`'s `spawn`/`list`/
`output`/`stop`) -- that mechanism backgrounds a subprocess the JS script
itself spawned; `background-convert` backgrounds the WASM DISPATCH CALL
itself, one layer up, regardless of verb.

Request: `in/background-convert/<N>.txt`

```json
{"verb": "exec_js", "task": "<the original request's numeric filename stem>"}
```

`task` is the same id the agent already knows from having written the
original request to `in/<verb>/<task>.txt` itself.

Response: `out/background-convert-<N>.json`

```json
{"ok": true, "converted": true, "verb": "exec_js", "task": "..."}
```

or, if no matching in-flight dispatch exists for this project (wrong verb/
task, or it already finished before this request was processed -- both read
identically, since from the caller's side "never existed" and "already done"
require the same next action: read the real response, it's either already
there or on its way):

```json
{"ok": false, "error": "already_completed", "verb": "exec_js", "task": "..."}
```

Once converted, the original dispatch keeps running to completion on its own
thread and writes its real result to the EXACT SAME path the synchronous path
would have (`out/<verb>-<task>.json` + the `.ready` sentinel) -- the calling
agent's later `Read` on that same path is unchanged ABI, it just may need to
be retried later rather than being immediately available.

Ownership model: after a background-convert, the project's OTHER queued
dispatches are not blocked behind the converted one -- they proceed through
the same `SharedPluginPool`/`GmFairnessGuard` machinery a second, genuinely
concurrent checkout for that project, bounded by the exact same
`gm_concurrency` (machine-wide pool size) and `gm_concurrency_limit`
(per-project fairness cap, see above) this file already documents. A
background-converted dispatch still counts as one held pool slot and one held
fairness-guard slot for its entire real runtime -- it is not exempt from
either cap, it only stops holding the WORKER and the daemon TICK hostage.
