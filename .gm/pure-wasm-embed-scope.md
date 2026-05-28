# Pure-WASM Nomic Embed Scope — Decision Doc

## Recommendation

**Primary: candle-core + candle-transformers (`models::nomic_bert`) targeting `wasm32-wasip1`, weights as `safetensors` F16 (or in-tree GGUF reader for Q4_K_M), `include_bytes!`-baked.**

Candle has a first-class `nomic_bert` model implementation and ships maintained wasm examples (`candle-wasm-examples/bert`). Compilation to wasm requires:
- `getrandom = { features = ["custom"] }` and a custom getrandom register that calls the host's `random_get` WASI shim (already implemented in `plugkit-wasm-wrapper.js`).
- `default-features = false` on candle-core; **no** `mkl`, `cuda`, `accelerate`, `cudnn`, `metal` features.
- Rayon disabled (single-threaded; candle runs on one thread in wasm by design — PR #3063 multithread is experimental, requires wasi-threads which the current host lacks).
- WASI p1 works because candle's wasm story is essentially "no syscalls except RNG"; the wrapper's BADF stubs for fd_prestat_* are sufficient since weights are baked in.

Sources: [candle issue #1032](https://github.com/huggingface/candle/issues/1032), [PR #3055 getrandom fix](https://github.com/huggingface/candle/pull/3055), [PR #3063 wasm rayon](https://github.com/huggingface/candle/pull/3063), [candle-wasm-examples/bert](https://github.com/huggingface/candle/tree/main/candle-wasm-examples).

## Quantization Format

Nomic ships **GGUF only** for quantized variants — no quantized safetensors. Sizes from [nomic-ai/nomic-embed-text-v1.5-GGUF](https://huggingface.co/nomic-ai/nomic-embed-text-v1.5-GGUF):

| Variant   | Size   |
|-----------|--------|
| Q2_K      | 48 MiB |
| Q4_K_M    | 81 MiB |
| Q5_K_M    | 95 MiB |
| Q8_0      | 140 MiB |
| F16       | 262 MiB |

Candle has a GGUF loader (`candle-core::quantized::gguf_file`) and Q4_K dequant kernels (used by quantized-llama example), so Q4_K_M is loadable. Tokenizer is `bert-base-uncased` WordPiece — load via `tokenizers` crate (`default-features=false, features=["unstable_wasm"]`).

**Recommendation: Q4_K_M (81 MiB).** Q4_0 (75 MiB) is slightly smaller but Q4_K_M is the standard quality/size sweet spot.

## Size Projection

- Model weights baked: **81 MiB (Q4_K_M)**.
- candle-core + candle-transformers + tokenizers + gguf loader compiled wasm code (release, `opt-level="z"`, `lto=true`, `strip=true`): expected **6–12 MiB** code. Reference: candle's bert wasm example produces ~7 MB code-only wasm.
- Total: **~90–95 MiB wasm**, well under the 200 MB budget, leaves headroom for rs-plugkit's existing libsql + tree-sitter footprint.

## Latency Projection

- Cold start (parse wasm + instantiate + dequant Q4_K_M weights into linear memory): **~1–3 s** on modern CPU. Dequant of 81 MiB -> ~150 MiB F32 working set is the dominant cost.
- First embedding (137M params, mean-pool, matryoshka 768->768): **~150–600 ms per sentence** single-threaded wasm. Reference: tract-wasi is ~3–4× slower than native ONNX; candle wasm is comparable. For a 137M-param BERT, native CPU ≈ 30–80 ms/embed -> wasm ≈ 100–400 ms.
- Memory: F32 activations + dequant weights ≈ 250–400 MiB peak, comfortably under the 2 GiB wasm32 linear-memory ceiling.

Both inside budget.

## Known Blockers / Unknowns

1. **Dequant-at-load memory spike**: 81 MiB Q4 -> 262 MiB F32 means peak RSS during cold start touches ~350 MiB. Acceptable but worth measuring.
2. **`tokenizers` crate wasm story**: needs `unstable_wasm` feature; some regex deps historically pulled `mio`. Verify clean build before committing.
3. **Matryoshka truncation + LayerNorm**: candle's `nomic_bert` does mean-pool but the layer-norm-then-truncate step for matryoshka 768->512/256 must be added in caller code (~30 LOC).
4. **serde version coexistence with libsql-ffi 0.9.0 + tree-sitter-***: candle pins serde 1.x — no conflict expected, but `Cargo.lock` resolution must be verified.
5. **Wasm-opt pass**: `wasm-opt -Oz` will shave another ~20% off code segment but must run in CI; not currently in rs-plugkit's release.yml.

## Second-Best Fallback

**tract-onnx** with Nomic-Embed-v1.5 ONNX export. tract is pure-Rust, no_std-friendly, wasi-clean ([wasi-nn-onnx confirms tract+wasi works](https://github.com/deislabs/wasi-nn-onnx)). Downsides: (a) ~3–4× slower than candle in wasm per benchmark precedent, (b) ONNX file is ~550 MiB unquantized — would need INT8 ONNX export, and tract's INT8 op coverage for BERT is partial. Only fall back if candle's nomic_bert+GGUF path hits an unfixable wasm build wall.

## Last-Resort: Model Swap

If 137M params is too heavy or candle path fails entirely, swap to **all-MiniLM-L6-v2 Q4_K_M (~21 MiB, 384-dim, 22M params)** via candle's `bert` model. **Dim mismatch cost**: rs-plugkit's `F32_BLOB(768)` schema -> `F32_BLOB(384)`. Requires (a) sqlite-vec column re-create migration, (b) re-embed of all rs-learn corpus, (c) recall-quality regression test. Roughly 1 subagent-hour migration + several hours wallclock to re-embed depending on corpus size. **Quality drop is real** — MiniLM MTEB avg ≈ 56 vs Nomic v1.5 ≈ 62; recall@k will degrade on technical content.

Burn is rejected as primary: backend-agnostic but no shipped Nomic/BERT model code; would mean hand-porting weights. Hand-rolled is rejected: WordPiece + 12-layer transformer + Q4_K dequant kernels is ~2–3 KLOC of careful matmul, not a payoff vs candle.

## Implementation Effort

- Cargo wiring, getrandom shim, feature flags: **2 subagent-hours**.
- GGUF load + nomic_bert wire-up + tokenizer + mean-pool + matryoshka: **3–4 subagent-hours** (mostly mirroring candle's existing bert example).
- Plumb as `vec_embed` verb replacement, retire acptoapi dependency for embeddings: **2 subagent-hours**.
- CI: bake weights via `include_bytes!`, verify wasm size, smoke-test cold start: **1 subagent-hour**.

**Total: ~8–10 subagent-hours** end-to-end.
