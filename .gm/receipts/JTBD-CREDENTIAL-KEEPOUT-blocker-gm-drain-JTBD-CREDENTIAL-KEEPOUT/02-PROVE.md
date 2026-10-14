# PROVE

Precondition: scripts/check-staged-secrets.mjs present. Invariant: script reads only git diff --cached. Probe run (dispatch 1791958583290-500-5bf1411ca0687ff7): seeded AKIA key -> exit 1 RESULT: FAIL; clean file -> exit 0 RESULT: PASS. Probe separates H1 from H2 for the AWS shape; H2 for other shapes is not tested here and is not claimed.
