# Browser Automation Patterns

Advanced examples and detailed workflows for browser automation.

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

### Data Extraction

```
exec:browser
const items = await page.$$eval('.product-title', els => els.map(e => e.textContent))
console.log(JSON.stringify(items))
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

### Worker Inspection

```
exec:browser
if (page.workers().length > 0) {
  const r = await page.workers()[0].evaluate(() => JSON.stringify({ type: 'worker alive' }))
  console.log(r)
}
```

### State Inspection

```
exec:browser
const result = await page.evaluate(() => JSON.stringify({
  entityCount: window.debug?.scene?.children?.length,
  playerId: window.debug?.client?.playerId
}))
console.log(result)
```

### Element Wait Loop

```
exec:browser
const start = Date.now()
while (Date.now() - start < 12000) {
  const el = await page.$('#status')
  if (el) { console.log('found:', await el.textContent()); break }
  await new Promise(r => setTimeout(r, 300))
}
```
