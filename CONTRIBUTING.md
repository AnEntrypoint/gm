# Contributing

This fork improves the default workflow and installation experience. Keep changes scoped and distinguish prompt guidance, installer behavior and optional upstream runtime code.

## Filing a good bug report

gm is a witnessed-execution project: a real command and its real output is worth more than a description of expected behavior. If you can, include the exact prompt or spool dispatch sequence that reproduces the problem, not just a summary of what went wrong.

## Sending a PR

PRs are welcome, but every file in this repo follows a few hard rules that a PR will be reshaped to match rather than merged as-is:

- Keep code clear; add concise comments where an invariant cannot be expressed by names alone.
- Preserve and add focused regression tests. Run `npm test` and exercise changed real entrypoints. Label mocked checks honestly; they do not prove a live integration.
- Keep source text UTF-8 and retain original licenses and attribution.
- No stub, placeholder, or mock implementation ships -- a scaffold is acceptable only when it genuinely delegates to real behavior.

The full discipline gm runs under is in [AGENTS.md](AGENTS.md).

## Where things live

- `skills/gm/SKILL.md` -- the shipped skill
- `bin/` -- installer
- `gm-plugkit/` -- inherited optional runtime pins and prose
- `rs-plugkit/`, `agentplug/`, and four more submodules -- the orchestrator and native host (see [README.md](README.md#develop-and-verify))

## Questions

[Discord](https://discord.com/invite/c9VV59MKNr) or open an issue.
