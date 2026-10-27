# Browser parity: reference MCP browser against gm browser

Design and inventory only. Source: reference project `main` branch (read via GitHub contents API into temp dir, deleted after use), local submodules `rs-plugkit`, `agentplug`, `gm-mcp` at checked-out state. Chrome extension and cloud browser out of scope, named only where they shape local capability. Reference paths relative to reference `src/` dir unless stated.

## 1. Reference browser-facing surface

### 1.1 MCP tools (`mcp.ts`)

Only two tools registered on reference MCP server, plus three read-only resources.

| Tool | Argument | Type | Default | Description |
| --- | --- | --- | --- | --- |
| execute | code | string (required) | none | Playwright JS, `{state, context}` in scope. No `page` global: assign `state.page = await context.newPage()` or pick from `context.pages()`. One line, statements sep by `;`. |
| execute | timeout | number (ms) | 10000, or env timeout override | Code exec timeout. Timeout errors show only message. |
| reset | none | none | none | Recreates CDP connection, resets browser and context. Clears custom globals and all keys of `state`. Reply: "Connection reset successfully. N page(s) available." |

Execute replies: text capped at 10000 chars, `[Truncated]` suffix. Screenshots returned inline as image content and saved to path. Errors carry reset hint unless timeout.

Resources (read-only, `text/plain`): `debugger-api`, `editor-api`, `styles-api`, each bundled markdown file.

### 1.2 CLI commands (`cli.ts`)

| Command | Options and arguments | Purpose |
| --- | --- | --- |
| browser start [binaryPath] | --user-data-dir, --headless, --headed, --disable-sandbox | Hidden command. Starts Chromium or Chrome for Testing with bundled extension. |
| browser install | none | Downloads Chrome for Testing (out of policy for gm). |
| browser list | --host, --token | Lists extension-connected and direct CDP browsers on port 9222. |
| session new | --browser (key, or `headless`, or `cloud`), --patchright, --direct [endpoint], --remote id, --proxy, --custom-proxy, --timeout minutes, --disable-proxy-bandwidth-acceleration, --tab-group, --tab-group-color | Creates session id. |
| session list | --host, --token | Lists sessions. |
| session delete <sessionId> | --host, --token | Deletes session and its state. |
| session update <sessionId> | --tab-group, --tab-group-color (grey, blue, red, yellow, green, pink, purple, cyan, orange) | Renames group (moves tabs) and/or recolours it. |
| session reset <sessionId> | --host, --token | Resets session's browser connection. |
| (default) | -s/--session, -e/--eval code, -f/--file path, --timeout ms (default 10000), --patchright, --host, --token | Runs JS in session, exits. Page work done through this path, not a `page` command. |
| recorder start | -s/--session | Starts action recording. |
| recorder stop [recordingId] | none | Stops recording, prints where events are. |
| recorder events [...eventIds] | -r/--recording, --type, --errors, --exclude regex, --full | Prints events as JSON lines (thin view default). |
| recorder frame <eventId> | -r/--recording, --offset ms | Prints path of nearest screencast frame. Local relay only. |
| recorder status | none | Lists active recordings. |
| stream start / stop / status | --rtmp, --resolution, --fps, --video-bitrate, --audio-bitrate, --keyframe-interval, --no-audio, --preset, --codec | Live RTMP streaming via ffmpeg. Out of scope (cloud and streaming). |
| serve / serve restart | --host, --token, --replace | Relay server. Out of scope for local single-host gm. |
| cloud login / me / logout / subscribe / status / live | --base-url | Cloud browsers. Out of scope. |
| logfile, skill | none | Prints relay log path and usage text. |

Screenshots, snapshots, console and network are not separate CLI commands. They are helpers inside `execute` code (section 1.3).

### 1.3 Helpers injected into execute code (`executor.ts`)

| Helper | Arguments (type, default) | Behaviour |
| --- | --- | --- |
| snapshot (alias accessibilitySnapshot) | page?, frame? (Frame or FrameLocator), locator? (Locator), search? (string or RegExp), showDiffSinceLastCall? (bool, default true unless search), format? (SnapshotFormat, only `raw`), interactiveOnly? (bool, default false) | A11y tree with refs. Returns text w/ `use refToLocator({ref, page})` hint. Caches per page and per locator; reports "No changes since last snapshot" on repeat. |
| screenshotWithAccessibilityLabels | page, interactiveOnly? (bool, default true) | Screenshot w/ numbered ref labels drawn on page, collected w/ snapshot. |
| resizeImageForAgent (alias resizeImage) | image options | Resizes to max 1568 px long side (`aria-snapshot.ts`, `LLM_MAX_DIMENSION`). |
| getCleanHTML | locator (Locator or Page, required), search?, showDiffSinceLastCall?, includeStyles?, maxAttrLen?, maxContentLen? | Cleaned HTML for scope (`clean-html.ts`). |
| getPageMarkdown | page? | Page content as markdown (`page-markdown.ts`). |
| getLatestLogs | page?, count?, search?, sinceLastCall? (bool, default false) | Console and page-error log lines per page and related pages. Cursor makes `sinceLastCall` return only new lines. |
| clearAllLogs | none | Clears per-page log buffers (cap 5000 lines per page). |
| waitForPageLoad | page?, timeout options | Waits for load and network settle (`wait-for-page-load.ts`). |
| getCDPSession | page or frame | Raw CDP session for `send(method, params)`. |
| createDebugger | {cdp} | Debugger helper, section 1.5. |
| createEditor | {cdp} | Script editor helper, section 1.6. |
| getLocatorStringForElement | Locator or ElementHandle | Returns Playwright locator string. |
| inspect / inspectPinnedElement | element and property list | DOM props, visibility, input state, aria attrs and box. |
| getStylesForLocator, formatStylesAsText | locator | Computed and matched styles (`styles.ts`). |
| getReactSource, getReactComponentInfo | locator | React component source and props (`react-source.ts`). |
| ghostCursor.show / hide | none | Visual cursor overlay (`ghost-cursor*.ts`). |

Log capture (`executor.ts` `setupPageConsoleListener`): each page stores `console` msgs as `[type] text`, `pageerror` as `[pageerror] message`. Logs survive navigation. `page-error` output event queued for sessions w/ state keys. Executor does not capture network; action recorder does (1.4).

### 1.4 Action recorder (`action-recorder.ts`)

Records user actions and network activity into recording file per session, for skill generation.

Limits: 20 min max duration (`DEFAULT_RECORDING_MAX_DURATION_MS`), 500 MB max size, 10 active recordings, 15 s enable timeout, 2 s disable timeout. Recorded network events sanitised: telemetry URLs dropped (`isTelemetryUrl`), URLs and bodies redacted (`sanitizeRecordedUrl`, `sanitizeRecordedBody`). Repeated identical network events merged (`collapseRepeatedNetwork`). Problem events (failed requests, errors, toasts) flagged for `--errors`. Events listed by `recorder events` with `--type`, `--errors`, `--exclude` (regex on URL) and `--full`.

### 1.5 Debugger (`debugger.ts`, class `Debugger`, built from `{cdp}`)

Methods: `enable`, `setBreakpoint({file, line, condition?})`, `deleteBreakpoint({breakpointId})`, `listBreakpoints`, `inspectLocalVariables`, `inspectGlobalVariables`, `evaluate({expression})`, `getLocation`, `stepOver`, `stepInto`, `stepOut`, `resume`, `isPaused`, `setPauseOnExceptions({state: none|uncaught|all})`, `listScripts({search?})`, `setXHRBreakpoint({url})`, `removeXHRBreakpoint({url})`, `listXHRBreakpoints`, `setBlackboxPatterns({patterns})`, `addBlackboxPattern({pattern})`, `removeBlackboxPattern({pattern})`, `listBlackboxPatterns`. Built on CDP `Debugger` domain.

### 1.6 Editor (`editor.ts`, class `Editor`, built from `{cdp}`)

Edits source of scripts loaded in page through CDP `Debugger` source APIs. Methods: `enable`, `list({pattern?: RegExp})`, `read({url, offset=0, limit=2000})`, `grep({regex, pattern?})`, `edit({url, oldString, newString, dryRun=false})`, `write({url, content, dryRun=false})`. Results carry `ReadResult`, `SearchMatch` and `EditResult`.

### 1.7 Launch path (`browser-launch.ts`, `browser-config.ts`, `browser-install.ts`)

Launch args (`getBrowserLaunchArgs`): `--user-data-dir=<dir>` (default: profile dir under user home), `--profile-directory=Default`, `--no-first-run`, `--no-default-browser-check`, `--disable-extensions-except=<ext>`, `--load-extension=<ext>`, `--headless=new` (optional), `--no-sandbox --disable-setuid-sandbox` (optional), URL last. Spawned detached, stdio ignored, unref'd.

Binary lookup order (`resolveBrowserExecutablePath`): explicit path arg (must exist), browser path env override (must exist), Chrome for Testing from reference install command under its own home dir, then platform candidates (macOS app bundles, Windows Program Files and LocalAppData, Linux `/opt/google/chrome-for-testing/chrome`, `/usr/bin/chromium`, `/snap/bin/chromium` and others), then `chrome`, `chromium`, `chromium-browser` on PATH, then Playwright's bundled chromium. Failed lookup error lists every searched path. Headless default on Linux without display (`shouldUseHeadlessByDefault`).

Improvements over our current launch (section 2.3) that fit gm policy:

- Explicit binary path arg on the verb, not only env vars.
- "Searched paths" list in not-found error. Our platform candidate list already exists (`browser.rs` lines 788 to 862), but error names only the two env vars.
- `--disable-sandbox` option for root containers, applied only when requested.
- Install and headless not improvements for us: gm never downloads binaries, `headless` lines refused by policy.

### 1.8 Out of scope

- Chrome extension: `--load-extension`, relay (`relay-*.ts`, `cdp-relay.ts`), `session new`/`list` extension path, extension-connected `browser list`.
- Cloud and remote: `--remote`, `--proxy`, `--custom-proxy`, `cloud *`, `serve`, `--host`, `--token`, `--patchright` stealth.
- Streaming: `stream *` (ffmpeg, RTMP).

## 2. Our current browser tooling

Read from local submodules. Verb path: `rs-plugkit/crates/plugkit-core/src/wasm_dispatch/verbs.rs` (`fn browser`, line 1548; `fn chrome` follows it). Host implementation: `agentplug/crates/agentplug-host/src/`. gm-mcp verb table: `gm-mcp/src/verb-table.js` (lines 741 to 759).

### 2.1 The browser verb and its cdp engine

- `browser` takes plain-text body. First line may be `engine=cdp`; other engines refused (`BROWSER_ERR_UNKNOWN_ENGINE`). `chrome` is same body under fixed `engine=cdp`, headful.
- Host chain: `verbs.rs::browser` calls component import `browser-cdp` (`component.rs` line 552), which calls `browser::browser_cdp` (`browser.rs` line 1019).
- `parse_cdp_browser_body` (`browser.rs` line 290): leading directives `engine=`, `session=` or `sessionId=` (named session), `expect=` (`tabs:N`, `reuse:<session>`, `open:N`) and `headful`. `headless` refused. Directives must precede first step. Steps: `url=`, `wait=`, `eval=` and browser steps (grammar in `TOOL_STEP_GRAMMAR`, `browser.rs` line 288): `snapshot`, `click`, `dblclick`, `hover`, `click_at`, `fill`, `type`, `press`, `press_uid`, `upload`, `wait_for`, `reload`, `back`, `forward`, `console`, `network[=reqid]`, `dialog=accept|dismiss`, `screenshot=`, `screenshot_full=`, `screenshot_uid=`, `trace_start`, `trace_stop[=path]`, `cdp <Domain.method>` with JSON params on next line, `events <Domain.event> [where field~value] [limit=N]`, `wait <ms>`.
- `browser_cdp` (`browser.rs` line 1019): parse, acquire lease, check `expect`, `attend_while_running`, run helper with 100 s budget (`CDP_HELPER_BUDGET`), build reply, release lease.
- Helper is `browser_cdp.mjs` with `browser_cdp_tools.mjs` embedded by `include_str!` (`browser.rs` lines 12 to 13). Config from `GM_BROWSER_CONFIG`.

### 2.2 Lease and the one-window-per-project rule (`browser_lease.rs`)

- One shared browser per project root, held in process-wide map (`BROWSERS`). Calls take lease with `acquire`, which waits in `claim_session` up to `WAIT_MS` (600 s) for current holder to release. Waiters counted (`WAITERS`).
- Holder liveness: heartbeat every `HEARTBEAT_MS` (2 s), `TTL_MS` (120 s). Holder with heartbeat older than 120 s counts as dead, evicted.
- Reusable browser: same headful mode, still running. Otherwise old browser closed and relaunched (reason `headful-mismatch` or `not-running`). Idle browser from earlier run can be adopted (`adopt_idle_browser`).
- Idle close: `BROWSER_IDLE_CLOSE_MS` = 15 min after last holder or waiter. Housekeeping every 30 s (`HOUSEKEEPING_TICK`).
- Verbs: `browser_lease_acquire` (waits up to 600 s; answers port, chrome_pid, lease_file), `browser_lease_release`, `browser_lease_status` (read-only).
- Record file `browser.json` and owner file under project's `.gm` state.

### 2.3 How it launches the browser

- Binary: `find_chrome` (`browser.rs` line 701 onward). Order: `GM_BROWSER_CHROME_PATH`, `CHROME_PATH`, then platform candidates (`windows_chrome_candidates`, `macos_chrome_candidates`, `linux_chrome_candidates`), then PATH. Headless-shell binary refused (`is_headless_shell`), since cdp engine needs full Chrome.
- Args: `--remote-debugging-port=<free local port>`, `--user-data-dir=<root>/.gm/browser-cdp-profile` (`profile_dir`), `--no-first-run`, `--no-default-browser-check`, `--disable-default-apps`, `about:blank`. Spawned windowless on Windows (`apply_windowless`), stdin, stdout and stderr null.
- Before each launch: `reap_stale_browsers`, `clear_profile_locks`, `prune_superseded_component_versions`, pruning of regenerable profile dirs (`component_crx_cache`, `BrowserMetrics`).
- Two attempts (`CDP_LAUNCH_ATTEMPTS`), each polling endpoint until `CDP_READY_DEADLINE`. Error names endpoint failure and suggests `GM_BROWSER_CHROME_PATH`.
- Headful only: `headful` always true; no headless path.

### 2.4 How it reports console and network today

- Per call only. Helper enables `Runtime` and `Log` when `console` step present (`attachConsole`), `Network` when `network` step present (`attachNetwork`), and `Page` always. Nothing listens between calls.
- `console` reply: `{op, count, messages}`. Each message: `{msgid, type, text, url, line, source?}`. Types from `Runtime.consoleAPICalled` (log, warning, error, others), `Runtime.exceptionThrown` (type `error`), `Log.entryAdded`, and `Page.javascriptDialogOpening` (type `dialog`, policy applied).
- `network` reply: `{op, count, requests}`. Each request: `{reqid, method, url, type, status, failed, bytes}`, built from `Network.requestWillBeSent`, `responseReceived`, `loadingFinished`, `loadingFailed`. `network=<reqid>` adds body from `Network.getResponseBody`.
- `events <Domain.event>` arms capture for one CDP event with optional `where` filter and `limit` (default 200, max 10000, `DEFAULT_EVENT_LIMIT`, `MAX_EVENT_LIMIT`). Returns `{op, event, where, count, dropped, events}`.
- Session file (`session_file`) keeps only tab target id and uid map for `snapshot` uids, so later call can reuse tab. Log buffers not kept.
- `snapshot` returns uid lines from accessibility tree (`takeSnapshot`, `snapshotUidState`). `screenshot`, `screenshot_full`, `screenshot_uid` write files, return path, format and bytes.

## 3. Live feedback through MCP

### 3.1 What gm-mcp already emits (code)

- Server declares `capabilities: { logging: {}, tools: { listChanged: true } }` (`gm-mcp/src/mcp-server.js` line 127). No `resources` capability.
- `notifications/message` sent in three places: continuation monitor via `server.server.sendLoggingMessage` (`gm-mcp/src/index.js` line 119), codemode heartbeat `gm_codemode still running after N s` with logger `gm_codemode` (`gm-mcp/src/codemode.js` line 47), and stdio relay's `emitContinuation` (`gm-mcp/src/stdio-relay.js` line 68).
- Progress notifications: `notifications/progress` with caller's `progressToken` (`codemode.js` line 48).
- Only one tool registered: `gm_codemode` (`codemode.js` line 526). Every verb, browser included, is a function on `gm` inside its code body.
- Streamable HTTP stateless, cannot push (`gm-mcp/src/http-transport.js` line 64 refuses GET streams; `gm-mcp/README.md` line 205 says push is stdio only, HTTP clients read `continuation` from reply).

So today: browser console and network data reach agent only in reply of finished `browser` call. Nothing pushes browser events while call runs or between calls.

### 3.2 What the MCP specification offers (not fetched in this run)

Code settles what gm-mcp emits, so spec not fetched. Applicable mechanisms, from MCP spec as known to this author:

- Logging: server declaring `logging` capability may send `notifications/message` with `level`, `logger`, `data` any time. Client may set minimum level with `logging/setLevel`. Existing channel, fits browser console lines (map `error` and `pageerror` to `error`, `warning` to `warning`, `log` and `info` to `info`, `debug` to `debug`).
- Resources: `notifications/resources/updated` requires `resources` capability with `subscribe`. Client subscribes via `resources/subscribe` to URI, such as `gm://browser/<session>/console`, re-reads with `resources/read`. Fits live log file exposed as resource, but needs new capability declaration.
- Transport limit: push needs live channel back to client. Stdio has one. Our stateless HTTP does not, so pushes stdio-only, as README already states for continuation.

### 3.3 Verdict

Live feed feasible over stdio with existing `notifications/message` path, provided browser events captured by long-running helper holding lease with heartbeat (`attend_while_running`), and gm-mcp polls that helper's output. Over HTTP, same events readable only from reply.

## 4. Parity matrix

Status key: present (same capability, local), partial (local, narrower), missing (absent locally). Out-of-scope rows (extension, cloud, streaming, relay) excluded. Change target is file or verb that would change.

| # | Reference capability | Arguments (type) | Status | Change target |
| --- | --- | --- | --- | --- |
| 1 | execute (JS with state and context) | code string; timeout number ms, default 10000 | partial | gm-mcp/src/codemode.js; browser text body |
| 2 | reset (reconnect, clear state) | none | missing | agentplug-host/src/browser_lease.rs; verbs.rs |
| 3 | state and context kept across calls | state object | missing | agentplug-host/src/browser_cdp_tools.mjs; browser.rs session_file |
| 4 | pick or create tab (context.pages, newPage) | tab index or new url | partial | agentplug-host/src/browser.rs (expect tabs/open) |
| 5 | browser start with binary path | binaryPath string | partial | agentplug-host/src/browser_lease.rs find_chrome |
| 6 | browser path env override, reference style | env string | present | browser_lease.rs (GM_BROWSER_CHROME_PATH, CHROME_PATH) |
| 7 | searched-paths list on lookup failure | none | missing | agentplug-host/src/browser_lease.rs launch |
| 8 | persistent profile dir option | --user-data-dir string | missing | agentplug-host/src/browser_lease.rs profile_dir |
| 9 | headless start | --headless bool | missing (refused by policy) | none |
| 10 | headed start | --headed bool | present | browser.rs (headful always) |
| 11 | disable sandbox | --disable-sandbox bool | missing | agentplug-host/src/browser_lease.rs launch args |
| 12 | install Chrome for Testing | none | missing (out of policy) | none |
| 13 | list browsers | none | partial | agentplug-host/src/browser_lease.rs status; verbs.rs |
| 14 | session new | session name string | partial | agentplug-host/src/browser.rs session_file |
| 15 | session list | none | missing | browser.rs; verbs.rs |
| 16 | session delete | session id string | missing | browser.rs; verbs.rs |
| 17 | session update (tab group title and color) | name string, color enum | missing | browser_cdp_tools.mjs; browser.rs; verbs.rs |
| 18 | session reset | session id string | missing | browser_lease.rs; verbs.rs |
| 19 | attach to existing Chrome (direct CDP) | endpoint string or auto | missing | agentplug-host/src/browser_lease.rs |
| 20 | session selector on call | session string | present | browser.rs `session=` |
| 21 | per-call timeout | timeout number ms | partial | agentplug-host/src/browser.rs (fixed 100 s budget) |
| 22 | snapshot (a11y tree, uids) | interactiveOnly bool; format raw | present | browser_cdp_tools.mjs takeSnapshot |
| 23 | snapshot search | search string or regex | missing | browser_cdp_tools.mjs |
| 24 | snapshot scoped to locator or frame | locator or frame selector | missing | browser_cdp_tools.mjs |
| 25 | snapshot diff since last call | showDiffSinceLastCall bool | missing | browser_cdp_tools.mjs; session file |
| 26 | screenshot to file (page) | path string; full bool | present | browser_cdp_tools.mjs screenshotStep |
| 27 | screenshot of one element by uid | uid string; path string | present | browser_cdp_tools.mjs |
| 28 | screenshot format from extension | path extension jpeg or png | partial | browser_cdp_tools.mjs screenshotFormat |
| 29 | screenshot with numbered ref labels | page; interactiveOnly bool, default true | missing | browser_cdp_tools.mjs; new aria-label module |
| 30 | resize image for agent (max 1568 px) | image; max dimension number | missing | browser_cdp_tools.mjs |
| 31 | screenshot returned inline as image content | none | missing | gm-mcp/src/codemode.js; reply shape |
| 32 | clean HTML of scope | locator string; search; maxAttrLen, maxContentLen numbers | missing | browser_cdp_tools.mjs (new op) |
| 33 | page markdown | page; options | missing | browser_cdp_tools.mjs (new op) |
| 34 | locator string for element or uid | uid string | missing | browser_cdp_tools.mjs |
| 35 | refToLocator (ref to locator) | ref string | missing | browser_cdp_tools.mjs |
| 36 | element inspect (props, aria, box, input state) | properties list; element | missing | browser_cdp_tools.mjs (new op) |
| 37 | computed and matched styles | locator string | missing | new browser_styles.mjs; browser.rs include |
| 38 | React source and component info | locator string | missing | new browser_react.mjs; browser.rs include |
| 39 | console capture (type, text, url, line) | none | present | browser_cdp_tools.mjs attachConsole |
| 40 | page error capture | none | present | browser_cdp_tools.mjs attachConsole |
| 41 | log lines across calls (count, search, sinceLastCall) | count number; search string; sinceLastCall bool | partial | browser_cdp_tools.mjs; session file |
| 42 | clear all logs | none | missing | browser_cdp_tools.mjs |
| 43 | network request list (reqid, method, url, status, bytes) | none | present | browser_cdp_tools.mjs attachNetwork |
| 44 | network response body by reqid | reqid number | present | browser_cdp_tools.mjs networkReport |
| 45 | network log across calls | none | missing | action recorder module; browser_cdp_tools.mjs |
| 46 | dialog policy (accept or dismiss) | action enum | present | browser_cdp_tools.mjs setDialogPolicy |
| 47 | dialog prompt text | promptText string | missing | browser_cdp_tools.mjs setDialogPolicy |
| 48 | wait for load and network settle | timeout number ms | partial | browser_cdp_tools.mjs (wait_for, wait ms) |
| 49 | raw CDP send | method string; params JSON | present | browser.rs parse_raw_cdp_step |
| 50 | CDP event capture with filter and limit | event string; where filter; limit number | present | browser.rs parse_events_step |
| 51 | trace start and stop with summary | path string | present | browser_cdp_tools.mjs traceStart, traceStop |
| 52 | click, dblclick, hover, click_at, fill, type, press, upload | uid string; coordinates; text or key | present | browser_cdp_tools.mjs |
| 53 | reload, back, forward | none | present | browser_cdp_tools.mjs |
| 54 | ghost cursor overlay | none | missing | new browser_cursor.mjs |
| 55 | debugger breakpoints (set, delete, list) | file string; line number; condition string | missing | new browser_debugger.mjs; browser.rs parse |
| 56 | debugger stepping and resume | none | missing | new browser_debugger.mjs |
| 57 | debugger evaluate and variable inspection | expression string | missing | new browser_debugger.mjs |
| 58 | pause on exceptions | state enum none, uncaught, all | missing | new browser_debugger.mjs |
| 59 | list scripts | search string | missing | new browser_debugger.mjs |
| 60 | XHR breakpoints and blackbox patterns | url or pattern string | missing | new browser_debugger.mjs |
| 61 | editor list, read, grep of page scripts | pattern regex; url string; offset, limit numbers | missing | new browser_editor.mjs |
| 62 | editor edit and write of page scripts | url string; oldString, newString or content; dryRun bool | missing | new browser_editor.mjs |
| 63 | action recorder start and stop | session string; limits (20 min, 500 MB, 10 active) | missing | new agentplug-host recorder module; lib.rs; verbs.rs |
| 64 | recorder events with filters | type string; errors bool; exclude regex | missing | recorder module; verbs.rs |
| 65 | recorder frame for an event | eventId string | missing | recorder module; verbs.rs |
| 66 | telemetry and body sanitising | none | missing | recorder module |
| 67 | CDP discovery (port 9222, DevToolsActivePort) | port number | missing | agentplug-host/src/browser_lease.rs |
| 68 | stale lock clearing and cache pruning | none | present | browser_lease.rs clear_profile_locks, prune_superseded_component_versions |
| 69 | reconnect after crashed browser | none | partial | browser_lease.rs (adopt_idle_browser, endpoint_ready); reset verb (row 2) |
| 70 | live browser log push to client | level enum; logger string | missing | gm-mcp/src/mcp-server.js; new event helper |
| 71 | browser API docs as MCP resources | URI string | missing | gm-mcp/src/mcp-server.js (resources capability) |

Matrix rows: 71. Missing rows counted in report line.

## 5. Build order (parallel lanes, disjoint files)

Lanes numbered. Within lane, steps run in order. Lanes 1, 2, 3, 4 and 6 touch disjoint files, start together. Lane 5 waits for lane 1 (adds one dispatch line to `browser_cdp_tools.mjs`). Lane 7 waits for lanes 2, 3 and 6 (verb names and host functions). Lane 8 runs last.

1. Lane 1, helper ops (file: `agentplug/crates/agentplug-host/src/browser_cdp_tools.mjs` only). Snapshot search, scope and diff (rows 23 to 25); dialog prompt text (47); clear logs and sinceLastCall cursor (41, 42); clean HTML and page markdown (32, 33); locator string and refToLocator (34, 35); inspect (36); labelled screenshot and image resize (29, 30). Witness: `browser` call with each new step through `dispatch-verb.mjs`.
2. Lane 2, browser body and session (files: `agentplug/crates/agentplug-host/src/browser.rs` only). Session list, delete, update and reset (15 to 18); per-call timeout directive (21); session persistence of log cursor (input to row 41, after lane 1 publishes state shape).
3. Lane 3, lease and launch (file: `agentplug/crates/agentplug-host/src/browser_lease.rs` only). Browser path arg and searched-paths error (5, 7); profile dir option (8); sandbox option (11); CDP discovery (19, 67); reset and status shapes (2, 13); reconnect (69).
4. Lane 4, live feed helper (new file: `agentplug/crates/agentplug-host/src/browser_events.mjs`; Rust host hook in `agentplug/crates/agentplug-host/src/component.rs`). Long-running `events` capture holding lease with heartbeat, writes JSON lines to spool file. Feeds row 70.
5. Lane 5, debugger and editor (new files: `browser_debugger.mjs`, `browser_editor.mjs`, `browser_cursor.mjs`; one dispatch line each in `browser_cdp_tools.mjs`, after lane 1). Rows 54 to 62.
6. Lane 6, recorder (new module in `agentplug/crates/agentplug-host/src/`, plus its line in `agentplug/crates/agentplug-host/src/lib.rs`). Rows 63 to 66.
7. Lane 7, verbs and dispatch (file: `rs-plugkit/crates/plugkit-core/src/wasm_dispatch/verbs.rs`, plus component import in `agentplug/crates/agentplug-host/src/component.rs`). New verbs for rows 2, 13 to 18, 63 to 65. Rebuild with `--features slim` through CI, then witness each verb with `scripts/triage/dispatch-verb.mjs`.
8. Lane 8, MCP surface and docs (files: `gm-mcp/src/mcp-server.js`, `gm-mcp/src/verb-table.js`, `gm-mcp/src/codemode.js`, then `skills/gm/docs/verbs.md`). Resources capability and browser docs (71); live push from lane 4's feed (70); inline screenshot content (31); verb-table rows for lane 7's verbs; bundle rebuild and docs update last.

First lane to publish is lane 1 or lane 3; lane 4 can start from own file as soon as spool format fixed.

## 6. Notes on this document

- Every row above names a file or verb that exists today, or a new file in an existing directory.
- Reference source read at `main` through GitHub contents API. Temp dir used for download deleted after reading.