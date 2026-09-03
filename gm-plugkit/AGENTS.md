# AGENTS.md

`gm-plugkit` is no longer an npm package or a Node entry point. The launcher
edge is `install.sh`/`install.ps1` at the repo root: a POSIX shell script and
a PowerShell script that download the sha256-verified `agentplug-runner`
binary directly from `AnEntrypoint/agentplug-bin` GitHub Releases, verify it,
and exec it -- zero npm, npx, bun, or node in the critical boot path.
`agentplug-runner` is the sole spool loader and updates its own wasm
autonomously once running; this directory holds only sidecar data it reads.

## Files

- `plugkit.version` / `plugkit.sha256` / `plugkit-slim.wasm.sha256` -- pinned
  version + sha sidecars, always re-verified against the freshly-resolved
  remote release rather than trusted as a standing pin (see gm's own
  `AGENTS.md`, cascade pin-toil design)
- `instructions/` -- prose bundle vendored into `.gm/instructions/` on a
  project

## Runtime state, two separate directories

`~/.gm-tools/` is this package's own launcher-edge install/staging directory
(where the downloaded wasm and the staged `agentplug-runner` executable
land). `~/.agentplug/` is `agentplug-runner`'s own runtime-state directory
(daemon status, logs, plugin content hashes). Check
`~/.agentplug/plugins/gm.version` for what is actually being served -- never
`~/.gm-tools/` -- since the two directories track different things.

## Code style

Same discipline as gm's own `AGENTS.md` (parent repo): no comments unless
the WHY is genuinely non-obvious, no synthetic test files or frameworks,
no decorative Unicode/emoji, no UTF-8 BOM. Verification is a real
`curl -fsSL https://raw.githubusercontent.com/AnEntrypoint/gm/main/install.sh
| sh -s -- spool` invocation against a live project, reading the actual
`.gm/exec-spool/.status.json` it produces -- never a mock.

## Pull requests

No branches or PRs -- every change pushes straight to `main` (gm's own
`AGENTS.md`, direct-push-to-main rule). This directory's files ship inside
the single `gm-skill-<version>.tar.gz` GitHub Release asset that
`publish.yml` uploads from the gm repo root -- there is no separate
`gm-plugkit` package or release.
