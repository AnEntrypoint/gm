# protocol-spec.md — skill-friendly memory pipeline callback protocol

**Designed:** 2026-05-20 (iter15 / G2). Source of truth for G3 (rs-learn impl) and G4 (rs-plugkit wiring).

## 0. Goal and non-goals

**Goal.** Eliminate rs-learn's outbound LLM dependency (acptoapi at :4800). When memorize/recall hits an LLM-tier step (summarize, classify, distill, expand-query), rs-learn suspends the pipeline, hands the question back to the host Claude agent as a structured imperative, and finalizes deterministically once the agent returns a result.

**Non-goals.** Embeddings (nomic-embed-text 768-dim, baked Q4 weights, in-wasm inference) remain in-process and are NOT mediated by this protocol. SQL writes, dedup, FTS, ranking — all stay native and deterministic.

## 1. Verb pair

- **`memorize`** / **`recall`** — unchanged entry verbs. When the body would require an LLM step, the response carries a `pending_step` envelope (instead of a final result) plus a `token`. Does not error, does not finalize.
- **`memorize-continue`** — single resumption verb for both flows. Body: `{token, step_id, result}`. Returns either another `pending_step` (multi-step pipeline) or the terminal result.

One resume verb keeps the surface small; `token` identifies origin flow.

## 2. Pending-step response shape

```json
{
  "ok": true,
  "pending_step": {
    "kind": "summarize",
    "id": "stp_01HXYZ...ULID",
    "payload": { "...": "kind-specific, see §4" },
    "prompt_template": "Summarize the following text into <=400 chars, preserving entities and any numeric facts. Return JSON {\"summary\": string}. Input:\n{{input}}",
    "max_result_bytes": 4096,
    "result_schema": { "type": "object", "required": ["summary"], "properties": {"summary": {"type": "string", "maxLength": 800}} }
  },
  "token": "tkn_01HXYZ...ULID.signed",
  "state_kv_key": "rs-learn/pipeline/stp_01HXYZ...ULID",
  "deadline_ms": 1747750000000,
  "attempts_remaining": 2
}
```

- `pending_step.kind` — enum: `summarize | classify | distill | expand-query`.
- `pending_step.id` — ULID; idempotency key.
- `pending_step.payload` — kind-specific input (§4). Already trimmed/bounded by rs-learn.
- `pending_step.prompt_template` — literal prose. `{{input}}` is the only mustache slot rs-learn pre-fills. Template authority lives in rs-learn so prompt iteration does not require agent changes.
- `pending_step.result_schema` — JSON Schema fragment rs-learn validates against.
- `pending_step.max_result_bytes` — hard cap on continue payload's `result`.
- `token` — opaque, HMAC-signed `(step_id, kv_key, deadline, flow_id, attempt)`.
- `state_kv_key` — debug/observability handle; opaque to agent.
- `deadline_ms` — wall-clock epoch ms; default 120_000 ms from emit.
- `attempts_remaining` — default 2. Each schema-rejected continue decrements.

## 3. Continue request shape

```json
{ "token": "tkn_...", "step_id": "stp_...", "result": { "summary": "..." } }
```

Resume state machine:
1. Verify HMAC; check step_id.
2. Load suspended pipeline from KV at `state_kv_key`. Missing -> `expired`.
3. Validate `result` against schema + max_result_bytes.
4. Splice into pipeline frame, advance one tick.
5. If next tick needs LLM -> emit new pending_step.
6. If terminal -> run native finalizer (embed -> SQL insert / FTS query -> rank), delete KV, return final response.

## 4. Step kinds

All payloads carry `flow_id` (origin request id) for tracing.

### 4.1 `summarize`
Input exceeds per-memo size budget (>2 KB).
```json
payload: { "input": "<bounded text, <=8KB>", "target_chars": 400, "preserve": ["entities","numbers","ids"] }
result:  { "summary": "<=800 chars" }
```

### 4.2 `classify`
"Worth memorizing?" or routing.
```json
payload: { "input": "<text>", "labels": ["keep","drop","duplicate-of-existing"], "context_hits": [{"id":"mem_...","text":"..."}] }
result:  { "label": "keep", "confidence": 0.0, "rationale": "<=240 chars" }
```
`confidence` is advisory; rs-learn thresholds on `label`.

### 4.3 `distill`
Cluster reduction during recall consolidation or merge.
```json
payload: { "inputs": [{"id":"mem_a","text":"..."}, {"id":"mem_b","text":"..."}], "target_chars": 600 }
result:  { "distilled": "<=1200 chars", "source_ids": ["mem_a","mem_b"] }
```
rs-learn verifies `source_ids ⊆ payload.inputs[*].id`.

### 4.4 `expand-query`
Sparse-query rewrite for recall.
```json
payload: { "query": "<original>", "k": 4 }
result:  { "expansions": ["<rewrite1>", "<rewrite2>", "..."] }
```
rs-learn embeds each expansion, unions hits, dedups by mem_id, returns top-N.

## 5. KV state shape and TTL

Stored at `rs-learn/pipeline/<step_id>` in the same libsql/sled KV rs-learn already uses (no new backend):

```json
{
  "flow_id": "flw_...",
  "verb": "memorize",
  "original_body": { "text": "...", "namespace": "@gm" },
  "pipeline": [
    { "step": "summarize", "status": "pending", "id": "stp_..." },
    { "step": "embed",     "status": "queued" },
    { "step": "persist",   "status": "queued" }
  ],
  "cursor": 0,
  "results_so_far": {},
  "created_ms": 1747749880000,
  "deadline_ms": 1747750000000,
  "attempts_used": 0,
  "token_hmac": "..."
}
```

**TTL.** 120s default, capped at 600s. Lazy eviction on each `memorize-continue` (scan + delete expired older than deadline_ms) and on watcher boot. No background sweep thread.

## 6. rs-plugkit instruction phase surfacing

Sub-phase **`AWAIT-RESULT`** (sibling of EXECUTE, not a new top-level phase — identity stays PLAN/EXECUTE/EMIT/VERIFY/COMPLETE).

When prior dispatch returned `pending_step`, next `instruction` response body:

```json
{
  "phase": "EXECUTE",
  "sub_phase": "AWAIT-RESULT",
  "pending_step": { ...verbatim from §2... },
  "required_next_verb": "memorize-continue",
  "required_next_body_shape": { "token":"<...>", "step_id":"<...>", "result":"<obey result_schema>" },
  "imperative": "Compute the summarize step inline using prompt_template against payload.input. Do NOT call any external tool. Dispatch memorize-continue with the result. No other verb is valid until this completes."
}
```

Instruction prose changes: one new row keyed on `sub_phase=AWAIT-RESULT` that renders the imperative and suppresses other phase-recommended verbs.

## 7. Incentive / gate behavior

Three-layer admission (cost, bounds, direction) gates open MUTABLE during AWAIT-RESULT. Admission for any verb other than `memorize-continue` (with matching `token`) is denied with **direction violation**: "pipeline suspended at step_id=stp_...; only memorize-continue advances state."

- `turn-state.json` records `pending_step_id` and `pending_step_deadline_ms`.
- `spool-dispatch.js` refuses non-`memorize-continue` verbs while `pending_step_id` set and unexpired, returning structured error referencing imperative.
- `instruction` stays callable (re-read imperative) but body locked to AWAIT-RESULT template until resolution.

Suspended pipeline IS the open mutable.

## 8. Error / timeout handling

- **Schema-invalid result** -> `{ok:false, error:"result_schema_violation", pending_step:{...same id, same token...}, attempts_remaining: n-1}`. Retry; at 0 -> terminal abort.
- **Stale token** (HMAC valid, KV GC'd) -> `{ok:false, error:"expired", flow_id, hint:"redispatch original verb"}`. Gate clears `pending_step_id`.
- **Forged token** -> `{ok:false, error:"invalid_token"}`. Gate untouched (defensive).
- **Deadline passed with no continue** -> on next `instruction`, plugkit notices `now > deadline_ms`, deletes KV, clears gate, surfaces `pipeline_timeout` event in instruction body with original verb body. Memo NOT persisted.
- **Terminal abort** (attempts exhausted): KV deleted, gate cleared, `{ok:false, error:"step_unresolvable", kind, step_id, last_validation_error}`. Logged. Original memorize dropped; no half-state in SQL.

No partial commits. No background retries. Deterministic finalize-with-result, or write nothing.

---

## Implementation touchpoints

- `C:\dev\gm\gm-starter\gm-plugkit\plugkit-wasm-wrapper.js` — verb dispatch surface, instruction response assembly (auto_recall precedent applies)
- `C:\dev\gm\gm-starter\lib\spool-dispatch.js` — verb admission / gate enforcement; AWAIT-RESULT lock
- `C:\dev\gm\.gm\turn-state.json` — add `pending_step_id`, `pending_step_deadline_ms`
- rs-learn crate: pipeline state machine + libsql KV suspension + HMAC token mint/verify + instruction-table row for AWAIT-RESULT
- rs-plugkit crate: instruction-table AWAIT-RESULT row; wasm_dispatch forwards `memorize-continue`
