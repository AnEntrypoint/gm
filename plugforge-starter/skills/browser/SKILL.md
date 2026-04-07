---
name: browser
description: Browser automation via playwriter. Use when user needs to interact with websites, navigate pages, fill forms, click buttons, take screenshots, extract data, test web apps, or automate any browser task.
allowed-tools: Bash(browser:*), Bash(exec:browser*)
---

# Browser Automation with playwriter

## Two Pathways

**Session commands** (`browser:` prefix) — manage multi-step sessions via playwriter CLI. Each `browser:` block runs its commands sequentially.

**JS execution** (`exec:browser`) — run JavaScript directly against `page`. State persists across calls via `state` global.

**CRITICAL**: Never mix these two pathways. Each `browser:` block is a separate Bash call. Each `exec:browser` block is a separate Bash call.

## 15-Second Ceiling — How It Works

Every `exec:browser` call has a 15s live window. During that window, all stdout/stderr is streamed to you in real time. After 15s the task backgrounds and you receive:
- All output produced so far (live drain)
- A task ID with `plugkit sleep/status/close` instructions

**The task keeps running.** Every subsequent plugkit interaction automatically drains all running browser tasks — you will see new output without asking.

**Never use `await new Promise(r => setTimeout(r, N))` with N > 10000.** Use short poll loops instead (see patterns below).

**"Assertion failed: UV_HANDLE_CLOSING" in output** means the call exceeded 15s and was cut off — ignore the assertion noise, look at the output before it. The task was backgrounded normally.

## Session Pathway (`browser:`)

Create a session first, use `--direct` for CDP mode (requires Chrome with remote debugging):

```
browser:
playwriter session new --direct
```

Returns a numeric session ID (e.g. `1`). Use that ID for all subsequent calls. **Each command must be a separate Bash call:**

```
browser:
playwriter -s 1 -e 'await page.goto("http://example.com")'
```

```
browser:
playwriter -s 1 -e 'await snapshot({ page })'
```

```
browser:
playwriter -s 1 -e 'await screenshotWithAccessibilityLabels({ page })'
```

State persists across session calls:

```
browser:
playwriter -s 1 -e 'state.x = 1'
```

```
browser:
playwriter -s 1 -e 'console.log(state.x)'
```

List active sessions:

```
browser:
playwriter session list
```

**RULE**: The `-e` argument must use single quotes. The JS inside must use double quotes for strings.

**RULE**: Never chain multiple `playwriter` commands in one `browser:` block — run one command per block.

## JS Execution Pathway (`exec:browser`)

For direct page access, DOM queries, and data extraction. The runtime provides `page`, `snapshot`, `screenshotWithAccessibilityLabels`, and `state` as globals.

```
exec:browser
await page.goto('https://example.com')
await snapshot({ page })
```

```
exec:browser
const title = await page.title()
console.log(title)
```

Never add shell quoting — write plain JavaScript directly.

## Core Workflow

1. **Navigate**: `exec:browser\nawait page.goto('url')` — session auto-created on first call
2. **Snapshot**: `exec:browser\nawait snapshot({ page })`
3. **Interact**: click, fill, type in subsequent `exec:browser` calls
4. **Extract data**: `exec:browser\nconsole.log(await page.evaluate(() => document.title))`

## Long-Running Operations — Poll Pattern

For operations that take >10s (model loading, network fetches, animations):

**Step 1** — set up listener and kick off the operation:
```
exec:browser
state.done = false
state.result = null
page.on('console', msg => {
  const t = msg.text()
  if (t.includes('loaded') || t.includes('ready')) { state.done = true; state.result = t }
})
await page.click('#start-button')
console.log('started, waiting...')
```

**Step 2** — poll in short bursts (this will background after 15s and keep draining):
```
exec:browser
const start = Date.now()
while (!state.done && Date.now() - start < 12000) {
  await new Promise(r => setTimeout(r, 500))
}
console.log('done:', state.done, 'result:', state.result)
```

If step 2 backgrounds (takes >15s), every subsequent plugkit call will drain its output automatically. When you see the result in the drain log, close the task:
```
exec:close
task_N
```

## Common Patterns

### Navigate and check current URL/status

```
exec:browser
await page.goto('https://example.com')
console.log('URL:', page.url())
console.log('title:', await page.title())
```

### Screenshot

```
browser:
playwriter -s 1 -e 'await screenshotWithAccessibilityLabels({ page })'
```

### Data Extraction

```
exec:browser
const items = await page.$$eval('.product-title', els => els.map(e => e.textContent))
console.log(JSON.stringify(items))
```

### Fetch bypassing browser cache

`fetch()` inside `page.evaluate()` hits the browser cache — use `cache: 'no-store'` to get fresh content:

```
exec:browser
const text = await page.evaluate(async () => {
  const r = await fetch('./app.js', { cache: 'no-store' })
  return await r.text()
})
console.log('Has feature:', text.includes('myFunction'))
```

### Console Monitoring — set up listener first, then poll

```
exec:browser
state.logs = []
state.errors = []
page.on('console', msg => state.logs.push({ type: msg.type(), text: msg.text() }))
page.on('pageerror', e => state.errors.push(e.message))
console.log('listeners attached')
```

```
exec:browser
console.log('logs so far:', JSON.stringify(state.logs.slice(-20)))
console.log('errors:', JSON.stringify(state.errors))
```

### Web Worker Access

```
exec:browser
const workers = page.workers()
console.log('Workers:', workers.length, workers.map(w => w.url()).join(', '))
```

```
exec:browser
if (page.workers().length > 0) {
  const r = await page.workers()[0].evaluate(() => JSON.stringify({ type: 'worker alive' }))
  console.log(r)
}
```

### Access window globals

```
exec:browser
const result = await page.evaluate(() => JSON.stringify({
  entityCount: window.debug?.scene?.children?.length,
  playerId: window.debug?.client?.playerId
}))
console.log(result)
```

### Wait for element with short poll

```
exec:browser
const start = Date.now()
while (Date.now() - start < 12000) {
  const el = await page.$('#status')
  if (el) { console.log('found:', await el.textContent()); break }
  await new Promise(r => setTimeout(r, 300))
}
```

## Key Rules

- `browser:` prefix → playwriter session management (one command per block)
- `exec:browser` → JS in page context (multi-line JS allowed, 15s live window)
- Never mix pathways in the same Bash call
- `-e` argument: single quotes on outside, double quotes inside for JS strings
- One `playwriter` command per `browser:` block
- Never `await setTimeout(N)` with N > 10000 — use short poll loops instead
- All running browser tasks drain automatically on every plugkit interaction
