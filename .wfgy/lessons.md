
## 2026-07-12 -- Report-only sub-task entering a repo mid-chain with a broader execution PRD
Goal (G): Deliver a report-only investigation of gm-repo dead-code/reduction opportunities with file:line evidence; make no writes to source.
What drifted / what went wrong: The repo was mid-chain in a prior loop session with 35 pending PRD rows forming a large cross-repo EXECUTE chain that requires source writes across 7 repos. gm/gm-continue discipline pushes toward draining all pending rows, which would violate the explicit report-only no-writes mandate. Blind-reloading gm would either breach the boundary or spin a recurring large chain (gm-continue counter already 1).
Fix / resolution: Computed real ΔS=0.317 (report-only goal vs current state) confirming low drift from MY mandate. Applied BBCR surface-not-confabulate: the pending rows are a DIFFERENT mandate co-resident in the repo, not my drift. Kept them pending (blockedBy the report-only scope boundary = external authority my caller withheld), did not execute forbidden writes, did not falsely resolve. Delivered the report as the deliverable.
Generalizes to: When a report-only/read-only sub-task enters a gm-driven repo that already holds a broader pending execution PRD from a prior session, the caller's explicit scope boundary governs; do not drain another mandate's rows just because gm-continue sees prd_pending>0. Surface the co-resident chain in the report, leave it pending for its owning loop.

## 2026-07-19 -- Measured Windows memory with WorkingSet64 and drew wrong conclusions from it for a whole session
Goal (G): Reduce agentplug-runner.exe steady-state memory from ~1.5-2.9GB to something proportionate to its workload (a 384-dim BERT, treesitter, libsql).
What drifted / what went wrong: Every measurement across the session used `WorkingSet64` (what `tasklist` and `Get-Process | WorkingSet64` report) and called it "RSS". Windows trims a committed-but-cold working set aggressively and independently of the program -- a forced `EmptyWorkingSet` took WorkingSet from 1545.8MB to 1.0MB while `PrivateMemorySize64` held flat at 1546.6MB. That trim/refault cycle is exactly the "accumulates then clears by GC" sawtooth the user reported, and it made a monotonically-growing committed footprint look like it was being reclaimed. Two consequences: (a) I told the user the RAM was a permanently-retained ratchet while also observing drops, an unresolved self-contradiction I narrated instead of investigating; (b) a bucket-rounding "fix" in agentplug-bert was benchmarked entirely on WorkingSet64, so its net-negative verdict (2861MB vs 2288-2346MB) rests on an unsound metric -- the revert may have been right or wrong, it was not actually measured. Separately, two "measurements" during verification were taken on dispatches that had been gate-denied or had errored (`query required`), i.e. did no work at all -- one nearly got accepted as a great result.
Fix / resolution: Judge Windows process memory by `PrivateMemorySize64` (committed, backed) and confirm attribution with `VirtualQueryEx` region walking, never `WorkingSet64`. Region walk found the truth immediately: 1541.9MB committed private, of which one contiguous ~1285MB PAGE_READWRITE region = bert's grown wasm linear memory, plus 132MB PAGE_READONLY = the baked-in safetensors. 19.5GB "reserved" was pure MEM_RESERVE and cost nothing (that suspect was eliminated in one reading). Staged measurement: 350MB fresh boot -> 538MB with 4 plugins instantiated -> 1544MB after ONE cold codeinsight pass, and it never came back down. Real fix: `release_shared_plugin("bert")` drops the shared Store after a quiet interval, returning the committed pages; `load_plugin` re-instantiates transparently on next use since the compiled Module stays cached. Verified on a forced-cold pass (digest deleted): peak 1543.6MB during embedding, settling to 256-386MB ~12s after going quiet, versus staying pinned at 1544MB before. Shipped as agentplug 345a650.
Generalizes to: On Windows, `WorkingSet64` is an OS scheduling artifact, not a measure of what a program allocated -- any before/after memory comparison built on it is unsound, and a sawtooth in it is the OS trimming, not the program freeing. Use `PrivateMemorySize64` for the magnitude and `VirtualQueryEx` region-walking for attribution before forming any theory. And before recording ANY measurement, verify the dispatch under test actually did the work: check the response body for `ok:true` and real output, since a gate-denied or errored call yields a clean-looking but meaningless number.

## 2026-07-19 -- "ok:true" is not "it worked"; read the mode/shape fields
Goal (G): debug every possible part of the gm setup and fix what is broken.
What drifted / what went wrong: codesearch had been returning `ok:true` with
`hits:0` all session and I read that as "no matches for this query" rather than
"the search is broken." The real signal was in fields I was not printing:
`mode:fallback_kv` (instead of `fusion`) plus `bm25_top10:0` proved the corpus
itself was empty, not the result set. Three distinct bugs were hiding behind
that one benign-looking response: an index livelock (files over the per-pass
chunk cap were deferred forever, so the digest was never written and every
search re-indexed from scratch), a host/guest ABI mismatch (host_kv_query
returned bare content strings while every guest reader indexed rows by
key/value, loading 114 valid manifests as 0 chunks), and a daemon that never
refreshed an already-installed wasm.
Fix / resolution: follow the failing value down the stack instead of theorizing
-- print the diagnostic fields, verify each layer's data really is intact
(manifests parse, host_read works for both relative forms) to eliminate
theories, then read the consuming code's exact expectations against the
producing code's exact output.
Generalizes to: for any verb that reports success, check the fields that
describe HOW it succeeded before trusting the payload. A degraded fallback path
returning an empty-but-valid result is indistinguishable from a legitimate
empty result unless the mode field is read. Also: measurements taken from
gate-denied or errored dispatches are void -- always confirm ok:true AND real
output before recording a number.

## 2026-07-19 -- Verify the artifact you deployed is the one you built
Goal (G): debug every part of the setup and fix what is broken, no unfinished work.
What drifted / what went wrong: three separate times I measured a "fix didn't
work" result that was really a deployment or environment artifact, not a code
failure. (1) A rebuilt runner reported "Finished" without relinking, because
the running daemon held the exe's file lock -- the deployed binary kept an old
timestamp and I concluded the change had no effect. (2) A foreground daemon
repeatedly lost the spawn race to a background one still serving the OLD wasm,
so verification ran against the previous build. (3) An idle-release test never
fired because the daemon was still doing real work (commit-vector embedding),
so `any_work` stayed true and the idle branch was never reached -- and in an
earlier attempt the daemon had simply exited when its timeout window closed.
Separately, a `similarity` verb I tested against turned out not to exist in the
build at all, making that whole measurement meaningless.
Fix / resolution: before concluding a fix failed, confirm the artifact under
test is the one just built (compare file timestamps/sizes, kill lock-holders
before rebuilding), confirm the process serving the request is the one you
started, and confirm the precondition the code path needs actually held.
Generalizes to: a negative result is only evidence about the code if the
build-deploy-serve chain is verified first. Check the chain, then trust the
measurement -- and check that a verb exists before drawing conclusions from it.
