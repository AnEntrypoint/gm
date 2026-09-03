# Contributing

gm is maintained by one person. Issues and PRs are welcome; response time varies.

## Filing a good bug report

gm is a witnessed-execution project: a real command and its real output is worth more than a description of expected behavior. If you can, include the exact prompt or spool dispatch sequence that reproduces the problem, not just a summary of what went wrong.

## Sending a PR

PRs are welcome, but every file in this repo follows a few hard rules that a PR will be reshaped to match rather than merged as-is:

- No comments in shipped code. Self-explanatory naming and structure replace them.
- No test files, no test suites (`*.test.*`, `*.spec.*`, `test/`, `__tests__/`). Verification is running the real thing and reading the real output.
- No decorative Unicode or emoji, plain ASCII text only.
- No stub, placeholder, or mock implementation ships -- a scaffold is acceptable only when it genuinely delegates to real behavior.

The full discipline gm runs under is in [AGENTS.md](AGENTS.md).

## Where things live

- `skills/gm/SKILL.md` -- the shipped skill
- `bin/` -- installer
- `gm-plugkit/` -- the wasm-wrapper daemon launcher
- `rs-plugkit/`, `agentplug/`, and four more submodules -- the orchestrator and native host (see [README.md](README.md#developing-gm-itself))

## Questions

[Discord](https://discord.com/invite/c9VV59MKNr) or open an issue.
