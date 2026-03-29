---
name: browser
description: Browser automation via playwriter. Use when user needs to interact with websites, navigate pages, fill forms, click buttons, take screenshots, extract data, test web apps, or automate any browser task.
allowed-tools: Bash(browser:*), Bash(exec:browser*)
---

# Browser Automation with playwriter

## Two Pathways

**Session commands** — use `browser:` prefix via Bash for all browser control.

Create a session first, then run commands against it:

```
browser:
playwriter session new
```

Returns a numeric session ID (e.g. `1`). Use that ID for all subsequent commands.

```
browser:
playwriter -s 1 -e 'await page.goto("https://example.com")'
```

```
browser:
playwriter -s 1 -e 'await snapshot({ page })'
```

```
browser:
playwriter -s 1 -e 'await screenshotWithAccessibilityLabels({ page })'
```

State persists across calls within a session:

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

**JS eval in browser** — use `exec:browser` via Bash when you need to run JavaScript in the page context directly.

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

Always use single quotes for the `-e` argument to avoid shell quoting issues.

## Core Workflow

Every browser automation follows this pattern:

1. **Create session**: `playwriter session new` (note the returned ID)
2. **Navigate**: `playwriter -s <id> -e 'await page.goto("https://example.com")'`
3. **Snapshot**: `playwriter -s <id> -e 'await snapshot({ page })'`
4. **Interact**: click, fill, type via JS expressions
5. **Re-snapshot**: after navigation or DOM changes

```
browser:
playwriter session new
playwriter -s 1 -e 'await page.goto("https://example.com/form")'
playwriter -s 1 -e 'await snapshot({ page })'
playwriter -s 1 -e 'await page.fill("[name=email]", "user@example.com")'
playwriter -s 1 -e 'await page.click("[type=submit]")'
playwriter -s 1 -e 'await page.waitForLoadState("networkidle")'
playwriter -s 1 -e 'await snapshot({ page })'
```

## Common Patterns

### Navigation and Snapshot

```
browser:
playwriter session new
playwriter -s 1 -e 'await page.goto("https://example.com")'
playwriter -s 1 -e 'await snapshot({ page })'
```

### Screenshot with Accessibility Labels

```
browser:
playwriter -s 1 -e 'await screenshotWithAccessibilityLabels({ page })'
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
browser:
playwriter -s 1 -e 'state.loginDone = false'
playwriter -s 1 -e 'await page.goto("https://app.example.com/login")'
playwriter -s 1 -e 'await page.fill("[name=user]", "admin")'
playwriter -s 1 -e 'await page.fill("[name=pass]", "secret")'
playwriter -s 1 -e 'await page.click("[type=submit]")'
playwriter -s 1 -e 'state.loginDone = true'
```

### Multiple Sessions

```
browser:
playwriter session new
playwriter session new
playwriter -s 1 -e 'await page.goto("https://site-a.com")'
playwriter -s 2 -e 'await page.goto("https://site-b.com")'
playwriter session list
```

## JavaScript Evaluation (exec pathway)

Use `exec:browser` via Bash when you need direct page access. The body is plain JavaScript executed in the browser context.

```
exec:browser
await page.goto('https://example.com')
await snapshot({ page })
```

```
exec:browser
const links = await page.$$eval('a', els => els.map(e => e.href))
console.log(JSON.stringify(links))
```

Never add shell quoting or escaping to the exec body — write plain JavaScript directly.

## Key Patterns for Agents

**Which pathway to use**:
- Multi-step session workflows → `browser:` prefix with `playwriter -s <id> -e '...'`
- Quick JS eval or data extraction → `exec:browser` with plain JS body

**Always use single quotes** for the `-e` argument to playwriter to avoid shell interpretation.

**Session IDs are numeric**: `playwriter session new` returns `1`, `2`, etc. Use the exact returned value.

**Snapshot before interacting**: always call `await snapshot({ page })` to understand current page state before clicking or filling.
