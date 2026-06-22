# BROWSER

## Hard Rule: Browser Witness Mandate

**Every edit to code that runs in a browser requires a live `browser` dispatch in the same turn as the edit.** Client-side surfaces -- `.html`, `.js`, `.jsx`, `.ts`, `.tsx`, `.vue`, `.svelte`, `.mjs`, `.css`, web components, service workers, every asset loaded by `<script>`, every path reached by `import` from a browser-side entry -- must be witnessed by a live `page.evaluate` of the specific invariant the edit establishes. A passing node test, build, `curl` of the HTML, or static-analysis pass witnesses server delivery, not browser behavior, and is non-substitutive. The witness IS the proof; prose is not.

Protocol: (1) boot the real surface -- server up, page reachable, HTTP 200 witnessed; (2) `browser` dispatch -> navigate -> poll for the global the change affects; (3) `page.evaluate` asserting the invariant, capturing witnessed values into `stdout`; (4) variance -> fix at root cause, re-witness. Never advance on unwitnessed client behavior, never queue validation for "later" -- the same turn that edits a client-side file dispatches the browser verb validating it.

Fires across phases: **EXECUTE** edit -> same-turn browser dispatch asserting the invariant; **EMIT** post-emit re-witness (page still passes after the full diff); **VERIFY** final gate -- `deviation.browser-witness-hash-mismatch` fires if a witnessed file changed without re-witnessing. Pure-prose static-document edits (no JS, no CSS-driven behavior, no DOM mutation) are the ONLY exempt category, and the exemption must be named explicitly in the response so the skip is auditable. Silent skip on actual behavior change is forced closure.

YOU drive the browser through the spool: plugkit holds the Chromium handle, per-project profile, and session table; you advance by writing `.gm/exec-spool/in/browser/<N>.txt` and reading `out/<N>.json`. There is no library import, no puppeteer/playwright/CDP handle that shortcuts this. The verb is the surface; every other reach is fabrication.

## Body shapes

The body is a string, five shapes only:

```
session new
session list
session close <id>
<arbitrary JS expression evaluated in page context>
timeout=<ms>\n<expression>
```

A bare expression with no live session opens one against `about:blank`; with a live session it reuses it. `session new` returns the id you carry; with more than one open, target it via `session=<id>\n<expr>`. (`session close` and `session kill` are aliases.) Default per-eval timeout 120000ms; operations that legitimately exceed it prefix `timeout=<ms>\n` (wrapper clamps to 120000ms). The response carries `timeout_ms_used`; `browser.runner-timeout` fires at the cap -- read `stderr`, narrow or raise, never retry blind at the same budget.

## Envelope

`{ok, stdout, stderr, exit_code, session_id?}`. `stdout` = stringified eval result; `stderr` = page errors + launch diagnostics; `exit_code` non-zero = the dispatch did not land -- read `stderr` and re-dispatch, never blind.

## Headed by default

The window opens on the user's screen -- that IS the witness. `GM_BROWSER_HEADLESS=1` opts into headless; absent it, a session with no visible window is a launch you did not make. Do not assume or request headless to "be quiet"; the flash is the proof.

## Profile

`session new` (or a bare expression with no live session) spawns a locally-profiled Chromium at `<cwd>/.gm/browser-profile/`; the runner attaches via `--direct <wsEndpoint>`. Cookies/storage/extensions persist across sessions, turns, and runs. A second concurrent launch contends the SingletonLock; the watcher reuses the live CDP rather than re-launching. The runner's extension-attach mode ("Waiting for extension to connect") is never the default or what you want -- seeing it in `stderr` means the host failed to spawn local Chromium; dispatch `instruction` for recovery, not a blind retry.

## Profile and debug recipes

The page is a genuine profiler and debugger -- use it, never guess-and-restart. Attach the listeners BEFORE `page.goto`, then return the captured arrays from one script (all witnessed live):

```
const logs=[],errs=[],net=[];
page.on('console',m=>logs.push({type:m.type(),text:m.text()}));
page.on('pageerror',e=>errs.push(String(e&&e.message||e)));
page.on('requestfinished',r=>{const t=r.timing();net.push({url:r.url(),dur_ms:Math.round(t.responseEnd),ttfb_ms:Math.round(t.responseStart)});});
await page.goto(URL,{waitUntil:'load'});
const perf=await page.evaluate(()=>{const n=performance.getEntriesByType('navigation')[0]||{};return {load_ms:Math.round(n.loadEventEnd||0),dcl_ms:Math.round(n.domContentLoadedEventEnd||0),resources:performance.getEntriesByType('resource').length,now:Math.round(performance.now())};});
return {logs,errs,net,perf};
```

- **Console + uncaught errors**: `page.on('console')` captures every page `console.*`; `page.on('pageerror')` captures uncaught exceptions (a `try/catch` in the page swallows them -- they surface as a console.error instead). This is your debug log.
- **Performance**: `performance.getEntriesByType('navigation')[0]` gives `loadEventEnd`/`domContentLoadedEventEnd`; `getEntriesByType('resource')` gives per-asset timing; `performance.now()`/`PerformanceObserver` for in-page measures. This is your profiler.
- **Network timing**: `request.timing()` fields (`responseEnd`, `responseStart`, ...) are ALREADY relative to `startTime` -- use `Math.round(t.responseEnd)` directly for duration; subtracting `startTime` yields a garbage huge-negative (witnessed). `-1` means N/A.
- **State**: expose any runtime value as `window.__x` in the app or via `page.evaluate(()=>{window.__x=...})`, then read it with another `page.evaluate` -- the live global beats a restart. Surface relevant state as a global on purpose so a single evaluate observes it.

Profile to LOCATE (which call/resource is slow), then eliminate hypotheses by live measurement -- never a/b-test by restarting. The node side mirrors this: `exec_js` with `process.hrtime.bigint()`/`performance.now()` timing, `process.memoryUsage()`, and `stderr` stack capture is a genuine node profiler+debugger.

## Discipline

Never spawn Chromium yourself, `npm i puppeteer`, or shell `chrome.exe`; the verb owns the handle, and bypassing it orphans state plugkit cannot reap and breaks the next session's first read. Navigate by evaluating `location.href = '...'` through the spool; screenshot by dispatching the verb that returns one. A dispatch returning `ok:false` with a launch error is plugkit reporting the environment refused -- read `stderr`, dispatch `instruction`, do not loop the same body.

**Dead-watcher recovery, never substitute.** If a Write to `.gm/exec-spool/in/browser/<N>.txt` produces no response after two re-Reads AND `.status.json` ts is stale (>15s from current epoch), the watcher is dead: boot `bun x gm-plugkit@latest spool`, then re-dispatch the browser body. Do NOT reach for puppeteer-core, puppeteer, playwright, agent-browser, `chrome.exe`, `npx browserless`, WebFetch, or curl-then-parse -- the browser verb is the only admissible browser surface; substitutes spawn orphan Chromium plugkit cannot reap, bypass section 23 witness-marked events, and produce evidence the gate cannot read. The recovery loop is always: empty response -> check `.status.json` -> if stale, boot -> re-dispatch.
