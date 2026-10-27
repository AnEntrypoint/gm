# Contributing

gm maintained by one person. Issues and PRs welcome; response time vary.

## Filing a good bug report

gm is witnessed-execution project: real command and real output worth more than description of expected behavior. If you can, include exact prompt or spool dispatch sequence that reproduces problem, not just summary of what went wrong.

## Sending a PR

PRs welcome, but every file in repo follow few hard rules. PR will be reshaped to match, not merged as-is:

- No comments in shipped code. Self-explanatory naming and structure replace them.
- No new test files or test suites in PR (`*.test.*`, `*.spec.*`, `test/`, `__tests__/`); `gm-mcp/` ships no test tree to extend. Verification = run real thing, read real output.
- No decorative Unicode or emoji, plain ASCII only.
- No stub, placeholder, or mock implementation ships -- scaffold ok only when it genuinely delegates to real behavior.

Full discipline gm runs under in [AGENTS.md](AGENTS.md).

## Where things live

- `skills/gm/SKILL.md` -- shipped skill
- `bin/` -- installer
- `gm-plugkit/` -- wasm-wrapper daemon launcher
- `rs-plugkit/`, `agentplug/`, and four more submodules -- orchestrator and native host (see [README.md](README.md#developing-gm-itself))

## Questions

[Discord](https://discord.com/invite/c9VV59MKNr) or open issue.