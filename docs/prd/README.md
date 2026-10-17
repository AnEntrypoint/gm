# Remaining PRDs

Each file is one PRD: a plan with acceptance criteria and a witness plan.
Status is one of open, blocked or done. A row closes only with a witness:
a live dispatch id or a green CI run for the pushed sha.

| id | title | status |
| --- | --- | --- |
| 01 | Decide the loader strategy for the wasip3 port | done: doc-drift run 39056685848 green on 75094860 |
| 02 | Define the env ABI as a WIT interface | open |
| 03 | Build the plugkit guest as a wasip3 component | open |
| 04 | Link components in agentplug-host on wasmtime 46 | open |
| 05 | Select the loader by artifact type in agentplug-runner | open |
| 06 | Add wasip3 build and link jobs to CI | open |
| 07 | Witness a wasip3 plugkit verb through agentplug-runner | open |
| 08 | Fix gm tooling friction seen during this port | open |
