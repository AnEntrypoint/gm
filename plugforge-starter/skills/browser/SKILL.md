---
name: browser
description: Browser automation via playwriter. Use when user needs to interact with websites, navigate pages, fill forms, click buttons, take screenshots, extract data, test web apps, or automate any browser task.
allowed-tools: Bash(browser:*), Bash(exec:browser*)
---

# Browser Automation with playwriter

## Two Pathways

**Session commands** (`browser:` prefix) — manage multi-step sessions via playwriter CLI. Each `browser:` block runs its commands sequentially.

**JS execution** (`exec:browser`) — run JavaScript directly against `page`. State persists across calls.

**CRITICAL**: Never mix these two pathways. Each `browser:` block is a separate Bash call. Each `exec:browser` block is a separate Bash call.

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

1. **Create session**: `browser:\nplaywriter session new --direct`
2. **Navigate** (one call per command): `browser:\nplaywriter -s 1 -e 'await page.goto("url")'`
3. **Snapshot**: `browser:\nplaywriter -s 1 -e 'await snapshot({ page })'`
4. **Interact**: click, fill, type — each as a separate browser: call
5. **Extract data**: use `exec:browser` for JS queries

## Common Patterns

### Screenshot

```
browser:
playwriter -s 1 -e 'await screenshotWithAccessibilityLabels({ page })'
```

### Data Extraction (use exec:browser)

```
exec:browser
const items = await page.$$eval('.product-title', els => els.map(e => e.textContent))
console.log(JSON.stringify(items))
```

### Console Monitoring (exec:browser)

```
exec:browser
state.consoleMsgs = []
page.on('console', msg => state.consoleMsgs.push({ type: msg.type(), text: msg.text() }))
page.on('pageerror', e => state.consoleMsgs.push({ type: 'error', text: e.message }))
```

```
exec:browser
console.log(JSON.stringify(state.consoleMsgs))
```

### Web Worker Console Monitoring

```
exec:browser
state.workerMsgs = []
for (const w of page.workers()) {
  w.evaluate(() => {
    const o = console.log.bind(console)
    console.log = (...a) => { o(...a) }
  }).catch(() => {})
}
page.on('worker', w => {
  state.workerMsgs.push('[worker] ' + w.url())
})
```

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

### Access window.debug globals

```
exec:browser
const result = await page.evaluate(() => JSON.stringify({
  entityCount: window.debug?.scene?.children?.length,
  playerId: window.debug?.client?.playerId
}))
console.log(result)
```

## Key Rules

- `browser:` prefix → playwriter session management (one command per block)
- `exec:browser` → JS in page context (multi-line JS allowed)
- Never mix pathways in the same Bash call
- `-e` argument: single quotes on outside, double quotes inside for JS strings
- One `playwriter` command per `browser:` block
