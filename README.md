# gm

Convention-driven AI plugin generator. One source, one published artifact: the `gm-skill` universal harness.

**Hub page:** https://AnEntrypoint.github.io/gm

## Metrics

[![GitHub stars](https://img.shields.io/github/stars/AnEntrypoint/gm?style=flat&logo=github&color=f1c40f)](https://github.com/AnEntrypoint/gm/stargazers)
[![npm downloads (gm-skill)](https://img.shields.io/npm/dm/gm-skill?label=gm-skill%20downloads%2Fmonth&color=cb3837&logo=npm)](https://www.npmjs.com/package/gm-skill)
[![Commits per week](docs/badges/commits-per-week.svg)](docs/badges/commits-per-week.svg)
[![Open Issues](docs/badges/open-issues.svg)](docs/badges/open-issues.svg)
[![Contributors](docs/badges/contributors.svg)](docs/badges/contributors.svg)
[![Avg PR Merge Time](docs/badges/pr-merge-time.svg)](docs/badges/pr-merge-time.svg)

## Install

```
bun x skills add AnEntrypoint/gm-skill -y -g
```

Then add this line to your agent's global memory / system prompt:

```
always use the gm-skill skill for everything, always fan out subagents
```

Plugkit serves all phase instructions, state, mutables, and guardrails on demand via the spool.

## Recommended Claude Code settings

gm runs best with extended thinking off and the autocompact threshold raised so the orchestrator can keep PRD/mutables state in-context longer. Drop this into your `~/.claude/settings.json`:

```json
{
  "env": {
    "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE": "62"
  },
  "alwaysThinkingEnabled": false,
  "effortLevel": "low"
}
```

- `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: "62"` — defers autocompaction until 62% of the context window, so the PRD, mutables, and recall stay live longer.
- `alwaysThinkingEnabled: false` — plugkit already drives deliberation through PLAN→EXECUTE→EMIT→VERIFY; extended thinking duplicates that work.
- `effortLevel: "low"` — the state machine, not the model, is the reasoning surface. Low effort + spool dispatch is the intended operating point.

## Architecture

`gm-starter/skills/gm-skill/SKILL.md` is the single ~12-line entry point. All orchestration logic lives in `rs-plugkit/src/orchestrator/`. See [AGENTS.md](AGENTS.md) for the full design.

The previous 15-platform fanout (gm-cc, gm-gc, gm-oc, gm-codex, gm-kilo, gm-qwen, gm-hermes, gm-thebird, gm-vscode, gm-cursor, gm-zed, gm-jetbrains, gm-copilot-cli, gm-antigravity, gm-windsurf) has been retired; those downstream repositories are archived on GitHub.
