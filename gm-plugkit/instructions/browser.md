# BROWSER

## Hard Rule: Browser Witness Mandate (paper §23)

**Every possible edit to code that runs in a browser requires a live `browser` dispatch in the same turn as the edit.** Client-side surfaces — `.html`, `.js`, `.jsx`, `.ts`, `.tsx`, `.vue`, `.svelte`, `.mjs`, `.css`, web components, service workers, every possible asset loaded by a `<script>` tag, every possible path reached by `import` from a browser-side entry — must be witnessed by a live `page.evaluate` of the specific invariant the edit establishes. A passing node test, a passing build, a `curl` of the served HTML, a static-analysis pass — every possible one of these is non-substitutive: they witness server delivery, not browser behavior. The witness IS the proof; the prose is not.

Protocol (paper §23): (1) boot the real surface — server up, page reachable, HTTP 200 witnessed; (2) `browser` dispatch → navigate → poll for the global the change affects; (3) `page.evaluate` asserting the specific invariant, capturing the witnessed values into `stdout`; (4) variance → fix at root cause, re-witness (Fix on Sight). Never advance on unwitnessed client behavior. Never queue browser validation for "later" — the same turn that edited every possible client-side file dispatches the browser verb that validates each one; emit-without-witness is forced closure.

The rule fires across phases:
 - **EXECUTE**: edit a client-side file → dispatch `browser` in the same turn against the live page asserting the invariant the edit establishes
 - **EMIT**: post-emit re-witness — the page still passes the invariant after the full diff lands
 - **VERIFY**: final gate — `browser-witness-hash-mismatch` deviation fires if any file you witnessed earlier has changed without re-witnessing

Pure-prose static-document edits (no JS, no CSS-driven behavior, no DOM mutation) are the ONLY exempt category and the exemption must be named explicitly in the response so the skip is auditable. Silent skip on actual behavior change is forced closure.

YOU drive the browser through the spool. Plugkit holds the Chromium handle, the per-project profile, the session table; you advance the work by writing `.gm/exec-spool/in/browser/<N>.txt` and reading `out/<N>.json`. There is no library import that shortcuts this. There is no puppeteer/playwright/CDP handle you can hold. The verb is the surface; every possible other reach is fabrication.

The body is a string. Five shapes, nothing else:

```
session new
session list
session kill <id>
<arbitrary JS expression evaluated in page context>
timeout=<ms>\n<expression>
```

A bare expression with no live session opens one and evaluates against `about:blank`. A bare expression with a live session reuses it. `session new` returns the id you carry on subsequent dispatches; you keep it in your turn and refer to it by writing `session=<id>\n<expr>` when more than one is open.

Default per-evaluation timeout is 14000ms. Operations that legitimately exceed this (long page loads, multi-step navigation, slow remote APIs) prefix `timeout=<ms>\n` with the desired millisecond cap; the wrapper clamps to 50000ms maximum. The response includes `timeout_ms_used` so you witness which budget actually applied. `browser.runner-timeout` event fires when the runner hits the cap — read your `stderr`, narrow the operation, or raise timeout; do not retry blind at the same budget.

## Envelope

You read `{ok, stdout, stderr, exit_code, session_id?}`. `stdout` is the stringified evaluation result. `stderr` carries page errors and launch diagnostics. `exit_code` non-zero = the dispatch you fired did not land; you read `stderr` and re-dispatch, you do not retry blind.

## Headed by default

The window opens on the user's screen. That is the witness — you launched, they saw the tab, the DOM mutated visibly. `GM_BROWSER_HEADLESS=1` opts into headless; absent that env, a session with no visible window is a launch you did not actually make. Do not assume headless. Do not request headless to "be quiet". The flash IS the proof.

## Profile

`session new` (or a bare expression with no live session) spawns a locally-profiled Chromium at `<cwd>/.gm/browser-profile/` and the runner attaches via `--direct <wsEndpoint>`. Cookies, storage, extensions persist across every possible session, turn, and run. A second concurrent launch contends the SingletonLock; the watcher reuses the live CDP rather than re-launching. The runner's own extension-attach mode (the "Waiting for extension to connect" message) is never the default and is never what you want — if you see it in your `stderr`, the host failed to spawn the local Chromium and you dispatch `instruction` for the recovery prose, not retry blind.

## Discipline

You never spawn Chromium yourself. You never `npm i puppeteer`. You never shell `chrome.exe`. The verb owns the handle; bypassing it orphans state plugkit cannot reap and breaks the next session's first read. When the page needs navigation, you evaluate `location.href = '...'` through the spool. When it needs a screenshot, you dispatch the verb that returns one — you do not reach for a library to take it.

A dispatch that returns `ok:false` with a launch error is plugkit telling you the environment refused; you read the `stderr`, you dispatch `instruction`, you do not loop the same body waiting for a different answer.

**Dead-watcher recovery, never substitute.** If your Write to `.gm/exec-spool/in/browser/<N>.txt` produces no response file after two consecutive re-Reads AND `.gm/exec-spool/.status.json` ts is stale (>15s from current epoch), the watcher is dead. Your next call is `bun x gm-plugkit@latest spool` to boot a fresh watcher, then re-dispatch the browser body. Do NOT reach for puppeteer-core, puppeteer, playwright, agent-browser, `chrome.exe`, `npx browserless`, WebFetch, curl-then-parse, or any other browser substitute when the spool surface is reachable. The browser verb is the only admissible browser surface; substitutes spawn orphan Chromium processes plugkit cannot reap, bypass paper §23 witness-marked events, and produce evidence that does not feed the witness gate. The recovery loop is always: empty response → check `.status.json` → if stale, boot → re-dispatch. The full chain ends in a browser-witness-marked event with non-empty `files:[…]` when the browser session actually saw the artifact change; anything shorter is forced closure.
