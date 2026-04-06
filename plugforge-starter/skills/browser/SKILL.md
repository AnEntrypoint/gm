---
name: browser
description: Browser automation. Use when user needs to interact with websites, navigate pages, fill forms, click buttons, take screenshots, extract data, test web apps, or automate any browser task.
allowed-tools: Bash(exec:browser*)
---

# Browser Automation

Use `exec:browser` via Bash for all browser automation. The runtime provides `page`, `snapshot`, `screenshotWithAccessibilityLabels`, and `state` as globals. Sessions persist across calls automatically.

```
exec:browser
await page.goto('https://example.com')
await snapshot({ page })
```

## Core Workflow

Navigate, snapshot to understand the page, then interact:

```
exec:browser
await page.goto('https://example.com/form')
await snapshot({ page })
await page.fill('[name=email]', 'user@example.com')
await page.click('[type=submit]')
await page.waitForLoadState('networkidle')
await snapshot({ page })
```

## Common Patterns

### Screenshot with Accessibility Labels

```
exec:browser
await screenshotWithAccessibilityLabels({ page })
```

### Data Extraction

```
exec:browser
await page.goto('https://example.com/products')
const items = await page.$$eval('.product-title', els => els.map(e => e.textContent))
console.log(JSON.stringify(items))
```

### Persistent State Across Steps

```
exec:browser
state.count = 0
await page.goto('https://example.com')
state.title = await page.title()
```

```
exec:browser
console.log(state.title, state.count)
```

### Console Monitoring

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

Capture console output from Dedicated Web Workers (e.g. game server workers):

```
exec:browser
state.workerMsgs = []
// Capture from already-spawned workers
for (const w of page.workers()) {
  w.evaluate(() => {
    const orig = console.log.bind(console)
    console.log = (...a) => { orig(...a); self.postMessage({ __log: a.map(String).join(' ') }) }
  }).catch(() => {})
}
// Capture from workers spawned after this point
page.on('worker', w => {
  state.workerMsgs.push('[worker attached] ' + w.url())
  w.evaluate(() => {
    const orig = console.log.bind(console)
    console.log = (...a) => { orig(...a); self.postMessage({ __log: a.map(String).join(' ') }) }
  }).catch(() => {})
})
```

```
exec:browser
// List all active workers and their URLs
const workers = page.workers()
console.log('Workers:', workers.length, workers.map(w => w.url()).join(', '))
```

```
exec:browser
// Evaluate JS inside the first worker
const result = await page.workers()[0].evaluate(() => typeof self.someGlobal)
console.log(result)
```

### Inject Global Debug State into Page

```
exec:browser
const result = await page.evaluate(() => {
  // Access app globals exposed on window
  return JSON.stringify({
    entityCount: window.debug?.scene?.children?.length,
    playerId: window.debug?.client?.playerId
  })
})
console.log(result)
```

## Key Rules

**Only `exec:browser`** — never run any browser CLI tool directly via Bash.

**Snapshot before interacting** — always call `await snapshot({ page })` to understand current page state before clicking or filling.

**State persists** — `state` object and page session carry across multiple `exec:browser` calls.
