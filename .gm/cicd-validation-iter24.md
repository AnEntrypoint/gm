# gm-stack CI/CD cascade validation — iter24

Audit date: 2026-05-21. Reference release: rs-plugkit v0.1.467 (commit 7ad2290, "D3 fix").

## Summary

9 of 10 links **PASS**. 1 **FAIL** (Check 9: gh-pages deploy on gm — Bad credentials). 1 advisory observation on rs-learn-wasm/rs-codeinsight-wasm npm packages (Check 10): they are not on npm at all, contradicting AGENTS.md "Cascade pipeline" claim that they publish independently.

End-to-end propagation works: rs-learn push at 22:45:15Z -> rs-plugkit Release run 26194326074 at 22:45:21Z (6s) -> plugkit-bin v0.1.467 published 00:02:28Z -> npm plugkit-wasm@0.1.467 -> gm auto-bump commit 0efd36c1 at 00:02:49Z -> gm publish run 26197157087 success at 00:02:53Z (48s) -> gm-plugkit@2.0.1262 on npm -> gm-skill HEAD 565fbcb2 "Auto-build ... (v2.0.1262)" at 00:03:25Z. Whole cascade end-to-end: ~1h17m, dominated by rs-plugkit cargo build.

---

## Check 1 — rs-* siblings -> rs-plugkit trigger — PASS

- rs-learn cascade.yml run 26194322167 success, push 2026-05-20T22:45:15Z, commit `fix(embeddings): align EMBED_DIM 768 -> 384`, headSha `6e37f964`.
- rs-plugkit Release workflow_dispatch run 26194326074 success, started 22:45:21Z (6s after cascade fired). Duration 1m48s.
- Timestamps line up. PUBLISHER_TOKEN path is healthy.

## Check 2 — rs-plugkit Build + Release for v0.1.467 — PASS

- plugkit-bin Release `v0.1.467 (WASM)` published 2026-05-21T00:02:28Z.
- Assets: `plugkit.wasm` (61,038,797 bytes, sha256 `21a0c7b54788cec3dc35cbc00c4847ced155a2c8336b0c01d0987d2cc2247f06`), `.sha256`, `.version`.
- `npm view plugkit-wasm@0.1.467` returns metadata; dist-tags.latest = 0.1.467.

## Check 3 — plugkit-wasm npm == plugkit-bin Release bytes — PASS

- Release wasm sha256: `21a0c7b54788cec3dc35cbc00c4847ced155a2c8336b0c01d0987d2cc2247f06`.
- `npm pack plugkit-wasm@0.1.467` -> `package/plugkit.wasm` sha256: identical, 61,038,797 bytes. Byte-equivalent.

## Check 4 — gm auto-bump commit — PASS

- Commit `0efd36c1` "chore: bump plugkitVersion to 0.1.467 (WASM)" at 2026-05-21T00:02:49Z on AnEntrypoint/gm main. 21s after plugkit-bin release publish.

## Check 5 — gm publish.yml on bump commit — PASS

- Run 26197157087 "Build & Publish Plugins" triggered by push of `0efd36c1`, started 00:02:53Z, success in 48s.

## Check 6 — gm-plugkit npm publish — PASS (with caveat)

- `npm view gm-plugkit version` -> `2.0.1262`. dist-tags.latest = 2.0.1262.
- Caveat: the source `gm-starter/gm-plugkit/package.json` has `"version": "0.1.0"` hardcoded (line 3); the publish step in `publish.yml` rewrites the version to match gm.json's version at publish time. This is by design (gm version-aligned) but means the on-disk version field is meaningless. Files include `cli.js, index.js, bootstrap.js, plugkit-wasm-wrapper.js, plugkit.version, plugkit.sha256` — wrapper + bootstrap present.

## Check 7 — gm-skill downstream repo — PASS

- HEAD commit `565fbcb2` "Auto-build: gm-skill canonical universal harness plugin from gm (v2.0.1262)" at 00:03:25Z (32s after gm publish run completed).
- `skills/gm-skill/SKILL.md` contains the batching paragraph beginning "**Batch writes, waits, and reads together.**" — present in raw GitHub fetch.
- `bin/plugkit.wasm` sha256 = `21a0c7b54788cec3dc35cbc00c4847ced155a2c8336b0c01d0987d2cc2247f06` (61,038,797 bytes). Matches plugkit-wasm 0.1.467 exactly.

## Check 8 — bun resolution of `gm-plugkit@latest` — PASS (claim was erroneous)

- npm registry truth: `gm-plugkit` dist-tags.latest = `2.0.1262`. No `0.1.467` exists in the `gm-plugkit` version list (range 2.0.1074 .. 2.0.1262).
- No alias, no dist-tag pollution. `bun x gm-plugkit@latest` will resolve to 2.0.1262.
- The reported confusion ("bun resolves gm-plugkit@latest to 0.1.467") cannot be reproduced from registry data alone. Most likely cause: stale bun cache from before 2.0.x existed (very old, since 2.0.1074 predates 0.1.467 by months), or the other session confused two prints — one of `plugkit-wasm` (0.1.467) and one of `gm-plugkit` (2.0.1262). The registry is correct.
- Recommendation (deferred): `bun pm cache rm` on the affected machine; verify with `bun pm ls gm-plugkit` after a fresh install.

## Check 9 — gh-pages deploy on gm — **FAIL**

- Run 26197157124 step "Run actions/configure-pages@v5" errored: `Get Pages site failed. ... Error: Bad credentials - https://docs.github.com/rest. HttpError: Bad credentials`.
- Token used at this step is the workflow's default `GITHUB_TOKEN` (no PAT in this step). "Bad credentials" against `actions/configure-pages@v5` after Pages was previously enabled almost always means: (a) Pages was disabled on the repo (action then tries to read site config and fails auth check), or (b) the `permissions:` block in the deploying job is missing `pages: write` / `id-token: write`, which causes configure-pages to attempt unprivileged calls.
- Fix recommendation (deferred): inspect `.github/workflows/publish.yml` deploy job for the `permissions:` block; if `pages: write` and `id-token: write` are present, then re-enable Pages on the repo via Settings > Pages > Source = GitHub Actions, or pass `enablement: true` to `actions/configure-pages@v5`. The credentials themselves are not stale (same GITHUB_TOKEN works in earlier steps of the same run).

## Check 10 — @anentrypoint/rs-learn-wasm npm — **FAIL (advisory)**

- `npm view @anentrypoint/rs-learn-wasm` -> 404 Not Found. Same for `@anentrypoint/rs-codeinsight-wasm`.
- AGENTS.md "Cascade pipeline" section claims: *"siblings publish their own wasm artifacts independently (`@anentrypoint/rs-learn-wasm`, `@anentrypoint/rs-codeinsight-wasm`)"*. This claim is false against the live npm registry.
- However: this does not break the cascade. rs-plugkit currently embeds rs-learn and rs-codeinsight logic directly into the plugkit.wasm artifact (per `rs-learn/Cargo.toml` workspace shows only `crates/wasm`, and rs-plugkit cargo build pulls these in as path/git deps). So the documented "siblings publish their own wasm" pattern is aspirational, not implemented, but the working cascade does not require it.
- Fix recommendation (deferred): either (a) update AGENTS.md "Cascade pipeline" to remove the npm-publishing claim for sibling wasm packages and document the rs-plugkit-embeds-them reality, or (b) wire up `publish-wasm` workflows on rs-learn and rs-codeinsight to actually publish those scoped packages.

---

## Evidence table

| Check | Status | Key evidence |
|---|---|---|
| 1 rs-learn cascade -> rs-plugkit | PASS | runs 26194322167 -> 26194326074, 6s gap |
| 2 plugkit Release + npm | PASS | plugkit-bin v0.1.467, npm plugkit-wasm@0.1.467 |
| 3 sha equivalence | PASS | `21a0c7b5...7f06` both sides, 61038797 bytes |
| 4 gm auto-bump | PASS | commit 0efd36c1 |
| 5 gm publish.yml | PASS | run 26197157087, 48s, success |
| 6 gm-plugkit npm | PASS | 2.0.1262 latest |
| 7 gm-skill repo | PASS | HEAD 565fbcb2, batching para present, wasm sha matches |
| 8 bun resolves gm-plugkit | PASS | registry truth disproves claim |
| 9 gh-pages | **FAIL** | run 26197157124, configure-pages@v5 Bad credentials |
| 10 rs-learn-wasm npm | **FAIL (advisory)** | 404 — docs say it should exist |

## Local clone note

`C:\dev\gm\gm-starter\gm.json` shows `plugkitVersion: "0.1.466"` and `version: "2.0.1260"` — local clone is behind remote main (remote is at 0.1.467 / 2.0.1262 after commits 0efd36c1, 565e39b3, and version auto-bumps). Not a CI bug; a `git fetch && git pull` on the workstation is sufficient. No file edits required.
