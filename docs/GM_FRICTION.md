# GM friction

Stable ledger of friction reported against gm. Sources: docstudio docs/GM_FRICTION.md on its origin/main (three items), and the measured ranked list of 2026-11-19 (counts from the run logs under runs/ and /config/docstudio/runs, and the two orchestrator journals). Each entry: the evidence, the cause, and the fix commit, or the reason no gm change applies.

## Docstudio items

1. read_file truncates silently at about 9.9 KB without allow_large.
   - Evidence: gm.read_file of a streaming module inside one run_code body; the reply ended with truncated true.
   - Cause: the run_code read cut is 4500 head and 1500 tail, and the cut reply had hint null, although the read_file description promises that hint names the read that gets the rest. allow_large is not a parameter; full: true returns all.
   - Fix: 1701723e (bounded_output sets hint). Witness: the hint text names full: true.

2. git_commit requires paths with no visible schema in run_code.
   - Evidence: {"ok":false,"error":"paths must be a non-empty array of strings"}; retry with paths succeeded.
   - Cause: the schema required paths, and the git_commit description did not say so.
   - Fix: 80b1730c (description states paths is required).

3. Session start latency.
   - Evidence: the first gm skill read landed about 126 s after the playwriter connect event.
   - Cause: model turn time between the host events, not a gm step. No gm change.

## Ranked list of 2026-11-19 (counts measured)

4. Host runs Bash for work that gm verbs cover: 361 calls (312 docstudio, 49 gm journals; 26 and 10 run_code respectively).
   - Cause: host tool choice. gm cannot block the host's Bash tool. No gm change.

5. Worker restarts during runs: 13 restart events in the logs. 5 build swaps, 2 changed gm-core, 1 failed start, and 5 resumed open runs that carried the default reason "restarted without a reason".
   - Cause: installs, and serves that resume an open run. The 5 resumed runs were mislabelled as restarts.
   - Fix: this pass changes the default label to "resumed an open run without a restart reason" (native/components/mcp/include/gm/mcp.hpp).

6. Cut replies with no pointer to the rest: 9.
   - Cause: hint null on cut reads. Fix: 1701723e.

7. read_file of the same unchanged file repeated in a run: 9 pairs measured, 5 unchanged (28730 characters re-sent), 4 with no shell or write between.
   - Cause: body_call invalidated the repeat mark on any run_shell, job_start, write or js through a global write counter, and the pure repeats came from a build without the pointer rule.
   - Fix: 7645274d (repeat marks keyed on file size and mtime). Witness: same-step repeat pointer true; repeat across run_shell pointer true; repeat after a write fresh content.

8. Browser errors from playwriter: 8 distinct errors in the logs (count corrected from 7).
   Each row: the error text verbatim (first 90 characters), its run, step and verb, the reproduction on build 4b97b993229b, and the cause.
   - E1 "Error executing code: Error: The global `page` was removed..." run 2026-11-06-13-59-25-edabce seq 12, step 1, playwriter_execute (pre-native build). Reproduction: the logged arguments in a fresh run returned hasPage object; bind, close and reference in three calls returned no error; two connections sharing the browser, one closing its page, did not reproduce. Not reproduced. Check: the older engine's run log.
   - E2 "Code execution timed out after 120ms" run 2026-11-06-13-59-25-edabce seq 16, step 1, playwriter_execute with timeout 120. Reproduced exactly. Cause: timeout is in milliseconds (schema), so 120 is 120 ms. Fix: user_execute refuses a timeout below 1000 ms with "timeout is in milliseconds: 120 is below 1000; the default is 10000". Witness: refused.
   - E3 "action must be \"list\" or \"close\"" run 2026-11-06-16-37-59-f59d0e seq 749, step 9, playwriter_browsers with {}. Current build: the verb is unlisted, so run_code gave "not a function" (reproduced). Cause: no default action and no listing. Fix: browsers() defaults action to list, and playwriter_browsers is listed. Witness: gm.playwriter_browsers({}) lists the browsers.
   - E4 "locator.click: Timeout 60000ms exceeded" run 2026-11-06-16-37-59-f59d0e seq 811, step 9, playwriter_execute. Class reproduced: locator.click on a missing element with timeout 1000 gives "locator.click: Timeout 1000ms exceeded. Call log: waiting for locator". Cause: the element was absent in the app; the caller's wait ran out. Not a gm defect.
   - E5 "locator.click: Timeout 15000ms exceeded ... getByRole('button', { name: 'Start chat' })" run 2026-11-06-16-37-59-f59d0e seq 815, step 9, playwriter_execute. Same class as E4, reproduced. Cause: element absent in the app. Not a gm defect.
   - E6 "The global `page` was removed" run 2026-11-17-09-11-43-1a3bb6 seq 153, step 1, playwriter_execute. Replayed with the logged code and timeout: the page was present and the goto failed with ERR_CONNECTION_REFUSED at 127.0.0.1:8765 (nothing listening). Not reproduced. Check: that run's browser state; the same class as E1.
   - E7 "Code execution timed out after 60ms" run 2026-11-17-09-11-43-1a3bb6 seq 157, step 1, playwriter_execute with timeout 60. Same cause as E2 (milliseconds). Reproduced in class by E2's witness. Fix: the same refusal.
   - E8 "page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:8766/?fresh=9#/login" run 2026-11-17-10-35-39-9e5594 seq 87, step 1, playwriter_execute. Class reproduced: page.goto to 127.0.0.1:65530 gives ERR_CONNECTION_REFUSED. Cause: the app at that port was not running. Not a gm defect.

9. Bad UTF-8 sequence in JSON reply: 4.
   - Cause: invalid UTF-8 from command output reached the reply encoder. Fix: 2ad803a1 (escape invalid UTF-8 in the shared reply encoder). Witness: run_shell output with byte 0xff returns a replacement character with no JSON error.

10. EISDIR and ENOENT path errors: 4 (the directory case is row 13).
    - Cause: absent-path probes are expected; the ENOENT message names the path. Witness: read_file of an absent path returns "ENOENT ... stat '<path>'".

11. git commit failure says only exited N: 3.
    - Cause: the verb's error field dropped git's own output. Fix: 99cccb84 (error names the first line of git's output). Witness: "git commit exited 1: error: pathspec 'missing.txt' did not match ...".

12. Status rejected with "open, resolved, all": 3 (historic runs).
    - Cause: the older build accepted only open, resolved and all. Current build accepts pending and completed. Witness: prd_list status pending returned ok.

13. paths must be a non-empty array: 2. Fix: 80b1730c, the same as item 2.

14. A first task after a step with no task was refused: 2.
    - Cause: owner_seen was set on every step, not only owner calls, so the first-step correction refused any run with no task after one step. Probe at the refusal: created=1 task_len=0 child=0 owner=1 steps=1.
    - Fix: 7645274d (unset_task = created && task empty && !child_seen). Witness: next_context task "beta" after a no-task step returned ok step 2; task "gamma" refused without owner.

15. read_file on a directory returns raw EISDIR: 1.
    - Cause: no directory check before the read. Fix: 91073176 (names list_dir). Witness: "/config/gm/docs is a directory; list it with list_dir".

16. Run-ended refusal: 2. Cause: a call after finish. The refusal names next_context. Witness: "run ... has ended; call next_context to open a new run". No gm change.

17. Gm skill read twice on one connection: 2 in one run.
    - Cause: the second read followed a rules-notice (rules-notice, rules-cleared) and was required. No gm change.

18. Unknown argument "code" to run_code: 1.
    - Cause: the caller passed code. The refusal names body, timeoutMs and format. Witness: "refused: unknown argument code; run_code takes body, timeoutMs, format". No gm change.

19. Waits returning early while running: 0 of 20 measured.
    - Cause: none. No gm change.
