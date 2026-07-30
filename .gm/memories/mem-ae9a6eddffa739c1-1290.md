---
key: mem-ae9a6eddffa739c1-1290
ns: default
created: 1785411626555
updated: 1785411626555
---

rs-plugkit graph()/graph_detailed() rationale (fsm.rs): graph() resolves the active FSM graph across all three tiers -- order, first usable wins: project-vendored .gm/instructions/fsm/graph.json, then the config repo's cached fsm.graph, then default_graph(). This is deliberately the same shape prose::resolve already runs for instruction text -- the graph was the one surface a config repo could not supply, which meant a remote repo could restyle a workflow's prose but never change its states, edges, gates or policy, the central claim of the source-repo feature otherwise unmet. A tier that PARSES but fails validation does not fall through to the next tier silently -- it is recorded via record_graph_rejection and the compiled default serves, so a broken graph is never quietly replaced by a different author's working one.

graph_detailed() rationale: resolves the graph and reports which tier answered and from what path. graph() alone made the resolution unobservable -- an operator pointing a project at a config repo had no way to confirm the graph came from there rather than from a local file they forgot about or from the compiled default. Reporting the tier is what turns "a repo can supply an FSM" from a claim into something checkable, which is the whole point of the tier.
