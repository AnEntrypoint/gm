# Brief for /workspace/pw: browser tooling that starts on first use

Owner: the playwriter repo (read-only to gm). The dispatcher routes this brief.

## What gm already does (this checkout)

- `defaults/mcp.json` marks the playwriter entry `"lazy": true`. A lazy server
  is not connected when the worker starts. Its tool list comes from
  `defaults/mcp-tools/playwriter.json`, so `gm.verbs()` still lists
  `playwriter_execute` and `playwriter_browsers`. The first call to one of them
  starts the server (native/components/mcpclient/mcpclient.cpp, `start_all`,
  `read_tool_cache`; `StdioClient::call_tool` connects on demand).
- Witness at this commit: a fresh `gm serve` has no playwriter child; the first
  `playwriter_browsers` call starts the chain.

## What changes in /workspace/pw

Measured on this host at 17:00 UTC: 34 playwriter-related processes, 1,939 MB.
Nine gates (`playwriter-project --gate`) had init as parent. Each gate holds the
leases of live launcher processes. Each session's launcher was started eagerly
by gm at worker start, so one session cost a launcher, a gate and a browser
whether it used one or not. Gm now starts it on first use. Four changes in pw
finish the job.

1. **Gate exit on last lease** (bin/playwriter-project, `res.on('close', ...)` at
   line 540 and the exit test at lines 582-585). Today a gate exits only when no
   lease is held AND `idle >= IDLE_MS` (300000 ms). Change: when the lease count
   falls to zero, stop the browser this gate owns (not an adopted one), wait a
   grace of 5000 ms for a new lease, then `process.exit(0)`. Keep the idle rule
   for a gate that never had a lease.

2. **Launcher death releases its lease at once.** The lease is a socket held
   by the launcher (`/__pwp/lease`, line 537). Confirm the close event fires when
   the launcher is SIGKILLed; add a test that kills a launcher and expects the
   gate to exit within the grace.

3. **No gate for an MCP session until a browser tool runs.** `main()` (line 817)
   calls `ensureGate` (line 598) and `openLease` (line 823) before it knows the
   command. In the MCP path, open the lease inside the first `execute` or
   `browsers` call, not when the server starts. A `tools/list` must not start a
   gate.

4. **One process per session, not npm exec.** The shipped entry runs
   `npx -y -p github:AnEntrypoint/pw#<ref> playwriter-project`, which is npm
   exec, then a shim, then node. gm will register the bin directly as
   `node <install>/pw/bin/playwriter-project` once `gm install` can place the pw
   bin next to the gm binaries. For that, the bin must run with node and the
   packages it needs under that directory, with no npx at run time.

## Acceptance (pw side)

- `playwriter-project --gate` in one project: start a launcher, open a lease,
  kill the launcher with SIGKILL, and the gate exits within 10 s.
- Two launchers in one project share one gate and one browser; killing one keeps
  the browser for the other; killing both stops both within 10 s.
- `tools/list` on a fresh launcher starts no gate (`ls /proc/<launcher>/task`
  shows no child with `--gate`).
- The tool list matches `defaults/mcp-tools/playwriter.json` at the pinned ref.
  Regenerate that file when the ref changes; gm-tool check-lazy-browser checks
  that the verbs listed are the ones in the file.

## Facts behind the brief

- The nine gates at 17:00 UTC: 1430 (hyperagent), 1756 (gm), 3557 (jayzee,
  parent 3550), 3610 (fx), 3825 (thebird), 234948 (/tmp) and 238018 (a probe). Their lease holders were live launcher processes, each the MCP
  child of one session's worker. Gates with ppid 1 are detached by design.
- A gate with no lease and no browser exits after 300 s of idle time. That is the
  delay items 1 and 2 remove.
