# Compiled deviation kinds

Every deviation this build can emit, generated from the SAME table (`orchestrator::deviations::DEVIATION_TABLE`) the emitters themselves reference, so this cannot silently drift out of sync with what actually fires. A kind absent from this list is not emitted by any compiled code path -- if the served doctrine names one, the doctrine is describing an enforcement that does not exist.

`severity` is the DEFAULT. Override it per project by adding a `deviation_severity` map to the `policy` object in .gm/instructions/fsm/graph.json, keyed by the kind name and valued `"deny"` or `"log"`:

```json
{ "policy": { "deviation_severity": { "unsolicited-doc-created": "deny", "synthetic-test-file": "deny" } } }
```

`deny` means the emitter refuses the dispatch (a gate denial, or a non-zero rc). `log` means it records the event and lets the dispatch proceed. The map is empty by default, so an unconfigured project gets exactly the severities listed below. A key naming an unknown kind, or a value that is neither `deny` nor `log`, falls back to the default and is reported by `fsm-validate` rather than silently configuring nothing.

- `await-result-violation` (default `deny`) -- a verb outside `policy.await_allowed_verbs` was dispatched while a pending_step was in flight -- the pipeline is suspended and only memorize-continue advances it
- `bash-git-bypass` (default `deny`) -- a shell verb (per `policy.shell_verbs`) invoked `git` directly, bypassing the porcelain gate and the witness ledger -- the git_* verbs are the admissible surface
- `long-gap-no-instruction` (default `deny`) -- a verb was dispatched after more than `policy.longgap_threshold_ms` of idle with no intervening `instruction` -- idle mid-chain loses the recovery prose
- `long-gap-retry-without-instruction` (default `deny`) -- the same verb was retried after the long-gap gate already denied it, instead of dispatching the `instruction` its next_dispatch named
- `gate-deny` (default `deny`) -- a `transition` was refused because the destination edge's gates reported residuals -- the residual list names what is still open
- `stuck-loop-escalation` (default `deny`) -- the same gate denial has now fired `policy.gate_repeat_escalate_threshold` times in a row with no successful transition between attempts -- blind retry is not clearing it
- `unsolicited-doc-created` (default `log`) -- an fs_write created a top-level .md/.txt outside `policy.toplevel_doc_allowlist` -- a report/summary file written instead of doing or witnessing the work
- `prd-anti-shape` (default `log`) -- a PRD row was carried into a closing transition already marked closed but with empty witness_evidence -- closed-without-evidence is the rubber-stamp shape
- `prd-add-no-id` (default `log`) -- a `prd-add` body arrived with no usable id, so one was derived from the subject -- the derived id is what `prd-resolve` must later reference
- `prd-resolve-no-witness` (default `deny`) -- `prd-resolve` was dispatched with empty witness_evidence while `policy.require_witness_evidence` is set -- a row cannot close without evidence the work is real
- `prd-resolve-duplicate-witness` (default `deny`) -- `prd-resolve` supplied witness_evidence byte-identical to another row's, while `policy.reject_duplicate_witness` is set -- copy-pasted witness text across distinct rows is the rubber-stamp tell
- `prd-resolve-unknown-id` (default `deny`) -- `prd-resolve` named an id that is not in .gm/prd.yml -- the row was never prd-added in this chain, or the id is a typo (see `suggested_id`)
- `residual-premature` (default `log`) -- `residual-scan` was dispatched while .gm/prd.yml still carries open rows -- the scan is a close-out probe and has nothing to report until the PRD is empty
- `residual-dirty-tree` (default `log`) -- `residual-scan` found an uncommitted/untracked delta in the worktree -- every porcelain entry needs triage (commit, gitignore, or revert) before close-out
- `platform-search-drift` (default `log`) -- a platform Grep/Glob fired during an in-flight chain -- codesearch/recall are the discovery surfaces; platform search is exploration outside the spool
- `spool-poll` (default `log`) -- a shell command was observed polling the exec-spool directly (ls/cat/sleep loop over .gm/exec-spool) -- results arrive by dispatch, polling is idle-mid-chain
- `complete-chain-poll` (default `log`) -- `instruction` was re-dispatched on an already-terminal chain with zero pending PRD rows and no fresh prompt -- the chain is closed; a new request resets it
- `browser-witness-missing` (default `deny`) -- a client-side file was edited this session but never witnessed in a browser dispatch -- disk-Read is necessary and insufficient, the live page is the authority
- `browser-witness-hash-mismatch` (default `deny`) -- a client-side file was witnessed in the browser, then edited again -- the recorded witness hash no longer matches the file's current content
- `synthetic-test-file` (default `log`) -- the working tree carries a standing test file (a `*.test.*`/`*.spec.*` path, or a `test/`/`__tests__/`/`spec/` directory) -- doctrine is live exec_js/browser witnesses, not framework legwork deferred to a later run
- `push-non-main-branch` (default `log`) -- `git_push` ran against a branch other than the repo's main line -- the workflow is main-only, a feature branch strands the slice
- `push-dirty` (default `log`) -- `git_push` was attempted with a dirty worktree -- a dirty-tree push advances an unwitnessed slice
- `push-rebase-conflict` (default `log`) -- `git_push`'s rebase-retry hit a conflict against the remote -- the push did not land and the conflict needs resolving first
- `push-remote-outpaces` (default `log`) -- `git_push` found the remote ahead after its rebase-retry budget was spent -- another writer is pushing to the same branch concurrently
- `push-claimed-success-unverified` (default `deny`) -- `git_push` exited success but a post-push fetch found origin does not match local HEAD -- the push did not actually land despite the reported exit code