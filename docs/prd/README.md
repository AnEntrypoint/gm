# Remaining PRDs

Each file is one PRD: a plan with acceptance criteria and a witness plan.
Status is one of open, blocked or done. A row closes only with a witness:
a live dispatch id or a green CI run for the pushed sha.

| id | title | status |
| --- | --- | --- |
| 01 | Decide the loader strategy for the wasip3 port | done: doc-drift run 39056685848 green on 75094860 |
| 02 | Define the env ABI as a WIT interface | done: rs-plugkit 8105452c merged in 6099c00540; native-check 39140672148 and release 39140672139 green; wasip1 release build passes; live witness dispatch 1792339135393-500-915cba996e34d645 |
| 03 | Build the plugkit guest as a wasip3 component | done: component exports gm:plugkit/guest@0.1.0 (03b); wasip3 build EXIT=0, witness .gm/witness-out/wasip3-03b-1018-component-interfaces.txt sha256 0240acc6...; rs-plugkit 688f14d4, CI run 39149447285 green 8/8; live load waits on 04/05 |
| 04 | Link components in agentplug-host on wasmtime 46 | open |
| 05 | Select the loader by artifact type in agentplug-runner | open |
| 06 | Add wasip3 build and link jobs to CI | open |
| 07 | Witness a wasip3 plugkit verb through agentplug-runner | open |
| 08 | Fix gm tooling friction seen during this port | open |
