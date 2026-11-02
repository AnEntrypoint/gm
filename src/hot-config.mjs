// The modules under src/ that a running worker reloads in place. A reload replaces their tool definitions, their compaction tables and their
// verb handlers (tools.mjs builds the handlers from the modules the worker passes). No module keeps state at module level; a verb's own index
// (code-ast.mjs) is built again on its next call. Every other module under src/ is a singleton, and a change to it restarts the worker,
// because it holds state that a reload would lose (the log, the jobs, the paging of search results) or it is on the path of every call.
export const RELOADABLE = ['git.mjs', 'rows.mjs', 'fetch.mjs', 'code-ast.mjs', 'wiki-tools.mjs', 'review-tools.mjs'];
