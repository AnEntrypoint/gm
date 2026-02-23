# glootius maximus (gm)

gm is a claude code plugin that delivers an opinionated programming state machine through system prompt policy, code execution tooling, semantic code search, and hook-based workflow enforcement. it was built over ~200 commits of daily use and testing. it is free, open source, and maintained by one person.

disclaimer: this is extremely opinionated. it will block bash, redirect your tools, refuse to write test files, and force you to push git before ending a session. if that sounds terrible, this is not for you. if that sounds like what you wish your agent did automatically, keep reading.

## install

```
claude plugin marketplace add AnEntrypoint/gm
claude plugin install -s user gm@gm
```

update:
```
claude plugin marketplace update gm
claude plugin update gm@gm
```

or set up an alias so you stop forgetting:
```bash
mkdir -p ~/.local/bin && echo -e '#!/bin/sh\nclaude plugin marketplace update gm' > ~/.local/bin/gmupdate && chmod +x ~/.local/bin/gmupdate && echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc && source ~/.bashrc
```

it should just work. if you want to make sure the subagent always engages, add "gm everything" to your prompt. the gm agent is injected at session start and reinforced on every prompt submit, but explicitly calling it does help.

**note:** all tools use bunx for fast startup and automatic npm caching. mcp-thorns, codebasesearch, and mcp-gm all run via bunx with @latest versions. you need bun installed: `curl -fsSL https://bun.sh/install | bash`

## what it does

### gm agent

the core. a system prompt delivered as a state machine, organized into 7 charters:

1. **prd** - task planning with .prd file enforcement. every task gets a dependency graph with parallel execution waves. the stop hook blocks session end when .prd items remain. this is the single biggest behavior change - the agent cannot declare "done" and walk away with work remaining.

2. **execution environment** - all code runs through plugin:gm:dev, not bash. every hypothesis proven by execution before changing files. tool redirects enforce this: bash is blocked, find is blocked, grep is blocked. everything goes through dev execute or code-search.

3. **ground truth** - no mocks, no fakes, no unit tests, no test files on disk. real services, real api responses only. when the agent discovers mocks in your codebase it will delete them and implement real paths. this is the most controversial charter.

4. **system architecture** - hot reload, crash-proof, recovery hierarchies, async containment, debug hooks. every system the agent builds must survive forever by design.

5. **code quality** - 200 line file limit, no comments in code, no duplication, convention over code, buildless, dynamic systems, preemptive modularity.

6. **gate conditions** - quality gate before any file modification. all conditions must pass simultaneously: executed, tested, witnessed, hot reloadable, crash-proof, no mocks, under 200 lines, no hardcoded values.

7. **completion verification** - witnessed execution is the only proof. not marker files, not documentation updates, not saying "done." the agent must execute the system end to end and observe actual behavior.

the charter system was rewritten on feb 12 using concepts from WFGY research - 33 flat sections reorganized into 7 scoped charters with a constraints block. 44% token savings while preserving all 82 behavioral concepts.

### tools

**dev** (mcp-gm) - code execution in any language from a temp file. replaces bash and edit-run-read loops. 30 second auto handoff to background process control with live notifications. this is where all code actually runs.

**code-search** (codebasesearch) - dependency-free semantic vector search. describe intent in plain language, not regex syntax. "find authentication validation" locates auth checks, guards, permission logic - however they're implemented.

**thorns** (mcp-thorns) - one-shot AST analysis at conversation start. compact codebase overview: structure, flow, orphans, hubs, repetitions. eliminates the first 5-10 turns of manual exploration.

### hooks

**session-start** - injects gm agent context, runs thorns AST analysis, adds code-search documentation. sets up the entire session.

**prompt-submit** - reminds the agent to use gm subagent for everything. reinforcement on every turn.

**pre-tool-use** - blocks bash, find, grep, glob in favor of plugin:gm:dev and code-search. blocks .md file creation (except CLAUDE.md and README). blocks test file creation (.test.js, .spec.ts, __tests__/, fixtures/, mocks/).

**stop (.prd)** - checks .prd file. if items remain, blocks session end. this is the looping mechanism - more refined than wiggum looping, includes native planning behaviors with better tooling preferences and a revision loop.

**stop (git)** - checks for uncommitted changes and unpushed commits. blocks session end until everything is pushed. make sure you have a git remote set up.

### browser access

for client-side coding and browser automation, the recommended approach is playwriter:
https://github.com/remorses/playwriter

note: playwriter uses a browser plugin - grab and activate that too to get browser access. gm references plugin:browser:execute throughout the charter system for this integration.

## plugforge

this plugin is built by plugforge, a build system that generates 9 platform implementations from a single source directory:

- 5 CLI platforms: claude code, gemini cli, opencode, codex, github copilot cli
- 4 IDE extensions: vs code, cursor, zed, jetbrains

one source in plugforge-starter/ (gm.json, agents/, hooks/) propagates to all 9 outputs. adding a hook or changing the agent automatically appears everywhere. github actions handles publishing to all 9 repos on every commit.

repo: https://github.com/AnEntrypoint/plugforge

## what doesn't work yet

- hot reload is architecture-ready but not fully implemented in the plugin itself
- the ground truth charter is aggressive and will delete your test suites if you're not expecting it
- thorns can timeout on very large codebases
- the gemini and opencode adapters are functional but less battle-tested than claude code
- ide extensions (vscode, cursor, zed, jetbrains) don't have hooks yet - only cli platforms do

<img width="225" height="325" alt="image" src="https://github.com/user-attachments/assets/866e6861-a2e2-490d-8bd0-ec558753dbed" />

https://www.youtube.com/clip/UgkxMczBOi4uGHRFOb4J-R28kELLfWnzSN7R

## license

MIT
