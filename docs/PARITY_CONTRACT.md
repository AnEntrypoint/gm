# gm parity contract

This file lists what gm does, observably, so that a native implementation can be checked against it without running gm. Every item has one witness: a command and the line it prints when gm matches. Run the command against your own binary and compare the line.

Witness command form, from the gm checkout:

    gm-tool check <your binary> parity-contract

It starts a gm server in a scratch workspace (the binary is started as `<binary> serve --workspace <dir> --run-dir <dir>/run --mcp-config <file>`, with playwriter disabled), drives it over JSON-RPC on stdio, and prints `<Wn> pass <observed>` or `<Wn> FAIL <reason>`. Items W17 to W22 run the install, check-build and relay tools from this checkout. The build directory they install from is the binary's own build tree (`native/components/host` under it) when the binary is in one, and this checkout's `build/release` otherwise. Expected lines are exact, byte for byte, unless marked host-dependent.

Protocol version negotiated by the witnesses: 2025-06-18. Both engines serve 2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05 and 2024-10-07 (gm-tool check-protocol-versions).

## 1. Tools

### 1.1 Tool list (W1)

Three tools, nothing else in tools/list.

    gm-tool check <bin> parity-contract
    W1 pass tools finish,next_context,run_code

### 1.2 next_context

Arguments (all optional): `waitMs` number, `full` boolean, `child` boolean, `run` string, `compactChildren` boolean, `task` string, `owner` boolean.

- Full reply (first call of a run, or `full: true`): keys ok, step, run, stepsLeft, maxSteps, rules, task, witness, prefixSha, total, pendingCommands, events, query (plus taskNotice, tabs, and others when relevant).
- Unchanged reply (nothing new since the last reply, and no `full`): keys `ok, run, steps, stepsLeft, unchanged`, with `unchanged: true`. A caller's own run_code is not a change.
- `waitMs` holds the call until an event is pending or the time passes, at most 60000 ms.

Witness (W5):

    gm-tool check <bin> parity-contract
    W5 pass next_context first full=true keys-include-prefixSha=true; repeat unchanged=true keys=ok,run,steps,stepsLeft,unchanged

Witness (W6), the full reply's listed keys:

    gm-tool check <bin> parity-contract
    W6 pass full reply has 12/12 listed keys; stepsLeft=49 maxSteps=50

(stepsLeft and maxSteps depend on the run's configured max; the 50 is the default.)

### 1.3 run_code

Arguments: `body` string (required); `timeoutMs` integer 1 to 3600000 (the foreground cutoff; a body still running at its cutoff returns its job id and its end arrives as an event); `format` `esm` or `cjs`.

Reply on success: `ok: true, output` (the body's return value), `truncated`, `loads`, `actionSeq`.

Error cases:
- The body throws: `ok: false`, `error` with the message, then a stack line `at body (<body>:L:C)`.
- The body does not load (syntax): `ok: false`, `error` starting `the body does not load:`.
- First run_code on a connection before the skill was read: refused once, `ok: false`, with the text naming skill://gm/SKILL.md; the skill text is the `skill` field of the reply JSON. A second run_code then runs.
- A call after the run has ended: `ok: false, refused: true`, `error` `refused: run <id> has ended; call next_context to open a new run`.

Witness (W2):

    gm-tool check <bin> parity-contract
    W2 pass run_code ok=true output={"a":1} truncated=false loads=[]

Witness (W3), throw and syntax errors:

    gm-tool check <bin> parity-contract
    W3 pass throw ok=false error-first-line="x"; syntax ok=false error-prefix="the body does not load: unex"

Witness (W4), the one-time skill refusal:

    gm-tool check <bin> parity-contract
    W4 pass first run_code before skill read ok=false refused-once=true; second ok=true

### 1.4 finish

Arguments: `witness` string (required); optional `gaps` (array of strings), `stopBackground` boolean, `openRows` (array of objects).

Reply on success: `ok: true, finished: true, output` (the witness text), `browser` (`ok, closedPages, skipped`).

Error cases: a finish without `witness` is refused; a second finish on an ended run is refused with `refused: true`.

Witness (W7):

    gm-tool check <bin> parity-contract
    W7 pass finish ok=true finished=true output="parity witness"; second finish refused=true

Witness (W8):

    gm-tool check <bin> parity-contract
    W8 pass finish without witness refused=true

## 2. Resources

### 2.1 Served skills (W9)

- `skill://gm/SKILL.md` (markdown, frontmatter `name: gm` first).
- `skill://gm/WORKFLOWS.md`.
- `skill://gm-continue/SKILL.md` is listed by resources/list.
- An unknown skill or file is error code -32002 with the message `resource not found: <uri>` and `data.uri`.

    gm-tool check <bin> parity-contract
    W9 pass skill-md starts "---\nname:"; workflows bytes true; unknown skill code -32002 message "resource not found: skill://nope/X.md"

### 2.2 Run log (W10, W13)

`run://<run>/log` returns the run's events, one JSON object per line, the newest 64 KB cut at a line boundary. The first event of a new run has kind `start` and seq 1.

    gm-tool check <bin> parity-contract
    W10 pass run log first event kind=start seq=1

    gm-tool check <bin> parity-contract
    W13 pass run log readable=true

### 2.3 Run witness (W11)

`run://<run>/witness` is -32002 until the run finishes; after finish it returns the finish witness as text.

    gm-tool check <bin> parity-contract
    W11 pass witness before finish code=-32002; after finish "parity witness text"

### 2.4 Templates (W12)

Exactly these four, in this order:

    gm-tool check <bin> parity-contract
    W12 pass templates skill://{name}/SKILL.md skill://{name}/{path} run://{run}/log run://{run}/witness

## 3. Process wait and the job_status cap

### 3.1 Pid wait returns at exit (W14)

`gm.job_status({ pid, waitMs })` inside run_code returns when the process exits, with `state: "gone"` for a process gm did not start, and `exitCode` null. Measured: a 2 s process returned at 2.01 s (median of 3); a 4 s process at 4.03 s.

    gm-tool check <bin> parity-contract
    W14 pass pid wait state=gone returned-before-20s=true exitCode=null

### 3.2 The 60 s cap (W15)

A job or pid wait is clamped to 60000 ms: `waitMs` above 60000 is accepted and behaves as 60000, not refused. A reply that says running carries a hint line: call job_status again to keep waiting. The reply does not carry the clamp, so the cap is stated in the verb's description (`gm.verbs()`), which says "at most 60000". The witness checks that text, a 2 s process with `waitMs` just below (59999) and just above (60001) the cap, which must both return `gone` before 3 s, and a live process with `waitMs` 3000, which must hold for about 3 s and return `running`. It takes about 7 s; a witness that waits out the cap itself would take 60 s.

    gm-tool check <bin> parity-contract
    W15 pass cap 60000 in the verb description: true; waitMs below and above the cap on a 2 s process: gone true true; a live process with waitMs 3000: state=running waited-3s=true

### 3.3 One-body loop (W16)

A longer wait is a loop inside one run_code body, which returns once the state is not `running`. Measured: a 4 s process with waitMs 1000 took 4.03 s in one reply, 4 calls.

    gm-tool check <bin> parity-contract
    W16 pass one-body loop returned state=gone with calls>=2: true

## 4. Install switch

`scripts/install.sh --local <build dir>` installs the build into `$HOME/.gmnew`. The layout: `versions/<id>/` holds each install, `current` is a symlink to `versions/<id>` that is switched by one rename, and `previous-<id>` is a symlink to the install it replaced. A second install keeps the replaced install as `previous-<its id>` and prints `kept the previous install`.

Witness (W17), an install over an older one:

    gm-tool check <bin> parity-contract
    W17 pass install exit=0/0; current is a link true; previous-older-dev link to versions/older-dev true; kept line true

Witness (W18), the installed skills equal the checkout's skills file for file:

    gm-tool check <bin> parity-contract
    W18 pass install exit=0; installed skills equal the checkout's: true

Running relays are not restarted by an install. A relay started from a versioned install polls the link about every 2 s and re-executes on its next call (W21).

## 5. Phase B driver

`gm-tool phase-b` (native/components/tool/driver.cpp) runs every registered native check through `gm-tool check`, in a pool of min(6, floor(cores/2)) lanes (GM_CHECK_JOBS overrides), longest first. A check that fails in the pool is rerun alone. A run fails when a check changes a tracked file in the checkout. The clock-mutation check runs last, only with GM_CHECK_MUTATIONS=1, and a bare `gm-tool check <bin>` never runs it. tools/check-build.mjs remains as the CI driver (.github/workflows/release.yml and arm-diagnose.yml); Phase B no longer calls node.

Parity rows W19 and W20 (the check-build `--only` and cache witnesses) were removed with tools/parity-contract.mjs: they tested the Node driver, and the native driver's pool and cache are checked inside phase-b itself.

## 6. Relay re-exec on the stable path

After an install moves `current`, a relay started from `versions/<old>` re-executes through `<home>/.gmnew/current/gm` on the same pid, carrying any waiting next_context call. Witness (W21) runs `gm-tool check <bin> check-install-switch` against your binary:

    gm-tool check <bin> parity-contract
    W21 pass relay re-exec on the stable path: exit 0; same pid switched

## 7. skill-serve default

With no `--skills` argument, the served skill is `skills/gm/SKILL.md` in the directory of the binary (the install, or the build tree's copy), and a live connection returns each change to the copied file on the next read (`gm-tool check <bin> check-skill-serve`).

    gm-tool check <bin> parity-contract
    W22 pass skill-serve default: exit 0; default serve returns the binary's skill: true

## 8. bounded verb output and repeat pointers

Inside run_code a read_file or run_shell result over 6000 characters is cut to its first 4500 and last 1500 characters, the whole text is kept at outputPath, and full: true returns it inline. An identical read_file call with no write verb between is answered with a pointer to its step; fresh: true reads again (server.cpp body_call, bounded_output; W23 in tools/parity-contract.mjs).

    gm-tool check <bin> parity-contract
    W23 pass bounded first read 6174 chars truncated=true omitted=12000; identical repeat is a pointer=true; fresh read 6174 chars; full read 18000 chars
