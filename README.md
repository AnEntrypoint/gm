# gm-new

A single-worker long-horizon loop: one worker, one append-only log, governance rules re-read at every step. Design and evidence: `DESIGN.md` and `research/deep-research.md`.

Status: first slice. Node.js 20+, standard library only, no build step.

## Run

    node src/cli.mjs run --task "<text or file>" --workspace <dir> [--model scripted|anthropic] [--max-steps N]
    node src/cli.mjs query --run <id> --js "events.filter((e) => e.kind === 'end')"

- `scripted` is a deterministic offline model for smoke runs. It makes no API call.
- `anthropic` calls the Messages API. It needs `ANTHROPIC_API_KEY`, and `GMNEW_MODEL` overrides the default `claude-sonnet-5-5`. The key is never logged and is removed from the environment that `run_shell` children get.
- Each run writes `runs/<id>/` with `log.jsonl`, `rules.md` and `task.json`. `runs/` is git-ignored.
- Paths given to the file tools are confined to the workspace. `run_shell` is not sandboxed.
