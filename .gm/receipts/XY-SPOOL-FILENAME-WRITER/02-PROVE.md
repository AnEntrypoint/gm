# 02 PROVE -- XY-SPOOL-FILENAME-WRITER

Precondition: a sweep moves any in/<verb>/ file whose extension is not txt to in-quarantine/<verb>__<name>.
Invariant: the rename in publishSpoolRequest is atomic, so a request file is either absent or complete.
Postcondition under test: a non-conforming request is answered, never dropped silently.

Run 1 (archival, exec_js 1791671680432-7874 and 1791672072335-8145): 279 quarantined files over 24 projects.
Groups: memorize .md bodies 189 (67.7%, 21 projects, newest 2026-08-17, 0 rejection out-files, 0 dispatch out-files);
gm-mcp dot-temps about 30 (latest phase-status__.orch-main-r135-20380-1791668514867-5976.20380.1791668514948.tmp, gm, 21:41Z, 1 rejection out-file, 0 dispatch out-files);
legacy bare <N> names about 30 (exec_js 10, codesearch 9, fetch 5, fs_readdir 2, instruction 2, mjs 1, recall 1); non-txt extensions about 15; top-level in/ writes with an unexpanded ${SID} shell template 2-4.

Run 2 (failed witness, 1791672311228-500-e893b5b79597a96c, RESULT: FAIL): a dot-temp staged in gm in/phase-status/ was NOT swept in 20 s.
Cause found in source, not guessed: the sweep is not a poll. It runs on cold_sweep_pending (set only when a project root newly attaches; the walk then covers every known root), on the orphan-recovery branch, and under the sweep-spool CLI.

Run 3 (corrected witness, dispatch 1791672650688-500-10d4a22f479e6f5f (session orch-main-r169-sub1, RESULT: PASS)): scratch root, temp survives 3 s untouched, then sweep-spool quarantines and answers it.
Checks: temp stays in in/ and out/ stays empty for 3 s; after sweep-spool it leaves in/, reappears as phase-status__<tmp>, and is answered; a .md in in/memorize/ is quarantined as memorize__<name>;
a conforming orch-main-r169-sub1-1.txt is left in place; the answer file is out/phase-status-<tmp minus .tmp>.json containing spool_filename_rejected;
archival r135 temp still quarantined with a rejection answer and no dispatch out-file; dispatch.js still stages the dot-temp; scratch removed.