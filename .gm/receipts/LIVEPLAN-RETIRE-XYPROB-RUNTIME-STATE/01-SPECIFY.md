# 01-SPECIFY: LIVEPLAN-RETIRE-XYPROB-RUNTIME-STATE (session gm-drain-w1-203)

Row: retire XYPROB-runtime-state-in-submodules once its two split rows close.
Closing condition: INVEST-XYPROB-RUNTIME-AUDIT and INVEST-XYPROB-RUNTIME-IGNORE-RS-PLUGKIT both closed, then XYPROB closed as superseded.

Checks against live state:
- INVEST-XYPROB-RUNTIME-AUDIT: status completed, witness_binding exit 0, dispatch 1791958523242-500-d2d0e8c9fec0c021 (rs-plugkit), 1791958528957-19-d1d8257b5eff9209 (libsql), 1791958534895-17-eef76a28abcaf6ab (treesitter). Prd-list dispatch 1791958716240-500-4a665da134637583.
- INVEST-XYPROB-RUNTIME-IGNORE-RS-PLUGKIT: status completed, witness dispatch 1791778443422-192-16ece5fc5b90bd2b (dirty:false). Prd-list dispatch 1791958720012-500-153812c737759772.
- Prior blocker LIVEPLAN-RETIRE-XYPROB-RUNTIME-STATE-blocker-gm-prdall-20261014-04-k14 was filed when AUDIT was pending; AUDIT is now completed, so its unblock condition is met.

Hypothesis: the row is closable now; the leader hypothesis is "both prerequisites closed, so the parent is superseded". Rival: the IGNORE witness is stale (2026-10-12) and does not show the current state. Probe: re-read the IGNORE row and the AUDIT row (done, dispatches above). The probe separates the leader from the rival only partially; the stale IGNORE witness is noted and the AUDIT witness is current.

ACH cells are not applicable: the row asserts no cause, it asserts a closure condition.
