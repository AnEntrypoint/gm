# gm parity contract

This file lists what gm does, observably, so that a native implementation can be checked against it without running gm. Every item has one witness: a command and the line it prints when gm matches. Run the command against your own binary and compare the line.

Witness command form, from the gm checkout:

    node tools/parity-contract.mjs <your binary> <Wn>

It starts a gm server in a scratch workspace (the binary is started as `<binary> serve --workspace <dir> --run-dir <dir>/run --mcp-config <file>`, with playwriter disabled), drives it over JSON-RPC on stdio, and prints `<Wn> pass <observed>` or `<Wn> FAIL <reason>`. Items W17 to W22 run the install, check-build and relay tools from this checkout. The build directory they install from is the binary's own build tree (`native/components/host` under it) when the binary is in one, and this checkout's `build/release` otherwise. Expected lines are exact, byte for byte, unless marked host-dependent.

Protocol version negotiated by the witnesses: 2025-06-18. Both engines serve 2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05 and 2024-10-07 (tools/check-protocol-versions.mjs).

## 1. Tools

### 1.1 Tool list (W1)

Three tools, nothing else in tools/list.

    node tools/parity-contract.mjs <bin> W1
    W1 pass tools finish,next_context,run_code

### 1.2 next_context

Arguments (all optional): `waitMs` number, `full` boolean, `child` boolean, `run` string, `compactChildren` boolean, `task` string, `owner` boolean.

- Full reply (first call of a run, or `full: true`): keys ok, step, run, stepsLeft, maxSteps, rules, task, witness, prefixSha, total, pendingCommands, events, query (plus taskNotice, tabs, and others when relevant).
- Unchanged reply (nothing new since the last reply, and no `full`): keys `ok, run, steps, stepsLeft, unchanged`, with `unchanged: true`. A caller's own run_code is not a change.
- `waitMs` holds the call until an event is pending or the time passes, at most 100000 ms.

Witness (W5):

    node tools/parity-contract.mjs <bin> W5
    W5 pass next_context first full=true keys-include-prefixSha=true; repeat unchanged=true keys=ok,run,steps,stepsLeft,unchanged

Witness (W6), the full reply's listed keys:

    node tools/parity-contract.mjs <bin> W6
    W6 pass full reply has 12/12 listed keys; stepsLeft=49 maxSteps=50

(stepsLeft and maxSteps depend on the run's configured max; the 50 is the default.)

### 1.3 run_code

Arguments: `body` string (required); `timeoutMs` integer 1 to 3600000 (the foreground cutoff; a body still running at its cutoff returns its job id and its end arrives as an event); `format` `esm` or `cjs`.

Reply on success: `ok: true, output` (the body's return value), `truncated`, `loads`, `actionSeq`.

Error cases:
- The body throws: `ok: false`, `error` with the message, then a stack line `at body (<body>:L:C)`.
- The body does not load (syntax): `ok: false`, `error` starting `the body does not load:`.
- First run_code on a connection before the skill was read: refused once, `ok: false`, with the text naming skill://gm/SKILL.md; the skill text is the second content block. A second run_code then runs.
- A call after the run has ended: `ok: false, refused: true`, `error` `refused: run <id> has ended; call next_context to open a new run`.

Witness (W2):

    node tools/parity-contract.mjs <bin> W2
    W2 pass run_code ok=true output={"a":1} truncated=false loads=[]

Witness (W3), throw and syntax errors:

    node tools/parity-contract.mjs <bin> W3
    W3 pass throw ok=false error-first-line="x"; syntax ok=false error-prefix="the body does not load: unex"

Witness (W4), the one-time skill refusal:

    node tools/parity-contract.mjs <bin> W4
    W4 pass first run_code before skill read ok=false refused-once=true; second ok=true

### 1.4 finish

Arguments: `witness` string (required); optional `gaps` (array of strings), `stopBackground` boolean, `openRows` (array of objects).

Reply on success: `ok: true, finished: true, output` (the witness text), `browser` (`ok, closedPages, skipped`).

Error cases: a finish without `witness` is refused; a second finish on an ended run is refused with `refused: true`.

Witness (W7):

    node tools/parity-contract.mjs <bin> W7
    W7 pass finish ok=true finished=true output="parity witness"; second finish refused=true

Witness (W8):

    node tools/parity-contract.mjs <bin> W8
    W8 pass finish without witness refused=true

## 2. Resources

### 2.1 Served skills (W9)

- `skill://gm/SKILL.md` (markdown, frontmatter `name: gm` first).
- `skill://gm/WORKFLOWS.md`.
- `skill://gm-continue/SKILL.md` is listed by resources/list.
- An unknown skill or file is error code -32002 with the message `resource not found: <uri>` and `data.uri`.

    node tools/parity-contract.mjs <bin> W9
    W9 pass skill-md starts "---\nname:"; workflows bytes true; unknown skill code -32002 message "resource not found: skill://nope/X.md"

### 2.2 Run log (W10, W13)

`run://<run>/log` returns the run's events, one JSON object per line, the newest 64 KB cut at a line boundary. The first event of a new run has kind `start` and seq 1.

    node tools/parity-contract.mjs <bin> W10
    W10 pass run log first event kind=start seq=1

    node tools/parity-contract.mjs <bin> W13
    W13 pass run log readable=true

### 2.3 Run witness (W11)

`run://<run>/witness` is -32002 until the run finishes; after finish it returns the finish witness as text.

    node tools/parity-contract.mjs <bin> W11
    W11 pass witness before finish code=-32002; after finish "parity witness text"

### 2.4 Templates (W12)

Exactly these four, in this order:

    node tools/parity-contract.mjs <bin> W12
    W12 pass templates skill://{name}/SKILL.md skill://{name}/{path} run://{run}/log run://{run}/witness

## 3. Process wait and the job_status cap

### 3.1 Pid wait returns at exit (W14)

`gm.job_status({ pid, waitMs })` inside run_code returns when the process exits, with `state: "gone"` for a process gm did not start, and `exitCode` null. Measured: a 2 s process returned at 2.01 s (median of 3); a 4 s process at 4.03 s.

    node tools/parity-contract.mjs <bin> W14
    W14 pass pid wait state=gone returned-before-20s=true exitCode=null

### 3.2 The 100 s cap (W15)

A job or pid wait is clamped to 100000 ms: `waitMs` above 100000 is accepted and behaves as 100000, not refused. The reply does not carry the clamp, so the cap is stated in the verb's description (`gm.verbs()`), which says "at most 100000". The witness checks that text, a 2 s process with `waitMs` just below (99999) and just above (100001) the cap, which must both return `gone` before 3 s, and a live process with `waitMs` 3000, which must hold for about 3 s and return `running`. It takes about 7 s; a witness that waits out the cap itself would take 100 s.

    node tools/parity-contract.mjs <bin> W15
    W15 pass cap 100000 in the verb description: true; waitMs below and above the cap on a 2 s process: gone true true; a live process with waitMs 3000: state=running waited-3s=true

### 3.3 One-body loop (W16)

A longer wait is a loop inside one run_code body, which returns once the state is not `running`. Measured: a 4 s process with waitMs 1000 took 4.03 s in one reply, 4 calls.

    node tools/parity-contract.mjs <bin> W16
    W16 pass one-body loop returned state=gone with calls>=2: true

## 4. Install switch

`scripts/install.sh --local <build dir>` installs the build into `$HOME/.gmnew`. The layout: `versions/<id>/` holds each install, `current` is a symlink to `versions/<id>` that is switched by one rename, and `previous-<id>` is a symlink to the install it replaced. A second install keeps the replaced install as `previous-<its id>` and prints `kept the previous install`.

Witness (W17), an install over an older one:

    node tools/parity-contract.mjs <bin> W17
    W17 pass install exit=0/0; current is a link true; previous-older-dev link to versions/older-dev true; kept line true

Witness (W18), the installed skills equal the checkout's skills file for file:

    node tools/parity-contract.mjs <bin> W18
    W18 pass install exit=0; installed skills equal the checkout's: true

Running relays are not restarted by an install. A relay started from a versioned install polls the link about every 2 s and re-executes on its next call (W21).

## 5. check-build

`node tools/check-build.mjs <build dir> [--only <scenario>]`

- Scenarios: the conformance run, then 23 native scenarios and 4 node scenarios. A scenario that passes is recorded in `<build dir>/check-build-cache.json` with a key from the binary's size and mtime and the stat of `src`, `skills`, `defaults`, `tools` and `native/leaves`. An unchanged scenario prints `skipped, inputs unchanged`.
- Pool: scenarios run in parallel, `GM_CHECK_JOBS` lanes, default `min(6, floor(cores / 2))`. The one exclusive scenario, check-relay-reexec, runs alone.
- `--only <scenario>` runs only that scenario (or `conformance`).
- The summary line is `check-build: <n> run, <f> failed, jobs <j>, wall <s> s; longest: ...`.

Witness (W19), `--only` selects one scenario:

    node tools/parity-contract.mjs <bin> W19
    W19 pass --only lists ["check-repeated-checks.mjs"]; exit 0

Witness (W20), the cache and the default pool size (host-dependent: on a host with 12 or more cores the pool is 6):

    node tools/parity-contract.mjs <bin> W20
    W20 pass cache: second --only run runs 0 scenarios; pool default jobs 6 (min 6, cores/2)

## 6. Relay re-exec on the stable path

After an install moves `current`, a relay started from `versions/<old>` re-executes through `<home>/.gmnew/current/gm` on the same pid, carrying any waiting next_context call. Witness (W21) runs tools/check-install-switch.mjs against your binary:

    node tools/parity-contract.mjs <bin> W21
    W21 pass relay re-exec on the stable path: exit 0; same pid switched

## 7. skill-serve default

With no `--skills` argument, the served skill is the checkout's `skills/gm/SKILL.md` when a checkout is present, and a live connection returns each change to the copied file on the next read (tools/check-skill-serve.mjs).

    node tools/parity-contract.mjs <bin> W22
    W22 pass skill-serve default: exit 0; default serve returns checkout skill: true
