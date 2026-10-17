# 06 Add wasip3 build and link jobs to CI

## Problem

Nothing in CI builds `wasm32-wasip3`. The current CI uses stable Rust, and the
wasip3 standard library ships only in nightly. The wasip3 build has been verified
only locally.

## Scope

- Add a `wasm32-wasip3` job to `rs-plugkit/.github/workflows/native-check.yml` or a new workflow. It installs nightly with the `wasm32-wasip3` target.
- Build the guest from 03 with `--features slim`.
- Add a link job in the agentplug repository that loads the artifact from the job.
- Keep the wasip1 `release` workflow unchanged.

## Acceptance

- Both jobs are green on the pushed sha.

## Witness

`ci-status` reports green for the sha of each push, with run ids.
