---
name: browser
description: Browser automation via playwriter. Use when user needs to interact with websites, navigate pages, fill forms, click buttons, take screenshots, extract data, test web apps, or automate any browser task.
allowed-tools: Bash(browser:*), Bash(exec:browser*)
---

# Browser Automation

Two pathways — never mix:

**`exec:browser`** — JS against `page`. `page`, `snapshot`, `screenshotWithAccessibilityLabels`, `state` globals available. 15s live window then backgrounds; drains auto on every subsequent plugkit call.

**`browser:` prefix** — playwriter session management. One command per block.

## Core Usage

```
exec:browser
await page.goto('https://example.com')
await snapshot({ page })
```

```
browser:
playwriter session new --direct
```

```
browser:
playwriter -s 1 -e 'await page.goto("http://example.com")'
```

Session state persists across `browser:` calls. `-e` arg: single quotes outside, double quotes inside JS strings.

## Timing

Never `await setTimeout(N)` with N > 10000. Use poll loops:

```
exec:browser
const start = Date.now()
while (!state.done && Date.now() - start < 12000) {
  await new Promise(r => setTimeout(r, 500))
}
console.log(state.result)
```

"Assertion failed: UV_HANDLE_CLOSING" = backgrounded normally, ignore noise.

## Common Patterns

Data extraction:
```
exec:browser
const items = await page.$$eval('.title', els => els.map(e => e.textContent))
console.log(JSON.stringify(items))
```

Console monitoring — set listeners first, then poll:
```
exec:browser
state.logs = []
page.on('console', msg => state.logs.push({ type: msg.type(), text: msg.text() }))
```

```
exec:browser
console.log(JSON.stringify(state.logs.slice(-20)))
```

## Rules

- One `playwriter` command per `browser:` block
- Never mix pathways in same Bash call
- `exec:browser` = plain JS, no shell quoting
- All browser tasks drain automatically on every plugkit interaction
- Sessions reap after 5-15min idle; browser cleaned up on session end
