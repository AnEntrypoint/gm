---
name: dream-rsi
description: Infer strategy proposals from one session's Dream-RSI observation log. Run as a background agent on the smallest available model. Proposes only; never deploys.
---

# dream-rsi inference

Input: the path to one `observations.json` (a JSON array). Each record has `verb`, `exit_code`, `quality` (0..1), `gate_drift` (bool), `fingerprint`, `dispatch_id`, `ts`.

Do this, in order:

1. Read the file. Count records. If there are fewer than 20, return `{"status":"insufficient","records":N}` and stop.
2. Per verb, compute: count, mean `quality`, failure rate (`exit_code != 0`), and gate-drift rate (`gate_drift == true`).
3. Rank verbs by the product of (1 - mean quality) and count, highest first. These are the candidates for strategy change.
4. For the top 3 candidates, write one proposal: which verb, what change to the exploration strategy would address its failures, the evidence (counts and rates from step 2), and the expected effect stated as a measurable target on the same log.
5. Do not edit any file. Do not dispatch any verb. Do not claim a proposal is applied.

Output exactly one JSON object:

```
{"status":"proposed","records":N,"per_verb":[{"verb":"...","count":n,"mean_quality":x,"failure_rate":y,"gate_drift_rate":z}],"proposals":[{"verb":"...","change":"...","evidence":"...","target":"..."}]}
```

A proposal is evidence-bound planning input. It is deployed only through the normal phase, authorization and evidence gates, never by this skill.
