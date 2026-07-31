# AGENTS.md

`gm-plugkit` is the thin launcher-edge npm package (`npx gm-plugkit@latest spool` /
`bun x gm-plugkit@latest spool`). It downloads the sha256-verified
`plugkit.wasm`/`plugkit-slim.wasm` for the host platform, then re-execs into
the staged `agentplug-runner` native binary at `~/.gm-tools/agentplug-runner`
(`cli.js::tryDelegateToRunner`) and exits -- `agentplug-runner` is the sole
spool loader; this package never loads the wasm itself.

## Files

- `cli.js` -- entry point, delegates to the staged runner
- `bootstrap.js` / `bootstrap-shared.js` / `bootstrap-wasm-core.js` -- wasm
  download, sha256 verification, version resolution
- `index.js` -- programmatic entry point
- `gm-log.js` / `gm-process.js` -- shared logging/process helpers
- `plugkit.version` / `plugkit.sha256` / `plugkit-slim.wasm.sha256` -- pinned
  version + sha sidecars, always re-verified against the freshly-resolved
  remote release rather than trusted as a standing pin (see gm's own
  `AGENTS.md`, cascade pin-toil design)

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
`bun x gm-plugkit@latest spool` invocation against a live project, reading
the actual `.gm/exec-spool/.status.json` it produces -- never a mock.

## Pull requests

No branches or PRs -- every change pushes straight to `main` (gm's own
`AGENTS.md`, direct-push-to-main rule). This package ships as part of the
same `publish.yml` run that ships `gm-skill` from the gm repo root.
