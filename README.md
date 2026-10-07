# gm: practical defaults for everyday coding

This SolutionsAsService fork of [AnEntrypoint/gm](https://github.com/AnEntrypoint/gm) keeps the useful discipline: scoped work, preserved user changes, real verification and honest delivery. It removes mandatory scope expansion, recursive confirmation walks and runtime setup from ordinary tasks.

**The default is a lightweight Agent Skill, not a daemon or an enforced state machine.** It uses the tools your host already provides. It does not promise guaranteed model behavior or a measured speedup.

## Install the fork

Requires Node.js 20 or newer. From the project where you want the skill:

	npx github:SolutionsAsService/gm

The command installs the bundled `gm` and `gm-continue` skill directories into `.agents/skills`. It does not register MCP, start a runner, change global agent instructions or fetch upstream skill text. npx itself may use the network to acquire this package; after acquisition, the default installer copies local files only.

Preview without changes:

	npx github:SolutionsAsService/gm --dry-run

For a host using a different skill location, choose the parent skill directory explicitly, for example:

	npx github:SolutionsAsService/gm --target .claude/skills

Use `--global` for `~/.agents/skills`. Check your host's supported discovery paths; the installer does not claim that every host discovers every directory. A clone also works without submodules:

	git clone https://github.com/SolutionsAsService/gm.git
	node /path/to/gm/bin/gm-install.js --target /path/to/project/.agents/skills

The local `install.sh` and `install.ps1` wrappers use the same default Node entrypoint. Run a local checkout/package rather than piping a remote shell script. Keep the root [MIT license](LICENSE) and bundled license files with redistributed skills.

## What changes for users

| Before in this fork's inherited baseline | New default |
| --- | --- |
| Every task treated as long-horizon, exhaustive research | A bounded outcome and relevant checks |
| Adjacent work becomes implicit scope | Separate suggestions; no automatic scope growth |
| Mandatory second gm walk even when nothing remains | Report and stop on the first complete pass |
| Closed/deferred PRD rows repeatedly reopen work | Only actionable, unresolved in-scope items resume |
| Repeated reads and instruction refreshes | Checkpoint reuse and a no-progress inspection limit |
| Missing spool output treated as running | Explicit running/completed/failed/unknown states |
| No tests; existing tests ordered removed | Preserve tests, use regressions plus real entrypoint checks |
| Every tool routed through an installed runtime | Existing authorized host tools by default |
| Forced push or a clean whole worktree | Publish only when authorized; preserve unrelated dirt |
| Installation replaces fork skill with upstream copy | Install the bundled fork content |

The canonical workflow is [skills/gm/SKILL.md](skills/gm/SKILL.md). [gm-continue](skills/gm-continue/SKILL.md) is an optional resume/check skill, not a mandatory callback. Other inherited skills and submodules remain in the source tree but are not part of default installation.

## Optional upstream runtime

`--with-runtime` explicitly enables the legacy runner/MCP setup. `--mcp-only` explicitly requests MCP repair. These are advanced networked operations that can write host registrations and start upstream components; they are not necessary for the skill. Read [runtime compatibility and migration](skills/gm/references/runtime.md) first.

The runtime still comes from the upstream agentplug/gm-mcp ecosystem. Its remote configuration, update behavior, gates and plugins are **not fixed by this skill rewrite**. Do not assume changing a SKILL.md disables existing hooks or an already-running server. Old global instructions such as mandatory gm use/fan-out, existing MCP registrations and project gates need separate operator review; this installer does not silently remove them. Runtime-required projects may be blocked by incompatible policy rather than transparently switching modes.

## Develop and verify

	 npm test

This runs lightweight contract checks and the actual installer in isolated temporary directories, without installing a daemon or contacting services. The checks validate installation behavior and prevent known instruction regressions; they are not a cross-model behavioral benchmark. Add focused regression tests for code changes and exercise their real entrypoints. Initialize submodules only when changing those components; no Rust/WASM build is required for skill or lightweight installer edits.

The [audit](docs/DEFAULT-WORKFLOW-AUDIT.md) records baseline evidence, fixed failure modes, regression scenarios and limits. Historical runtime/site documents describe the inherited upstream system; they do not override the default workflow.

## Release and publication

Pushes and pull requests run lightweight verification. Skill releases are an explicit manual workflow, use the current repository and current package version, and do not push version-bump commits. Website deployment is also manual. A successful source push is not a release, site deployment or upstream runtime update. No npm publication is performed.

## License and credit

Original gm: copyright (c) 2026 AnEntrypoint, [MIT](LICENSE). Fork workflow/adaptation credit: **Pimp My Skill · SolutionsAsService · https://github.com/SolutionsAsService**. Original copyright and authorship remain intact; this credit does not imply upstream endorsement.
