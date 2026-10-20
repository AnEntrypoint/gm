# Browser parity: reference MCP browser against gm browser

Design and inventory only. Source: the reference project `main` branch (read through the GitHub contents API into a temp directory, deleted after use), and the local submodules `rs-plugkit`, `agentplug`, `gm-mcp` at their checked-out state. The Chrome extension and the cloud browser are out of scope and are named here only where they shape a local capability. Reference paths below are relative to the reference `src/` directory unless stated.

## 1. Reference browser-facing surface

### 1.1 MCP tools (`mcp.ts`)

Only two tools are registered on the reference MCP server, plus three read-only resources.

| Tool | Argument | Type | Default | Description |
| --- | --- | --- | --- | --- |
| execute | code | string (required) | none | Playwright JavaScript with `{state, context}` in scope. No `page` global: assign `state.page = await context.newPage()` or pick from `context.pages()`. One line, statements separated by `;`. |
| execute | timeout | number (ms) | 10000, or an env timeout override | Code execution timeout. Timeout errors show only the message. |
| reset | none | none | none | Recreates the CDP connection and resets browser and context. Clears custom globals and all keys of `state`. Reply: "Connection reset successfully. N page(s) available." |

Execute replies are text capped at 10000 characters with a `[Truncated]` suffix. Screenshots are returned inline as image content and also saved to a path. Errors carry a reset hint unless the error is a timeout.

Resources (read-only text, `text/plain`): `debugger-api`, `editor-api`, `styles-api`, each a bundled markdown file.

### 1.2 CLI commands (`cli.ts`)

| Command | Options and arguments | Purpose |
| --- | --- | --- |
| browser start [binaryPath] | --user-data-dir, --headless, --headed, --disable-sandbox | Hidden command. Starts Chromium or Chrome for Testing with the bundled extension. |
| browser install | none | Downloads Chrome for Testing (out of policy for gm). |
| browser list | --host, --token | Lists extension-connected and direct CDP browsers on port 9222. |
| session new | --browser (key, or `headless`, or `cloud`), --patchright, --direct [endpoint], --remote id, --proxy, --custom-proxy, --timeout minutes, --disable-proxy-bandwidth-acceleration, --tab-group, --tab-group-color | Creates a session id. |
| session list | --host, --token | Lists sessions. |
| session delete <sessionId> | --host, --token | Deletes a session and its state. |
| session update <sessionId> | --tab-group, --tab-group-color (grey, blue, red, yellow, green, pink, purple, cyan, orange) | Renames the group (moves tabs) and/or recolours it. |
| session reset <sessionId> | --host, --token | Resets the session's browser connection. |
| (default) | -s/--session, -e/--eval code, -f/--file path, --timeout ms (default 10000), --patchright, --host, --token | Runs JavaScript in a session and exits. Page work is done through this path, not through a `page` command. |
| recorder start | -s/--session | Starts an action recording. |
| recorder stop [recordingId] | none | Stops a recording and prints where the events are. |
| recorder events [...eventIds] | -r/--recording, --type, --errors, --exclude regex, --full | Prints events as JSON lines (thin view by default). |
| recorder frame <eventId> | -r/--recording, --offset ms | Prints the path of the nearest screencast frame. Local relay only. |
| recorder status | none | Lists active recordings. |
| stream start / stop / status | --rtmp, --resolution, --fps, --video-bitrate, --audio-bitrate, --keyframe-interval, --no-audio, --preset, --codec | Live RTMP streaming via ffmpeg. Out of scope (cloud and streaming). |
| serve / serve restart | --host, --token, --replace | Relay server. Out of scope for a local single-host gm. |
| cloud login / me / logout / subscribe / status / live | --base-url | Cloud browsers. Out of scope. |
| logfile, skill | none | Prints the relay log path and the usage text. |

Screenshots, snapshots, console and network are not separate CLI commands. They are helpers inside `execute` code (section 1.3).

### 1.3 Helpers injected into execute code (`executor.ts`)

| Helper | Arguments (type, default) | Behaviour |
| --- | --- | --- |
| snapshot (alias accessibilitySnapshot) | page?, frame? (Frame or FrameLocator), locator? (Locator), search? (string or RegExp), showDiffSinceLastCall? (bool, default true unless search), format? (SnapshotFormat, only `raw`), interactiveOnly? (bool, default false) | Accessibility tree with refs. Returns text with `use refToLocator({ref, page})` hint. Caches per page and per locator; reports "No changes since last snapshot" on repeat. |
| screenshotWithAccessibilityLabels | page, interactiveOnly? (bool, default true) | Screenshot with numbered ref labels drawn on the page, collected with the snapshot. |
| resizeImageForAgent (alias resizeImage) | image options | Resizes to at most 1568 px on the long side (`aria-snapshot.ts`, `LLM_MAX_DIMENSION`). |
| getCleanHTML | locator (Locator or Page, required), search?, showDiffSinceLastCall?, includeStyles?, maxAttrLen?, maxContentLen? | Cleaned HTML for a scope (`clean-html.ts`). |
| getPageMarkdown | page? | Page content as markdown (`page-markdown.ts`). |
| getLatestLogs | page?, count?, search?, sinceLastCall? (bool, default false) | Console and page-error log lines per page and its related pages. A cursor makes `sinceLastCall` return only new lines. |
| clearAllLogs | none | Clears the per-page log buffers (cap 5000 lines per page). |
| waitForPageLoad | page?, timeout options | Waits for load and network settle (`wait-for-page-load.ts`). |
| getCDPSession | page or frame | Raw CDP session for `send(method, params)`. |
| createDebugger | {cdp} | Debugger helper, section 1.5. |
| createEditor | {cdp} | Script editor helper, section 1.6. |
| getLocatorStringForElement | Locator or ElementHandle | Returns a Playwright locator string. |
| inspect / inspectPinnedElement | element and property list | DOM properties, visibility, input state, aria attributes and box. |
| getStylesForLocator, formatStylesAsText | locator | Computed and matched styles (`styles.ts`). |
| getReactSource, getReactComponentInfo | locator | React component source and props (`react-source.ts`). |
| ghostCursor.show / hide | none | Visual cursor overlay (`ghost-cursor*.ts`). |

Log capture (`executor.ts` `setupPageConsoleListener`): every page gets `console` messages stored as `[type] text`, and `pageerror` stored as `[pageerror] message`. Logs survive navigation. A `page-error` output event is queued for sessions with state keys. Network requests are not captured by the executor; they are captured by the action recorder (1.4).

### 1.4 Action recorder (`action-recorder.ts`)

Records user actions and network activity into a recording file per session, for skill generation.

Limits: 20 minutes maximum duration (`DEFAULT_RECORDING_MAX_DURATION_MS`), 500 MB maximum size, 10 active recordings, 15 s enable timeout, 2 s disable timeout. Recorded network events are sanitised: telemetry URLs are dropped (`isTelemetryUrl`), URLs and bodies are redacted (`sanitizeRecordedUrl`, `sanitizeRecordedBody`). Repeated identical network events are merged (`collapseRepeatedNetwork`). Problem events (failed requests, errors, toasts) are flagged for `--errors`. Events are listed by `recorder events` with `--type`, `--errors`, `--exclude` (regex on URL) and `--full`.

### 1.5 Debugger (`debugger.ts`, class `Debugger`, built from `{cdp}`)

Methods: `enable`, `setBreakpoint({file, line, condition?})`, `deleteBreakpoint({breakpointId})`, `listBreakpoints`, `inspectLocalVariables`, `inspectGlobalVariables`, `evaluate({expression})`, `getLocation`, `stepOver`, `stepInto`, `stepOut`, `resume`, `isPaused`, `setPauseOnExceptions({state: none|uncaught|all})`, `listScripts({search?})`, `setXHRBreakpoint({url})`, `removeXHRBreakpoint({url})`, `listXHRBreakpoints`, `setBlackboxPatterns({patterns})`, `addBlackboxPattern({pattern})`, `removeBlackboxPattern({pattern})`, `listBlackboxPatterns`. Built on CDP `Debugger` domain.

### 1.6 Editor (`editor.ts`, class `Editor`, built from `{cdp}`)

Edits the source of scripts loaded in the page through CDP `Debugger` source APIs. Methods: `enable`, `list({pattern?: RegExp})`, `read({url, offset=0, limit=2000})`, `grep({regex, pattern?})`, `edit({url, oldString, newString, dryRun=false})`, `write({url, content, dryRun=false})`. Results carry `ReadResult`, `SearchMatch` and `EditResult`.

### 1.7 Launch path (`browser-launch.ts`, `browser-config.ts`, `browser-install.ts`)

Launch arguments (`getBrowserLaunchArgs`): `--user-data-dir=<dir>` (default: a profile directory under the user home), `--profile-directory=Default`, `--no-first-run`, `--no-default-browser-check`, `--disable-extensions-except=<ext>`, `--load-extension=<ext>`, `--headless=new` (optional), `--no-sandbox --disable-setuid-sandbox` (optional), URL last. Spawned detached with stdio ignored and unref'd.

Binary lookup order (`resolveBrowserExecutablePath`): explicit path argument (must exist), a browser path env override (must exist), Chrome for Testing from the reference install command under its own home directory, then platform candidates (macOS app bundles, Windows Program Files and LocalAppData, Linux `/opt/google/chrome-for-testing/chrome`, `/usr/bin/chromium`, `/snap/bin/chromium` and others), then `chrome`, `chromium`, `chromium-browser` on PATH, then Playwright's bundled chromium. On a failed lookup the error lists every searched path. Headless is the default on Linux without a display (`shouldUseHeadlessByDefault`).

Improvements over our current launch (section 2.3) that fit the gm policy:

- An explicit binary path argument on the verb, not only environment variables.
- A "searched paths" list in the not-found error. Our platform candidate list already exists (`browser.rs` lines 788 to 862), but the error names only the two environment variables.
- A `--disable-sandbox` option for root containers, applied only when requested.
- Install and headless are not improvements for us: gm never downloads browser binaries, and `headless` lines are refused by policy.

### 1.8 Out of scope

- Chrome extension: `--load-extension`, the relay (`relay-*.ts`, `cdp-relay.ts`), the `session new`/`list` extension path, and the extension-connected `browser list`.
- Cloud and remote: `--remote`, `--proxy`, `--custom-proxy`, `cloud *`, `serve`, `--host`, `--token`, `--patchright` stealth.
- Streaming: `stream *` (ffmpeg, RTMP).

## 2. Our current browser tooling

Read from the local submodules. Verb path: `rs-plugkit/crates/plugkit-core/src/wasm_dispatch/verbs.rs` (`fn browser`, line 1548; `fn chrome` follows it). Host implementation: `agentplug/crates/agentplug-host/src/`. The gm-mcp verb table is `gm-mcp/src/verb-table.js` (lines 741 to 759).

### 2.1 The browser verb and its cdp engine

- `browser` takes a plain-text body. The first line may be `engine=cdp`; any other engine is refused (`BROWSER_ERR_UNKNOWN_ENGINE`). `chrome` is the same body under a fixed `engine=cdp`, headful.
- Host chain: `verbs.rs::browser` calls the component import `browser-cdp` (`component.rs` line 552), which calls `browser::browser_cdp` (`browser.rs` line 1019).
- `parse_cdp_browser_body` (`browser.rs` line 290): leading directives `engine=`, `session=` or `sessionId=` (named session), `expect=` (`tabs:N`, `reuse:<session>`, `open:N`) and `headful`. `headless` is refused. Directives must come before the first step. Steps: `url=`, `wait=`, `eval=` and browser steps (grammar in `TOOL_STEP_GRAMMAR`, `browser.rs` line 288): `snapshot`, `click`, `dblclick`, `hover`, `click_at`, `fill`, `type`, `press`, `press_uid`, `upload`, `wait_for`, `reload`, `back`, `forward`, `console`, `network[=reqid]`, `dialog=accept|dismiss`, `screenshot=`, `screenshot_full=`, `screenshot_uid=`, `trace_start`, `trace_stop[=path]`, `cdp <Domain.method>` with JSON params on the next line, `events <Domain.event> [where field~value] [limit=N]`, `wait <ms>`.
- `browser_cdp` (`browser.rs` line 1019): parse, acquire the lease, check `expect`, `attend_while_running`, run the helper with a 100 s budget (`CDP_HELPER_BUDGET`), build the reply, release the lease.
- The helper is `browser_cdp.mjs` with `browser_cdp_tools.mjs` embedded by `include_str!` (`browser.rs` lines 12 to 13). Its config comes from `GM_BROWSER_CONFIG`.

### 2.2 Lease and the one-window-per-project rule (`browser_lease.rs`)

- One shared browser per project root, held in a process-wide map (`BROWSERS`). Calls take a lease with `acquire`, which waits in `claim_session` for up to `WAIT_MS` (600 s) for the current holder to release. Waiters are counted (`WAITERS`).
- Holder liveness: heartbeat every `HEARTBEAT_MS` (2 s), `TTL_MS` (120 s). A holder whose heartbeat is older than 120 s counts as dead and is evicted.
- A reusable browser is one with the same headful mode that is still running. Otherwise the old browser is closed and relaunched (reason `headful-mismatch` or `not-running`). An idle browser from an earlier run can be adopted (`adopt_idle_browser`).
- Idle close: `BROWSER_IDLE_CLOSE_MS` = 15 min after the last holder or waiter. Housekeeping runs every 30 s (`HOUSEKEEPING_TICK`).
- Verbs: `browser_lease_acquire` (waits up to 600 s; answers port, chrome_pid, lease_file), `browser_lease_release`, `browser_lease_status` (read-only).
- Record file `browser.json` and owner file under the project's `.gm` state.

### 2.3 How it launches the browser

- Binary: `find_chrome` (`browser.rs` line 701 onward). Order: `GM_BROWSER_CHROME_PATH`, `CHROME_PATH`, then the platform candidates (`windows_chrome_candidates`, `macos_chrome_candidates`, `linux_chrome_candidates`), then PATH. A headless-shell binary is refused (`is_headless_shell`), since the cdp engine needs full Chrome.
- Arguments: `--remote-debugging-port=<free local port>`, `--user-data-dir=<root>/.gm/browser-cdp-profile` (`profile_dir`), `--no-first-run`, `--no-default-browser-check`, `--disable-default-apps`, `about:blank`. Spawned windowless on Windows (`apply_windowless`), stdin, stdout and stderr null.
- Before each launch: `reap_stale_browsers`, `clear_profile_locks`, `prune_superseded_component_versions`, and pruning of regenerable profile directories (`component_crx_cache`, `BrowserMetrics`).
- Two attempts (`CDP_LAUNCH_ATTEMPTS`), each polling the endpoint until `CDP_READY_DEADLINE`. The error names the endpoint failure and suggests `GM_BROWSER_CHROME_PATH`.
- Headful only: `headful` is always true; there is no headless path.

### 2.4 How it reports console and network today

- Per call only. The helper enables `Runtime` and `Log` when a `console` step is present (`attachConsole`), `Network` when a `network` step is present (`attachNetwork`), and `Page` always. Nothing listens between calls.
- `console` reply: `{op, count, messages}`. Each message is `{msgid, type, text, url, line, source?}`. Types come from `Runtime.consoleAPICalled` (log, warning, error, and others), `Runtime.exceptionThrown` (type `error`), `Log.entryAdded`, and `Page.javascriptDialogOpening` (type `dialog`, with the policy applied).
- `network` reply: `{op, count, requests}`. Each request is `{reqid, method, url, type, status, failed, bytes}`, built from `Network.requestWillBeSent`, `responseReceived`, `loadingFinished` and `loadingFailed`. `network=<reqid>` adds the body from `Network.getResponseBody`.
- `events <Domain.event>` arms a capture for one CDP event with an optional `where` filter and a `limit` (default 200, maximum 10000, `DEFAULT_EVENT_LIMIT`, `MAX_EVENT_LIMIT`). It returns `{op, event, where, count, dropped, events}`.
- The session file (`session_file`) keeps only the tab target id and the uid map for `snapshot` uids, so a later call can use the same tab. Log buffers are not kept.
- `snapshot` returns uid lines built from the accessibility tree (`takeSnapshot`, `snapshotUidState`). `screenshot`, `screenshot_full` and `screenshot_uid` write files and return path, format and bytes.

## 3. Live feedback through MCP

### 3.1 What gm-mcp already emits (code)

- The server declares `capabilities: { logging: {}, tools: { listChanged: true } }` (`gm-mcp/src/mcp-server.js` line 127). There is no `resources` capability.
- `notifications/message` is sent in three places: the continuation monitor through `server.server.sendLoggingMessage` (`gm-mcp/src/index.js` line 119), the codemode heartbeat `gm_codemode still running after N s` with logger `gm_codemode` (`gm-mcp/src/codemode.js` line 47), and the stdio relay's `emitContinuation` (`gm-mcp/src/stdio-relay.js` line 68).
- Progress notifications: `notifications/progress` with the caller's `progressToken` (`codemode.js` line 48).
- Only one tool is registered: `gm_codemode` (`codemode.js` line 526). Every verb, the browser included, is a function on `gm` inside its code body.
- Streamable HTTP is stateless and cannot push (`gm-mcp/src/http-transport.js` line 64 refuses GET streams; `gm-mcp/README.md` line 205 says push is stdio only, and HTTP clients read `continuation` from the reply).

So today: browser console and network data reach the agent only in the reply of a finished `browser` call. Nothing pushes browser events while a call runs or between calls.

### 3.2 What the MCP specification offers (not fetched in this run)

The code settles what gm-mcp emits, so the specification was not fetched. The mechanisms that apply, from the MCP specification as known to this author:

- Logging: a server that declares the `logging` capability may send `notifications/message` with `level`, `logger` and `data` at any time. The client may set a minimum level with `logging/setLevel`. This is the existing channel and fits browser console lines (map `error` and `pageerror` to `error`, `warning` to `warning`, `log` and `info` to `info`, `debug` to `debug`).
- Resources: `notifications/resources/updated` requires the `resources` capability with `subscribe`. A client subscribes with `resources/subscribe` to a URI, such as `gm://browser/<session>/console`, and re-reads it with `resources/read`. This fits a live log file exposed as a resource, but it needs a new capability declaration.
- Transport limit: push needs a live channel back to the client. Stdio has one. Our stateless HTTP does not, so pushes would be stdio-only, as the README already states for continuation.

### 3.3 Verdict

A live feed is feasible over stdio with the existing `notifications/message` path, provided the browser events are captured by a long-running helper that holds the lease with its heartbeat (`attend_while_running`), and gm-mcp polls that helper's output. Over HTTP the same events can only be read from the reply.

## 4. Parity matrix

Status key: present (same capability, local), partial (local, narrower), missing (absent locally). Out-of-scope rows (extension, cloud, streaming, relay) are excluded. The change target is the file or verb that would change.

| # | Reference capability | Arguments (type) | Status | Change target |
| --- | --- | --- | --- | --- |
| 1 | execute (JS with state and context) | code string; timeout number ms, default 10000 | partial | gm-mcp/src/codemode.js; browser text body |
| 2 | reset (reconnect, clear state) | none | missing | agentplug-host/src/browser_lease.rs; verbs.rs |
| 3 | state and context kept across calls | state object | missing | agentplug-host/src/browser_cdp_tools.mjs; browser.rs session_file |
| 4 | pick or create a tab (context.pages, newPage) | tab index or new url | partial | agentplug-host/src/browser.rs (expect tabs/open) |
| 5 | browser start with binary path | binaryPath string | partial | agentplug-host/src/browser_lease.rs find_chrome |
| 6 | browser path env override in the reference style | env string | present | browser_lease.rs (GM_BROWSER_CHROME_PATH, CHROME_PATH) |
| 7 | searched-paths list on lookup failure | none | missing | agentplug-host/src/browser_lease.rs launch |
| 8 | persistent profile directory option | --user-data-dir string | missing | agentplug-host/src/browser_lease.rs profile_dir |
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
| 19 | attach to an existing Chrome (direct CDP) | endpoint string or auto | missing | agentplug-host/src/browser_lease.rs |
| 20 | session selector on a call | session string | present | browser.rs `session=` |
| 21 | per-call timeout | timeout number ms | partial | agentplug-host/src/browser.rs (fixed 100 s budget) |
| 22 | snapshot (accessibility tree, uids) | interactiveOnly bool; format raw | present | browser_cdp_tools.mjs takeSnapshot |
| 23 | snapshot search | search string or regex | missing | browser_cdp_tools.mjs |
| 24 | snapshot scoped to locator or frame | locator or frame selector | missing | browser_cdp_tools.mjs |
| 25 | snapshot diff since last call | showDiffSinceLastCall bool | missing | browser_cdp_tools.mjs; session file |
| 26 | screenshot to file (page) | path string; full bool | present | browser_cdp_tools.mjs screenshotStep |
| 27 | screenshot of one element by uid | uid string; path string | present | browser_cdp_tools.mjs |
| 28 | screenshot format from extension | path extension jpeg or png | partial | browser_cdp_tools.mjs screenshotFormat |
| 29 | screenshot with numbered ref labels | page; interactiveOnly bool, default true | missing | browser_cdp_tools.mjs; new aria-label module |
| 30 | resize image for agent (max 1568 px) | image; max dimension number | missing | browser_cdp_tools.mjs |
| 31 | screenshot returned inline as image content | none | missing | gm-mcp/src/codemode.js; reply shape |
| 32 | clean HTML of a scope | locator string; search; maxAttrLen, maxContentLen numbers | missing | browser_cdp_tools.mjs (new op) |
| 33 | page markdown | page; options | missing | browser_cdp_tools.mjs (new op) |
| 34 | locator string for an element or uid | uid string | missing | browser_cdp_tools.mjs |
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
| 69 | reconnect after a crashed browser | none | partial | browser_lease.rs (adopt_idle_browser, endpoint_ready); reset verb (row 2) |
| 70 | live browser log push to the client | level enum; logger string | missing | gm-mcp/src/mcp-server.js; new event helper |
| 71 | browser API docs as MCP resources | URI string | missing | gm-mcp/src/mcp-server.js (resources capability) |

Matrix rows: 71. Rows marked missing: counted in the report line.

## 5. Build order (parallel lanes, disjoint files)

Lanes are numbered. Within a lane, steps run in order. Lanes 1, 2, 3, 4 and 6 touch disjoint files and start together. Lane 5 waits for lane 1 (it adds one dispatch line to `browser_cdp_tools.mjs`). Lane 7 waits for lanes 2, 3 and 6 (verb names and host functions). Lane 8 runs last.

1. Lane 1, helper ops (file: `agentplug/crates/agentplug-host/src/browser_cdp_tools.mjs` only). Snapshot search, scope and diff (rows 23 to 25); dialog prompt text (47); clear logs and sinceLastCall cursor (41, 42); clean HTML and page markdown (32, 33); locator string and refToLocator (34, 35); inspect (36); labelled screenshot and image resize (29, 30). Witness: a `browser` call with each new step through `dispatch-verb.mjs`.
2. Lane 2, browser body and session (files: `agentplug/crates/agentplug-host/src/browser.rs` only). Session list, delete, update and reset (15 to 18); per-call timeout directive (21); session persistence of the log cursor (input to row 41, after lane 1 publishes its state shape).
3. Lane 3, lease and launch (file: `agentplug/crates/agentplug-host/src/browser_lease.rs` only). Browser path argument and searched-paths error (5, 7); profile directory option (8); sandbox option (11); CDP discovery (19, 67); reset and status shapes (2, 13); reconnect (69).
4. Lane 4, live feed helper (new file: `agentplug/crates/agentplug-host/src/browser_events.mjs`; its Rust host hook in `agentplug/crates/agentplug-host/src/component.rs`). A long-running `events` capture that holds the lease with its heartbeat and writes JSON lines to a spool file. Feeds row 70.
5. Lane 5, debugger and editor (new files: `browser_debugger.mjs`, `browser_editor.mjs`, `browser_cursor.mjs`; one dispatch line each in `browser_cdp_tools.mjs`, after lane 1). Rows 54 to 62.
6. Lane 6, recorder (new module in `agentplug/crates/agentplug-host/src/`, plus its line in `agentplug/crates/agentplug-host/src/lib.rs`). Rows 63 to 66.
7. Lane 7, verbs and dispatch (file: `rs-plugkit/crates/plugkit-core/src/wasm_dispatch/verbs.rs`, plus the component import in `agentplug/crates/agentplug-host/src/component.rs`). New verbs for rows 2, 13 to 18, 63 to 65. Rebuild with `--features slim` through CI, then witness each verb with `scripts/triage/dispatch-verb.mjs`.
8. Lane 8, MCP surface and docs (files: `gm-mcp/src/mcp-server.js`, `gm-mcp/src/verb-table.js`, `gm-mcp/src/codemode.js`, then `skills/gm/docs/verbs.md`). Resources capability and browser docs (71); live push from lane 4's feed (70); inline screenshot content (31); verb-table rows for lane 7's verbs; bundle rebuild and docs update last.

The first lane to publish is lane 1 or lane 3; lane 4 can start from its own file as soon as its spool format is fixed.

## 6. Notes on this document

- Every row above names a file or verb that exists today, or a new file in an existing directory.
- The reference source was read at `main` through the GitHub contents API. The temp directory used for the download was deleted after reading.
