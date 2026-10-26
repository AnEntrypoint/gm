# Transport

gm-mcp is the only transport for gm verbs. A skill calls a verb through the `gm_codemode` tool as `gm.<verb>({...})`, with `cwd` set on every call. `gm.list()` returns the verb set and `gm.describe(name)` its body schema. The verb inventory, with one example per verb, is `docs/verbs.md`.

gm-mcp owns everything below the call. It writes the request, polls for the reply, starts the runner for the project when no live daemon sweeps it, compacts the response, and spills a long reply to a file that `gm_result` reads. Wire details (request naming, poll budgets, timeouts) are in `gm-mcp/AGENTS.md`, section "Dispatch wire and polling".

Skills never write `.gm/exec-spool` files, never start or restart the runner, and never run a bundled CLI. gm-mcp does that work: it installs and updates the runner and the guest in the background, starts the runner when a dispatch finds none, and moves the requests a dead runner left in flight to quarantine.