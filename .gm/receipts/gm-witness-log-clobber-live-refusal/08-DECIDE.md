# 08-DECIDE — gm-witness-log-clobber-live-refusal

Row's words: "against a guest built from 732a4a83 or later, a whole-file fs_write of a path
ending in /.gm/witness-log.md is refused with error_code append_only_shrink_refused naming
bytes_on_disk and bytes_offered, and the file is byte-identical afterwards."

Checked against the live witnesses, not the diff:

1. guest built from 732a4a83 or later -- PROVE precondition: health source_sha 75472e56,
   GitHub compare ahead_by 13 behind_by 0. Holds.
2. whole-file fs_write refused -- four refusals, A..D, none reached host_write. Holds.
3. error_code append_only_shrink_refused -- B, C, D all return it. A returns
   append_only_rewrite_refused because bytes_on_disk was 0 (shrank from nothing), which is the
   same guard's create arm: a whole-file write is refused either way. Holds.
4. names bytes_on_disk and bytes_offered -- both named in every refusal text. Holds.
5. byte-identical afterwards -- sha256 0999613b...cc6e, 102 bytes, before and after each
   refusal; measured independently by session orch-main-r156 and orch-main-r156-sub1. Holds.

Every clause of the row is met by a live dispatch, none by inference. DECIDE: resolve.

Delivery: git_finalize with paths .gm/witness-log.md only (.gm/prd.yml is shared and was
never staged) committed 541ddbadcb; push was refused gate_denied remote_moved
(non-fast-forward: the remote moved under this ref; auto-recovery declined because the
checkout holds other lanes' dirty tracked files and dirty submodule pointers
agentplug/gm-config/gm-mcp/rs-codeinsight/rs-plugkit). Publication is blocked by that
denial, recorded verbatim as blocker row
<row>-blocker-orch-main-r156; the row's own acceptance is unaffected: it is about the
guest's refusal, which is witnessed and shipped.
