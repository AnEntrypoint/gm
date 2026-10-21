# LEAN RECORD

This is a concern of the method, not a stage of a pipeline: it is entered from whichever node the work reaches it from, and left as soon as what it asks for holds. No concern gates entry to a set of nodes.

RECORD makes the verified change durable and explains it to the history. It commits exactly the change the contract describes, with a message that states the change type, the subject and the reason the contract changed; pushes it; watches CI on the pushed sha; and closes the PRD and mutable state so the sweep can judge the artifact whole. The node exits when the commit is pushed, CI is green for that sha, the claim audit and residual scan are clean, every row and mutable is closed, and the contract-satisfied gate G_DONE has passed.

Principles in this node are applied as work, from the lean method (AnEntrypoint/lean). Each principle's attribution is the label used in gm-config/fsm/graph.json, given in its heading below.

## Verbs

Enter with transition {"to":"ADRN"} from G_NET. Read the state before writing: git_status for the porcelain state, git_diff {"stat":true} for the size of the change. Triage every porcelain entry before committing. Real work is committed. Junk is removed by exec_js calling require("node:fs").unlinkSync on that exact path. Transient runtime emission is folded into the managed gitignore block, never carried forward as pre-existing.

Commit through the git verbs only. git_finalize {"message":"<message>"} bundles add, commit, the porcelain probe and push. It is the normal path when the worktree holds only this change. In a shared work tree it is not: it commits locally, then refuses to push while any sibling holds a dirty path, which is the normal state. The refused push leaves a local commit redundant with content already published, widening the gap between local HEAD, the work tree and remote main. That gap makes a HEAD-only check call a file absent, a pin stale, and the `dangling_reference` gate trip. In a shared work tree, publish through the Git API route instead: POST blobs, a tree with `base_tree: <remote tip>`, a commit parented on that tip, PATCH `refs/heads/main` with `force` unset, then re-read `/repos/<owner>/<repo>/contents/<path>?ref=main` (when its `content` is empty or the file is over 1 MB, fall back to `gh api /repos/<owner>/<repo>/git/blobs/<sha>` with the `sha` from that contents reply) and verify each blob. A local commit whose push was refused is reported as redundant, never carried as unpushed work, and never erased by resetting `refs/heads/main` while lanes are running. When another writer shares the worktree, commit only this change's files with git_commit {"message":"<message>","paths":["<path>", ...]} or git_finalize with the same paths, then push by explicit ref with git_push {"rev":"HEAD"}. git_push refuses a dirty tree. A commit still unpublished that needs correction is amended with git_commit {"amend":true,"message":"<message>"}. A published commit is never amended; the correction becomes a new commit.

After the push, git_log {"limit":1} gives the sha to validate, and ci-status reports the run for that head. On green, write the marker with fs_write {"path":".gm/exec-spool/.ci-validated","content":"{\"head_sha\":\"<that sha>\"}"}. On red, read the failing step, name its cause, fix the cause, and push again.

Before the transition, dispatch claim-audit, then residual-scan as the last write-free verb: residual-scan is one-shot per stop window, and any prd-add, mutable-add or mutable write invalidates its marker. Then dispatch transition {"to":"G_SWEEP"} from ADRN, which starts the sweep that re-walks every node against the whole artifact. Use node-status when the state is in doubt.

## PRD rows

A need spotted during RECORD becomes a row at once with prd-add {"id":"<kebab-case-slug>","subject":"<what it repairs or proves>"}: a missing witness, a CI failure with a named cause, a completion claim with no witness, a dirty entry with no owner. Each row closes with prd-resolve {"id":"<row id>","witness_evidence":"<commit sha, CI run id, claim-audit line or file:line>","witness_dispatch_id":"<dispatch id of your live run>"}.

The agent never writes deferral wording into a row or a transition note. Wording that moves a need to another time, another session, another person or a scope exclusion is not admitted. A need is a row now or it is not a need, and the transition note states what each row was closed by.

## Mutables

RECORD owns no obligation kind and creates no mutable. It must still leave no pending mutable, because mutables-all-resolved refuses on any pending row of any kind. Before the closing transition, list pending mutables with mutable-list and resolve each with mutable-resolve {"mutable_id":"<id>","witness_evidence":"<witness>"} only when its witness exists. A mutable without a witness returns the chain to the node that owns its kind, as described under Transition.

## Housekeeping and memory upkeep run on every finalize

Every git_finalize opens a housekeeping run before the next cover begins. The run sweeps dead code, superseded paths, and PRD and mutable rows left stale by earlier passes, so a later session does not trip over them. It applies the removal checks of PRESSURE to the whole tree on each finalize, not only when a gate fires. Each removal is witnessed by a zero-hit codesearch and a build check. Each stale row is closed with prd-resolve or re-scoped with prd-add on its existing id.

A correction the user gave that is still open when git_finalize runs is a residual, and it blocks the next cover.

## Principles

### CONVCOM - Conventional Commits

Handover: A drafted Conventional Commits type and scope are handed to RULE5072 so subject length and body format are checked before the commit. cite Conventional Commits.

The subject takes the form type(scope): summary. Type is one of feat, fix, refactor, docs, test, perf or chore, chosen from the diff: a change that makes broken behaviour correct is fix, a change that alters no observable behaviour is refactor, a new verb or surface is feat. Scope names the single crate, package or directory the change lives in. When git_diff {"stat":true} contradicts the chosen type, the commit is amended with git_commit {"amend":true} before the push.

### RULE5072 - 50/72 Commit Format - Tim Pope

Handover: A subject that passes the length probe is handed to WHYNOTWHAT so the body records why the contract changed. cite 50/72 Commit Format - Tim Pope.

The subject is at most fifty characters, imperative mood, such as "add ready-state check to dispatch". A blank line follows, and the body wraps at seventy-two columns. Before git_commit, an exec_js probe reads the drafted subject from a string literal and prints its length; an over-length subject is re-drafted. A subject that cannot be read without the diff fires the backreference to CONVCOM, and the subject is rewritten to name the changed behaviour.

### WHYNOTWHAT - The Diff Records What, the Message Records Why

Handover: A message that records the reason is handed to GITSTATE to confirm all state is a commit, and to BLAME to learn why the touched lines exist. cite The Diff Records What, the Message Records Why.

The body states why the change exists and why any contract changed, since the diff already shows what changed. The gate contract satisfied and recorded needs the reason the contract changed, so a commit that alters a signature, a row or an invariant names the cause in one or two sentences. A body that restates the diff in prose is rewritten. When the reason cannot be recovered from the history of the touched code, the backreference to ADRN fires.

### GITSTATE - Git Is the State - stateless runtime, Kapale

Handover: Repository-tracked state is handed to BLAME so the history of each changed region is read before committing it. cite Git Is the State - stateless runtime, Kapale.

Every piece of state a future reader must see is a commit, a PRD row or an unknown. No notes or sidecar files live outside the repository, except the harness memory files. Before committing, git_status confirms that every touched path is tracked or deliberately ignored by the managed block. State that exists outside the repository fires the backreference to LIVEPLAN: move it into a commit or remove it, and rewrite the live plan to point at the commit.

### BLAME - git blame as the Index

Handover: The introducing commit read from history is handed to BISECT, which uses it as the reason for the changed region. cite git blame as the Index.

Before committing a changed region, the agent learns why it exists: git_log {"path":"<file>","limit":10} on the file, then git_show {"rev":"<introducing sha>"} for the commit that introduced the region. That commit's message is the recorded reason. When the introducing commit explains nothing, the backreference to RULE5072 fires, and the new message records why the old line was written.

### BISECT - git bisect as the Regression Oracle - Linus Torvalds

Handover: The first red sha from a regression oracle is handed to SEMVER so the public-surface version bump follows the isolated change. cite git bisect as the Regression Oracle - Linus Torvalds.

When a witness that passed earlier now fails, the failing command is the regression oracle. The agent takes the range from git_log {"limit":20} back to the last good commit, and at each candidate sha reproduces that commit READ-ONLY: prefer `gh api /repos/<owner>/<repo>/contents/<path>?ref=<sha>` (when its `content` is empty or the file is over 1 MB, fall back to `gh api /repos/<owner>/<repo>/git/blobs/<sha>` with the `sha` from that contents reply) for the one file the command reads, or, for a whole tree, `gh api repos/<owner>/<repo>/git/trees/<sha>?recursive=1` with the blob route for each file; run the same red-capable command through exec_js. Only when neither answers the question does the agent create a detached worktree with git_worktree_add {"path":"<absolute scratch path>","ref":"<sha>"}, run the command there, then remove it with git_worktree_remove {"path":"<absolute scratch path>"}. A worktree is a LAST RESORT for a read-only reproduction, never a place to edit, commit or publish from: every extra tree ends in a consolidation run, and a publish from one merges back into the tree every other lane is writing. The first red sha isolates the change, and its message must explain it. When no commit isolates the change, the backreference to LIVEPLAN fires.

### SEMVER - Semantic Versioning - Tom Preston-Werner

Handover: A version bump matching the changed public surface is handed to ADRN, which decides whether an irreversible fork needs a record. cite Semantic Versioning - Tom Preston-Werner.

When the change alters a public surface (a gm verb body, a CLI flag, an exported function, a file format), the version in Cargo.toml or package.json moves in the same commit. An incompatible change is a major bump, an added surface is minor, and a behaviour fix with no surface change is patch. The caller list from G_INDEP identifies the changed surfaces, and the bump is stated in the message body. A broken promise without a major bump fires the backreference to CONTRACTTEST, and the consumer test is re-run before the push.

### ADRN - ADR, Irreversible Forks Only - Michael Nygard

Handover: A decision record or reason is handed to G_DONE, the gate that checks the contract is satisfied and recorded. cite ADR, Irreversible Forks Only - Michael Nygard.

An architecture decision record is written only for a fork that no subsequent commit can reverse: a storage format a reader depends on, a wire protocol, a public verb name, a persistence choice other systems read. A reversible choice is recorded only in the commit's reason. The record names the options, the chosen one, and the witness that showed it works, and is pushed with the change. A reversible decision recorded as an ADR fires the backreference to YAGNI, and the record is removed in its own commit with the reason in its message.

## Witness

RECORD owns no typed obligation, so each closing predicate is witnessed by the verb that reads it, and the reply is quoted in the transition note.

- ci-validated-fresh: the marker's head_sha equals the sha git_log {"limit":1} reports for HEAD after the push. A marker for an earlier sha is refused; each new push needs a new CI run and marker.
- worktree-clean and submodules-clean: git_status is empty and the submodule check reports no drift. A submodule change is committed and pushed inside the submodule first, then its new commit is pinned in the parent, then the parent is pushed.
- claim-audit-clean: claim-audit reports no completion claim without a witness. Each claim in the message, the rows and the transition note is witnessed or removed.
- residual-scan-fired: residual-scan ran last, and its reply names the open surface. A non-empty surface is a missed row: prd-add it and re-run from the node start, since a clean scan on a short PRD for a long prompt is a false negative.
- no-hedge-language-in-diff: every new prose line is re-read for hedges and deferral wording. The gate catches the common phrases, so the agent also checks the shape the list misses: a commitment stated and then qualified into a non-decision.
- The human outcome: each shipped change is traced to something a person would see, such as a capability gained, a wait removed, a failure no longer hit, or a developer the interface stops fighting. A change whose chain ends in elegance with no reachable outcome is reverted with git_revert.

CI failures have named shapes with one repair each. An import error is a missing module: fix the manifest, not the source. A type error is a schema mismatch: transition to=G_CONTRACT and re-witness the interface. An assertion failure is a probe that failed in CI: root-cause it and never silence it. A lint failure is fixed in the code and never disabled. A build timeout is re-triggered once; a repeat is diagnosed (split the job, cache dependencies, raise the configured limit, find the hang) and never treated as external.

## Memory

Before the commit, each unknown that a later task needs is saved as a memory: one flat file with frontmatter fields name, description and metadata.type (value unknown), and one line in MEMORY.md that points to it. An unknown still open when the commit runs is a residual, and residual-scan refuses to converge on it. A memory that the commit contradicts is deleted with its MEMORY.md line. Diffs, CI logs and passing results are not saved as memory; git and CI already hold them.

## Transition

The node is entered with transition {"to":"ADRN"} from G_NET. The graph has no gate on that edge, since the net-negative gate already passed before PRESSURE.

The exit is ADRN, then G_DONE, the gate for "contract satisfied and recorded", whose predicate lean-contract-recorded is blocking: every PRD row is closed and the worktree is clean. The sweep starts only after that gate passes: dispatch transition {"to":"G_SWEEP"} once every witness above is quoted in the transition note. The sweep walks every node head to tail and ends in one of two terminal states: G_FIXPOINT when it changed nothing, or G_SURFACE when the variant did not decrease. Done is the terminal state the transition returns, never the agent's own pronouncement.

A closure predicate denial names its recovery verb in next_dispatch, and that verb is dispatched next, never the bare transition again. An identical denial repeated three times is escalated by the repeat threshold, and the escalation is read before any further dispatch.

Feedback routes each discovery to the earliest node able to resolve it. A message that states what but not why returns to CONVCOM. An unrecoverable reason records an ADR under ADRN. State outside the repository returns to EARS through LIVEPLAN. A broken promise returns to G_CONTRACT through CONTRACTTEST. A CI assertion failure returns to G_INDEP; a missing module or broken build returns to TOTALITY; a CI type error returns to G_CONTRACT. A residual or claim-audit finding that is a behaviour defect returns to G_INDEP, and one that is a code defect returns to TOTALITY. G_DONE sends the chain back to G_INDEP when the contract is not satisfied, which re-enters VERIFY with a fresh independent verifier.

The chain does not stop in ADRN on a summary, a recap or a message that names the next step without dispatching it. Every turn ends in a dispatch until the sweep returns a terminal state.
