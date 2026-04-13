---
name: browser
description: Browser automation via playwriter. Use when user needs to interact with websites, navigate pages, fill forms, click buttons, take screenshots, extract data, test web apps, or automate any browser task.
allowed-tools: Bash(browser:*), Bash(exec:browser*)
---

# Browser Automation with playwriter

**Use gm subagents for all independent work items. Invoke all skills in the chain: planning → gm-execute → gm-emit → gm-complete → update-docs.**

## Installation & Setup

Browser automation requires:
- **Claude Code** — web app, CLI, or desktop (not IDE extensions yet)
- **Bun** — fast package runner (`curl -fsSL https://bun.sh/install | bash`)
- **Browser plugin** — installed in Claude Code

### Step 1: Install Browser Plugin in Claude Code

**Web app (claude.ai/code)**: Settings → Plugins → Marketplace → Search "browser" → Install → Activate

**CLI**: `claude plugin install browser`

**Desktop**: Settings → Extensions → Browser

### Step 2: Verify Installation

```
exec:browser
await page.goto('https://example.com')
console.log('✓ Browser plugin is ready')
```

If you get "Failed to run downloader" error, the browser plugin is not installed. Retry Step 1.

### Step 3: Optional — Install Playwriter Locally

For advanced session management (multi-step workflows, persistent state):

```bash
bun add -g playwriter
```

Then use `browser:` prefix commands.

## Troubleshooting

| Error | Cause | Solution |
|-------|-------|----------|
| `Failed to run downloader` | Browser plugin not installed | Install via plugin marketplace |
| `No such file or directory` | Missing bun | `curl -fsSL https://bun.sh/install \| bash` |
| `ECONNREFUSED` | Browser engine not running | Restart Claude Code |
| `timeout` | Page load too slow | Add retry loop (see patterns.md) |
| `Cannot find playwriter` | playwriter not installed | `bun add -g playwriter` (optional) |

## Platform-Specific Notes

**macOS**: If playwriter installation fails, use Homebrew: `brew install playwright`

**Windows**: Use PowerShell (not cmd). Ensure bun.exe is in PATH.

**Linux**: Most distros work out-of-the-box. Check Claude Code version is up-to-date if browser plugin fails to load.

## Quick Start

Once installed, browser automation is ready:

```
exec:browser
await page.goto('https://example.com')
const title = await page.title()
console.log('✓ Page loaded:', title)
```

## Two Pathways

**Session commands** (`browser:` prefix) — manage multi-step sessions via playwriter CLI. Each `browser:` block runs one command sequentially.

**JS execution** (`exec:browser`) — run JavaScript directly against `page`. State persists across calls via `state` global.

**CRITICAL**: Never mix these two pathways in the same Bash call.

## Key Rules

- `browser:` prefix → playwriter session management (one command per block)
- `exec:browser` → JS in page context (15s live window, then backgrounds)
- Never mix pathways in the same Bash call
- `-e` argument: single quotes outside, double quotes inside
- Never `await setTimeout(N)` with N > 10000 — use short poll loops
- All running browser tasks drain automatically on plugkit interactions

## Advanced Patterns

See **patterns.md** for detailed examples:
- Long-running operations & poll patterns
- Data extraction
- Console monitoring
- Worker inspection
- State inspection
- Element wait loops
