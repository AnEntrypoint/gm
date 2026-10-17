# Remaining PRDs

Each file is one PRD: a plan with acceptance criteria and a witness plan.
Status is one of open, blocked or done. A row closes only with a witness:
a live dispatch id or a green CI run for the pushed sha.

| id | title | status |
| --- | --- | --- |
| 01 | Decide the loader strategy for the wasip3 port | done: doc-drift run 39056685848 green on 75094860 |
| 02 | Define the env ABI as a WIT interface | done: adapter and WIT in rs-plugkit 4c11c02; wasip2 and wasip3 builds link it |
| 03 | Build the plugkit guest as a wasip3 component | partly: typed exports in rs-plugkit 84fea52 and 73da9b1. The wasip3 artifact traps at start-up on wasmtime 46 (wit-bindgen async_support assertion). Blocked upstream. The wasip2 artifact of the same WIT runs (see 04) |
| 04 | Link components in agentplug-host on wasmtime 46 | done for the witness: live health dispatch through the wasip2 component, agentplug 7519886 and 6d78a2c |
| 05 | Select the loader by artifact type in agentplug-runner | done: witnesses in agentplug 6d78a2c (component on core path, core on component path, and both accepted) |
| 06 | Add wasip3 build and link jobs to CI | partly: wasip2-component workflow in rs-plugkit 1a255ed, checked locally. The CI run needs the workflow on main, which needs permission to push to main |
| 07 | Witness a wasip3 plugkit verb through agentplug-runner | partly: health and codesearch dispatched through the runner on the wasip2 component. host_random_fill is not reached by any dispatched verb yet |
| 08 | Fix gm tooling friction seen during this port | partly: cwd-less calls default to the client project, gm-mcp 2b90ab3, witnessed by the dispatch-root-defaulted log line. Claim-sweep stall, long-gap refusal, symbolic push and subject length are open |
