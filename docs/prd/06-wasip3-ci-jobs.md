# 06 Add wasip3 build and link jobs to CI

Builds on dual-loader decision in `docs/wasip3-loader-decision.md` (Rows this changes, PRD 06 and 07): CI builds and links both core wasip1 path and wasip3 component path.

## Problem

Nothing in CI builds `wasm32-wasip3`. Current CI uses stable Rust, wasip3 std library ships only in nightly. wasip3 build verified only locally.

## Scope

- Add `wasm32-wasip3` job to `rs-plugkit/.github/workflows/native-check.yml` or new workflow. Installs nightly with `wasm32-wasip3` target.
- Build guest from 03 with `--features slim`.
- Add link job in agentplug repo that loads artifact from job.
- Keep wasip1 `release` workflow unchanged.

## Acceptance

- Both jobs green on pushed sha.

## Witness

`ci-status` reports green for sha of each push, with run ids.