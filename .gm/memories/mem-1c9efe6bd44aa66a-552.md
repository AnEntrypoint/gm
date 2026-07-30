---
key: mem-1c9efe6bd44aa66a-552
ns: default
created: 1785411592833
updated: 1785411592833
---

rs-plugkit source_repo_graph_path() rationale (fsm.rs): resolves the path within the config-source cache holding a repo-supplied graph, if the resolved config points at one. The pointer is read from the resolved config's fsm.graph key -- a key gm.config.json has always declared and nothing had ever read, until this. Resolution goes through config::resolve() so the graph rides the same 4-tier chain, the same debounced fetcher, and the same rejection reporting as everything else, rather than growing a second parallel notion of "where config lives".
