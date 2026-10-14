# 04-STATE: LIVEPLAN-RETIRE-XYPROB-RUNTIME-STATE

State owned: the PRD rows LIVEPLAN-RETIRE-XYPROB-RUNTIME-STATE (moves to .gm/prd-log.jsonl on resolve) and XYPROB-runtime-state-in-submodules (superseded). Replay: prd-resolve on an already resolved row is refused as absent from .gm/prd/, so a replay is a no-op.
