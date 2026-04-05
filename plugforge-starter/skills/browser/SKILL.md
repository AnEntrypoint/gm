---
name: browser
description: Browser automation via playwriter. Use when user needs to interact with websites, navigate pages, fill forms, click buttons, take screenshots, extract data, test web apps, or automate any browser task.
allowed-tools: Bash(browser:*), Bash(exec:browser*)
---

# Browser Automation with playwriter

## Two Pathways

**Session management** — use `browser:` prefix via Bash for session lifecycle only.

Create a session first:

```
browser:
playwriter session new --direct
```

Returns a numeric session ID (e.g. `1`). Use that ID for all subsequent `exec:browser` calls.

If `--direct` fails, the user needs Chrome running with debugging enabled:
- Open `chrome://inspect/#remote-debugging` in Chrome, OR
- Launch Chrome with `chrome --remote-debugging-port=9222`

List active sessions:

```
browser:
playwriter session list
```

**JS eval** — use `exec:browser` via Bash for ALL JavaScript execution. Never use `playwriter -s <id> -e '...'` for JS code — single-quote quoting fails on Windows CMD. The exec runner writes code to a temp file, avoiding all shell quoting issues.

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

State persists across `exec:browser` calls within a session. Never add shell quoting or escaping to the exec body — write plain JavaScript directly.

## Core Workflow

Every browser automation follows this pattern:

1. **Create session**: `browser:\nplaywriter session new --direct` (note the returned ID)
2. **All JS code**: use `exec:browser` with plain JS body — navigate, interact, snapshot, extract

```
browser:
playwriter session new --direct
```

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

### Navigation and Snapshot

```
exec:browser
await page.goto('https://example.com')
await snapshot({ page })
```

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
state.loginDone = false
await page.goto('https://app.example.com/login')
await page.fill('[name=user]', 'admin')
await page.fill('[name=pass]', 'secret')
await page.click('[type=submit]')
state.loginDone = true
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

## Key Patterns for Agents

**Always use `exec:browser`** for any JavaScript — never `playwriter -s <id> -e '...'` for JS code.

**`browser:` prefix** is only for session management: `playwriter session new`, `playwriter session list`.

**Session IDs are numeric**: `playwriter session new` returns `1`, `2`, etc. Use the exact returned value.

**Snapshot before interacting**: always call `await snapshot({ page })` to understand current page state before clicking or filling.
