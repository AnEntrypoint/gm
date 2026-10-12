# 14-SEC: JTBD-SPEND-VISIBILITY

Secrets: the script reads spool JSON and the server log, prints session id, verb, counts and durations. It prints no request or reply bodies. Check run: grep of the script for token, key, secret, password returns nothing.

Injection: the session id is used only as an equality key against parsed file names and records; no shell, no eval, no path built from it. Spool and log paths come from env or fixed locations under the repo and the user home.

Identity: no commit trailers, no attribution lines in the script.
