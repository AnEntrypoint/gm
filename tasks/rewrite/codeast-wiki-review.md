# Brief: codeast-wiki-review (native/leaves)

Read tasks/rewrite/common.md (its build rules do not apply: these are JavaScript leaves) and tasks/rewrite/leaves.md (the leaf rules). Build dir not needed. Files you own: native/leaves/code-ast.mjs, native/leaves/wiki.mjs, native/leaves/review.mjs, native/leaves/vendor/, native/leaves/tests/ (new files only).

Spec: src/code-ast.mjs (callers, impact), src/wiki.mjs and src/wiki-tools.mjs (wiki_search, wiki_write, and lintWiki that finish uses), src/review.mjs and src/review-tools.mjs (review_packet, review_record, review_join), src/search.mjs for the BM25 scoring of wiki_search.

1. Vendor acorn 8.18.0 for the QuickJS engine: download the npm tarball with curl from the registry, extract the ESM build into native/leaves/vendor/acorn.mjs, record the version, the URL and the sha256 in native/leaves/vendor/VERSION.txt. The leaf imports it with a relative import from its own file, which the engine loader resolves.
2. code-ast leaf: callers and impact, with Node's reply shapes. Reads only git-tracked files, through host.run of git ls-files and host.read_file.
3. wiki leaf: wiki_search (BM25 in JavaScript, same tokenizer as src/search.mjs), wiki_write (writes the wiki page and a wiki event through host.logAppend), and a verb wiki_lint that returns the same problems and pages object that lintWiki returns in src/wiki.mjs. finish in the MCP server calls wiki_lint.
4. review leaf: review_packet, review_record, review_join with the same shapes.
5. Tests under node: native/leaves/tests/ using node_modules/acorn (already installed for the Node reference) and a mock host. Run node --test native/leaves/tests and quote the counts. Each Node reference behaviour that matters should have one test with the same input and the same expected output as the Node module gives (run the Node module from a git-archive copy of HEAD to produce the expected output).
Report the test counts and what is not done.