# Remaining PRDs

Each file = one PRD: plan w/ acceptance criteria + witness plan.

Status: open, blocked, or done. Row closes only w/ witness: live dispatch id or green CI run for pushed sha.

| id | title | status |
| --- | --- | --- |
| 01 | Decide loader strategy for wasip3 port | done: doc-drift run 39056685848 green on 75094860 |
| 02 | Define env ABI as WIT interface | done: rs-plugkit 8105452c merged in 6099c00540; native-check 39140672148 + release 39140672139 green; wasip1 release build pass; live witness dispatch 1792339135393-500-915cba996e34d645 |
| 03 | Build plugkit guest as wasip3 component | done: component export gm:plugkit/guest@0.1.0 (03b); wasip3 build EXIT=0, witness .gm/witness-out/wasip3-03b-1018-component-interfaces.txt sha256 0240acc6...; rs-plugkit 688f14d4, CI run 39149447285 green 8/8; live load wait on 04/05 |
| 04 | Link components in agentplug-host on wasmtime 46 | open |
| 05 | Select loader by artifact type in agentplug-runner | open |
| 06 | Add wasip3 build + link jobs to CI | open |
| 07 | Witness wasip3 plugkit verb through agentplug-runner | open |
| 08 | Fix gm tooling friction seen in this port | open |