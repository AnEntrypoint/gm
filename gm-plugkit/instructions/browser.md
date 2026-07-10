# BROWSER

## Hard Rule: Browser Witness Mandate

**Every edit to browser-run code requires a live `browser` dispatch, same turn as the edit.** Client-side surfaces -- `.html`, `.js`, `.jsx`, `.ts`, `.tsx`, `.vue`, `.svelte`, `.mjs`, `.css`, web components, service workers, every `<script>`-loaded asset, every `import`-reached path from a browser entry -- witnessed by live `page.evaluate` of the specific invariant the edit establishes. Passing node test / build / `curl` of HTML / static-analysis witnesses server delivery, not browser behavior -- non-substitutive. The witness IS the proof; prose is not.

**A visual/rendering claim ("X is visible," "the terrain/model/UI renders," "the glitch is gone") is witnessed by `screenshot`, never by internal state alone.** A `page.evaluate` reading `renderer.active === true` or `scene.children.length > 0` proves the object graph exists, not that pixels are correct on screen -- a shader failure, a z-fighting bug, a camera pointed the wrong way, or a black/transparent material all leave that internal state true while nothing is actually visible. Any row whose description names a visual symptom is closed only by a `screenshot` dispatch + `Read` of the resulting PNG (rendering it), confirming by looking at the actual image that the described visual outcome holds -- not by a plausible-sounding description of the mechanism used to fix it ("maintained via existing X orchestration + new Y sync" is a design summary, not a witness). If the fix is real but the visual claim was never re-checked this way, the row is not resolved yet.

The witness is a live `page.evaluate` asserting the specific invariant against the real surface -- server up, HTTP 200, the global the change affects polled until present -- values captured into `stdout`; variance means a root-cause fix and re-witness, not advance. Anything short of the live assertion -- unwitnessed behavior, an assert fired before the global is present, validation queued for "later" -- leaves the edit unproven, and an unproven client edit is forced closure.

Fires across phases: **EXECUTE** edit -> same-turn browser dispatch asserting the invariant; **EMIT** post-emit re-witness (page still passes after the full diff); **VERIFY** final gate -- `deviation.browser-witness-hash-mismatch` fires if a witnessed file changed without re-witnessing. Pure-prose static-document edits (no JS, no CSS-driven behavior, no DOM mutation) are the ONLY exempt category, and the exemption must be named explicitly in the response so the skip is auditable. Silent skip on actual behavior change is forced closure.

YOU drive the browser through the spool: plugkit holds Chromium handle, per-project profile, session table; advance by writing `.gm/exec-spool/in/browser/<N>.txt`, reading `out/<N>.json`. No library import, no puppeteer/playwright/CDP shortcut. The verb is the surface; every other reach = fabrication.

## Body shapes

The body is a string, these shapes:

```
session new
session list
session close <id>
<arbitrary JS expression evaluated in page context>
<https://... bare URL>
url=<url>\n<expression>
timeout=<ms>\n<expression>
capture\n<expression>
profile\n<expression>
profile interval=<us> topN=<n>\n<expression>
trace\n<expression>
screenshot\n<expression>
dom=<css-selector>\n
```

**Never a JSON object body.** The body is always one of the plain-text shapes above -- never `{"command":"launch","url":"...","timeoutMs":...}` or any other JSON-object payload. Every other spool verb (`prd-add`, `mutable-add`, `transition`, ...) takes structured JSON, which makes a JSON body an easy but wrong guess for `browser` specifically -- this verb is the one exception, string-only. A JSON-shaped body is rejected up front with a clear error naming the supported shapes; passing it anyway used to fall through to evaluating the raw JSON as a JS expression, producing an opaque `SyntaxError: Unexpected token ':'` with no indication of the real mistake. To launch and navigate: `session new` once, then `url=<target>\n<expression>` on the same or next dispatch -- there is no separate "launch" command.

**Open on the page you want to test, not a blank one.** A bare `https://...` URL body navigates the session straight to that page and returns `{url, title}` -- the simplest "show me this page." `url=<url>\n<expression>` navigates first, then runs your expression on the loaded page, so the global/DOM you assert is already there in one dispatch instead of a blank surface you must `page.goto` yourself. `url=` composes with `timeout=` and `capture` -- stack the prefix lines in order `timeout=`, then `url=`, then `capture`, the expression last; the prepended `page.goto` rides inside the capture so its navigation console/network is captured too. A bare expression with no `url=`/bare-URL prefix runs against whatever the session is already on -- a never-navigated session is on `about:blank`, so the expression evaluates an empty page and the envelope comes back with `landed_on_blank: true` and a `hint` telling you to add `url=`; navigate first and the surprise never happens. `session new` returns the id you carry. (`session close` and `session kill` are aliases.) Default per-eval timeout 120000ms; operations that legitimately exceed it prefix `timeout=<ms>\n` (wrapper clamps to 120000ms). The response carries `timeout_ms_used`; `browser.runner-timeout` fires at the cap -- read `stderr`, narrow or raise, never retry blind at the same budget.

**`capture\n<expression>` is the zero-boilerplate debug path -- prefer it.** Prefix your script with `capture` (or `profile`) on its own line and the wrapper auto-attaches `page.on('console'|'pageerror'|'requestfinished')` before your code runs, runs your script in an async wrapper (your top-level `await`/`return` work unchanged), and returns `{result: <your return>, debug: {console, pageErrors, network, performance}}` -- page console logs, uncaught errors, per-request network timing, and navigation performance, captured for free. Combine with timeout via `timeout=<ms>\ncapture\n<expr>`. Use the bare expression only when you do not want the capture overhead.

**`profile\n<expression>` is the bottom-up CPU profiler -- worst-20 culprits by file location across init and code-execution.** Prefix your script with `profile` on its own line: the wrapper opens a CDP `Profiler` (`newCDPSession` + `Profiler.start` BEFORE the prepended `page.goto`, so navigation, script-parse, and init are sampled, not only steady-state), runs your script, `Profiler.stop`s, and aggregates the v8 CPU profile into `{result, profile: {timeframe: {start_us, end_us, total_us, sample_count}, culprits: [{location, function, self_us, self_pct, hits}]}, profile_error, debug: {...}}`. `culprits` is the bottom-up self-time ranking capped at the worst 20 `url:line` locations; `timeframe` is the capture window in microseconds. Composes with `url=`/`timeout=` in the same prefix order. Page scripts loaded from `.js` files carry real `file:line`; `page.evaluate` anonymous frames bucket to `(program)`/`(native)`. On a CDP failure `profile` is `null` with `profile_error` set and your `result` still returns. The identical `{timeframe, culprits}` shape comes back from `exec_js` with `opts.profile:true`, so the cli and browser bottom-up views read the same. `profile` also returns `wall_vs_cpu: {wall_us, cpu_self_us, offcpu_us}` -- the CPU sampler measures only on-CPU JS, so `offcpu_us` is the time it cannot see. Tune the sampler with `interval=<us>` and the culprit count with `topN=<n>` stacked after the mode word (`profile interval=50 topN=40`), symmetric with `exec_js` `opts.sampleIntervalUs`/`opts.profileTopN`.

**`trace\n<expression>` catches GPU activity the CPU sampler is structurally blind to.** A V8 CPU profiler samples on-CPU JS call stacks only; GPU-process work -- compositor, raster, draw, WebGL/canvas -- never appears in it. `trace` opens a CDP `Tracing` session over wrapper-controlled categories (`gpu`, `viz`, `cc`, `blink`, `devtools.timeline`), runs your script, ends tracing, and returns `{result, trace: {wall_us, gpu_us, viz_us, cc_us, raster_us, event_count, complete, by_category}, trace_error, debug: {...}}`. `gpu_us`/`viz_us`/`cc_us` are wall-clock microseconds of GPU-process activity summed from the trace; `by_category` is the bounded top-15 category rollup (raw events never returned). When wall greatly exceeds CPU self-time, `trace` is how you attribute the gap to the GPU rather than guessing. `debug.performance` carries paint/frame metrics (`first_contentful_paint_ms`, `largest_contentful_paint_ms`, `cumulative_layout_shift`, `longtasks`, `fps`) for client-side render jank. `tracingComplete` is bounded by a timeout; on a CDP failure `trace_error` is set and `result`/`debug` still return.

**Every dispatch returns a structured `result` -- read `result.foo`, never regex the stdout.** Whatever your expression returns is JSON-serialized into the envelope's top-level `result` field (the human-readable `[return value]` text stays in `stdout` for eyeballing). `capture`/`profile`/`trace` put their `{result, debug, ...}` object there whole, so `result.debug.performance.heap_used_mb` and `result.trace.gpu_us` are direct reads. `debug.performance` now also carries `heap_used_mb`/`heap_total_mb` (JS heap) for leak-hunting; `debug.network` entries carry `method` and `status` and are sorted slowest-first before the 30-cap so the worst request survives; `debug.console` is capped at 50 with a trailing dropped-count note so a chatty page cannot flood the envelope.

**`screenshot\n<expression>` writes a PNG and returns its path.** Runs your expression, then `page.screenshot` to `.gm/witness/` (basename-sanitized, confined to that dir), returning `{result, screenshot_path, screenshot_error}`. Reach for it when the bug is visual and the DOM/console do not show it.

**`dom=<css-selector>\n` is the zero-boilerplate element probe.** Returns `{selector, match_count, elements:[{tag, text, attrs, visible, rect}]}` for up to 20 matches -- the fastest answer to "is this element there and what does it say." An invalid selector returns `result.error` (no crash). Composes with `url=`.

**One session per run -- reuse it, then close it.** A browser session is keyed by its spool `sessionId`; every dispatch carrying the SAME sessionId reuses the SAME chromium. A DIFFERENT sessionId opens its OWN chromium -- so a run that invents `probe`/`w2`/`w3`/... names leaks one browser per name. Pick one sessionId, use it for every dispatch, and end with `session close` so nothing is left open; the eval envelope carries a `multi_session_warning` the moment a second distinct session opens. The idle reaper (closes sessions unused past the idle window) and the OS-orphan reaper (kills managed chromiums no live session owns, sparing in-use ones and your own Chrome) are backstops for crashes, not a license to leave sessions open -- close yours.

**The session closes when YOU expect it to, not under you.** A session stays open across turns and think-gaps -- the idle window is generous (15 min of no use), measured from the END of your last dispatch, so a long read or a slow eval never shortens it. A dispatch in flight is never closed mid-run: the idle reaper and the orphan reaper both skip a session while its eval is executing, and a just-launched browser has a grace period before any reaper can touch it. An explicit `session close` is immediate. If the idle/orphan backstop did close a session and you dispatch to it again, it transparently re-launches and the envelope carries `session_relaunched: true` with a `relaunch_note` -- your in-page `window.*` state was reset, so re-establish it; you are told, never silently surprised.

## Envelope

`{ok, stdout, stderr, exit_code, session_id?, navigation_requested, landed_on_blank?, hint?, multi_session_warning?}`. `stdout` = stringified eval result; `stderr` = page errors + launch diagnostics; `exit_code` non-zero = the dispatch did not land -- read `stderr` and re-dispatch, never blind. `navigation_requested` reflects whether the dispatch carried a `url=`/bare-URL navigation; `landed_on_blank: true` with a `hint` means the expression ran against `about:blank` -- prefix `url=<target>` and re-dispatch.

## Headed by default

The window opens on the user's screen -- that IS the witness. `GM_BROWSER_HEADLESS=1` opts into headless; absent it, a session with no visible window is a launch you did not make. Do not assume or request headless to "be quiet"; the flash is the proof.

## Profile

`session new` (or a bare expression with no live session) spawns a locally-profiled Chromium at `<cwd>/.gm/browser-profile/`; the runner attaches via `--direct <wsEndpoint>`. Cookies/storage/extensions persist across sessions, turns, and runs. A second concurrent launch contends the SingletonLock; the watcher reuses the live CDP rather than re-launching. The runner's extension-attach mode ("Waiting for extension to connect") is never the default or what you want -- seeing it in `stderr` means the host failed to spawn local Chromium; dispatch `instruction` for recovery, not a blind retry.

## Profile and debug recipes

The page is a genuine profiler and debugger -- use it, never guess-and-restart. The `capture\n` prefix above does all of this for free; reach for the manual recipe below only for custom capture. Attach the listeners, then navigate, in one script so nothing fires before they are listening -- the captured arrays are the live witness:

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
- **Screenshots**: to actually SEE a screenshot, save it to a file and `Read` that path -- `await page.screenshot({path:'<abs>/shot.png'})` then `Read <abs>/shot.png` (the Read tool renders the PNG visually; witnessed). NEVER `return` the screenshot Buffer inline -- it stringifies to useless bytes in the envelope. The same applies to any binary: write it to a path, then Read the path.

Profile to LOCATE (which call/resource is slow), then eliminate hypotheses by live measurement -- never a/b-test by restarting. The node side mirrors this: `exec_js` with `process.hrtime.bigint()`/`performance.now()` timing, `process.memoryUsage()`, and `stderr` stack capture is a genuine node profiler+debugger.

**Process of elimination via monkeypatching is the default diagnostic method, not a last resort.** When a bug's cause is ambiguous among several candidate functions/paths/handlers, wrap each candidate in the live page with an instrumented replacement -- `const orig=obj.method; obj.method=function(...a){console.log('HIT',...a); return orig.apply(this,a);}` -- and observe which fires, with what args, in what order, relative to the symptom. This isolates the guilty call site from real execution instead of guessing from source reading alone or restarting with one hypothesis at a time. Combine with `capture\n` so the injected `console.log` markers land in `debug.console` for free. Patch in the same `page.evaluate` that also reproduces the symptom, so cause and effect are witnessed in one dispatch, not two. Restore or accept the patch is thrown away with the session -- never leave a monkeypatch as the actual fix; once the culprit is isolated, fix it at the source and re-witness clean.

## Discipline

Never spawn Chromium yourself, `npm i puppeteer`, or shell `chrome.exe`; the verb owns the handle, and bypassing it orphans state plugkit cannot reap and breaks the next session's first read. Navigate by evaluating `location.href = '...'` through the spool; screenshot by dispatching the verb that returns one. A dispatch returning `ok:false` with a launch error is plugkit reporting the environment refused -- read `stderr`, dispatch `instruction`, do not loop the same body.

**Dead-watcher recovery, never substitute.** If a Write to `.gm/exec-spool/in/browser/<N>.txt` produces no response after two re-Reads AND `.status.json` ts is stale (>5min from current epoch), the watcher is dead: boot `bun x gm-plugkit@latest spool`, then re-dispatch the browser body. Do NOT reach for puppeteer-core, puppeteer, playwright, agent-browser, `chrome.exe`, `npx browserless`, WebFetch, or curl-then-parse -- the browser verb is the only admissible browser surface; substitutes spawn orphan Chromium plugkit cannot reap, bypass section 23 witness-marked events, and produce evidence the gate cannot read. The recovery loop is always: empty response -> check `.status.json` -> if stale, boot -> re-dispatch.
