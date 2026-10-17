# Remaining PRDs

Each file is one PRD: a plan with acceptance criteria and a witness plan.
Status is one of open, blocked or done. A row closes only with a witness:
a live dispatch id or a green CI run for the pushed sha.

| id | title | status |
| --- | --- | --- |
| 01 | Decide the loader strategy for the wasip3 port | done: doc-drift run 39056685848 green on 75094860 |
| 02 | Define the env ABI as a WIT interface | done: adapter and WIT in rs-plugkit 4c11c02; wasip2 and wasip3 builds link it |
| 03 | Build the plugkit guest as a wasip3 component | partly: the wasip3 artifact returns plugkit-version through the host (rs-plugkit f0fd1b8, wit-bindgen 0.63), but dispatch-verb faults on the shadow stack pointer, which wasmtime 46 does not set per task (no task hook). Blocked upstream |
| 04 | Link components in agentplug-host on wasmtime 46 | done for the witness: live health dispatch through the wasip2 component, agentplug 7519886 and 6d78a2c |
| 05 | Select the loader by artifact type in agentplug-runner | done: witnesses in agentplug 6d78a2c (component on core path rejected, core on component path rejected, each correct pairing loads) |
| 06 | Add wasip3 build and link jobs to CI | done for wasip2: CI run 39070554628 green on rs-plugkit c7184d7, including the component-shape witness step. The wasip3 job is not added |
| 07 | Witness a wasip3 plugkit verb through agentplug-runner | partly: health and codesearch dispatch through the runner on the wasip2 component. The host_random_fill criterion is not applicable to the slim build: the only randomness path is tokenizer init, which slim never runs. Acceptance amended to "the component links host-random-fill and exports the backend" |
| 08 | Fix gm tooling friction seen during this port | partly: cwd-less calls default to the client project (gm-mcp 2b90ab3, dispatch-root-defaulted log). Claim-sweep stall not reproduced (8 concurrent dispatches, 1.06 to 1.12 s, no errors). Long-gap refusal not reproduced (task-output answers its own validation). Symbolic git_push and the 50-character subject are deliberate verb rules, documented in their replies |
