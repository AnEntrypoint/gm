# Brief: search and grep (components/search)

Replaces the earlier native plugin brief. Read tasks/rewrite/common.md (the build rules apply, with your own build dir build/search) and native/include/gmnew/verbs.hpp.

Build a library gmnew_search (components/search, search.cpp) with class SearchVerbs : public gmnew::VerbTable, the same way as CoreVerbs. Verbs:
- search({query, k?}): BM25 over the lines of git-tracked files, from git ls-files in the workspace.
- grep({pattern, root?, mode?, ignoreCase?, limit?, offset?}): mode literal, regex or word; a literal miss with regex characters repeats as a regex; an invalid regex is an error.
Keep the Node skip rules, hints and reply shapes from src/search.mjs, the stamp-based cache (device, inode, size, mtime, ctime and a settle time), and the state directory skips.
Use std::regex and std::filesystem. The cache is an object owned by SearchVerbs, not file-scope state.
Process spawn for git ls-files: use gmnew::proc::run from native/include/gmnew/proc.hpp.
Tests in components/search/tests/search_test.cpp over a temp git repo: ranking, literal and regex grep, the zero-match hint, invalid regex error. Register under GMNEW_BUILD_TESTS. No plugin ABI, no dlopen, no native/plugins directory.