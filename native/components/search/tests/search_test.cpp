#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <string>

#include "gmnew/json.hpp"
#include "gmnew/proc.hpp"
#include "search.hpp"
#include "search_impl.hpp"

namespace fs = std::filesystem;
using gmnew::json::Value;

namespace {

int failures = 0;

void check(bool ok, const std::string& what) {
    if (!ok) {
        ++failures;
        std::cerr << "FAIL " << what << "\n";
    }
}

void write(const fs::path& path, const std::string& text) {
    fs::create_directories(path.parent_path());
    std::ofstream(path) << text;
}

Value parse(const std::string& text) {
    auto parsed = gmnew::json::parse(text);
    check(parsed.has_value(), "reply is JSON: " + text);
    return parsed ? *parsed : Value();
}

std::string output_of(const Value& reply) {
    const Value* out = reply.find("output");
    return out ? out->as_string() : std::string();
}

}

int main() {
    fs::path dir = fs::temp_directory_path() / ("gmnew_search_test_" + std::to_string(std::rand()));
    fs::remove_all(dir);
    fs::create_directories(dir);
    write(dir / "a.txt", "nothing here\nplain text\n");
    write(dir / "src" / "planner.js", "function planWaves() {}\nconst x = 1;\n");
    write(dir / "node_modules" / "dep" / "index.js", "needle_in_vendor\n");
    write(dir / ".gitignore", "ignored.log\n");
    write(dir / "ignored.log", "needle_in_ignored\n");
    write(dir / "loose.txt", "needle_loose\n");
    write(dir / "blob.bin", std::string("needle\0bin\n", 11));
    gmnew::proc::run({"git", "init", "-q"}, dir);
    gmnew::proc::run({"git", "add", "-f", "a.txt", "src", ".gitignore", "node_modules", "blob.bin"}, dir);

    gmnew::search::Searcher searcher(dir);

    Value ranked = parse(searcher.search(Value(gmnew::json::Object{{"query", "waves"}})));
    check(ranked.find("ok") && ranked.find("ok")->as_bool(), "search ok");
    check(output_of(ranked).rfind("src/planner.js:1 ", 0) == 0, "search ranks the file with the term first: " + output_of(ranked));

    Value literal = parse(searcher.grep(Value(gmnew::json::Object{{"pattern", "plain text"}})));
    check(output_of(literal).find("a.txt:2 plain text") != std::string::npos, "grep literal");

    Value regex = parse(searcher.grep(Value(gmnew::json::Object{{"pattern", "plan[A-Z]\\w+"}, {"mode", "regex"}})));
    check(output_of(regex).find("src/planner.js:1") != std::string::npos, "grep regex");

    Value fallback = parse(searcher.grep(Value(gmnew::json::Object{{"pattern", "plan.aves"}})));
    check(output_of(fallback).find("matched as regex") != std::string::npos, "literal falls back to regex");

    Value tracked_skip = parse(searcher.grep(Value(gmnew::json::Object{{"pattern", "needle_in"}, {"vendor", false}})));
    check(output_of(tracked_skip).rfind("hint: 2 files skipped (1 in node_modules or vendor, 1 gitignored); use scope: 'all' to include them\n(0 matches", 0) == 0,
          "zero-match hint is the first line: " + output_of(tracked_skip));

    Value loose_found = parse(searcher.grep(Value(gmnew::json::Object{{"pattern", "needle_loose"}})));
    check(output_of(loose_found).find("loose.txt:1 needle_loose") != std::string::npos,
          "default scope finds an untracked file that git does not ignore: " + output_of(loose_found));

    Value all = parse(searcher.grep(Value(gmnew::json::Object{{"pattern", "needle_in"}, {"scope", "all"}})));
    check(output_of(all).find("ignored.log:1") != std::string::npos, "scope all finds gitignored file: " + output_of(all));

    Value by_path = parse(searcher.grep(Value(gmnew::json::Object{{"pattern", "plain text"}, {"path", "a.txt"}})));
    check(output_of(by_path).find("a.txt:2 plain text") != std::string::npos, "grep path names one tracked file: " + output_of(by_path));

    Value untracked_path = parse(searcher.grep(Value(gmnew::json::Object{{"pattern", "needle_loose"}, {"path", "loose.txt"}})));
    check(untracked_path.find("ok") && !untracked_path.find("ok")->as_bool(), "untracked file path is refused");
    check(output_of(untracked_path) == "loose.txt is not tracked by git; grep does not search it", "untracked file reply says so in output: " + output_of(untracked_path));

    Value binary_path = parse(searcher.grep(Value(gmnew::json::Object{{"pattern", "needle"}, {"path", "blob.bin"}})));
    check(output_of(binary_path) == "blob.bin is not text; grep does not search it", "binary file reply says so in output: " + output_of(binary_path));

    Value at_limit = parse(searcher.grep(Value(gmnew::json::Object{{"pattern", std::string(200, 'a')}})));
    check(at_limit.find("ok") && at_limit.find("ok")->as_bool(), "a 200-character pattern is accepted");
    Value over_limit = parse(searcher.grep(Value(gmnew::json::Object{{"pattern", std::string(201, 'a')}})));
    check(over_limit.find("ok") && !over_limit.find("ok")->as_bool(), "a 201-character pattern is refused");
    check(over_limit.find("error") && over_limit.find("error")->as_string() == "pattern must be at most 200 characters; got 201",
          "pattern refusal names the limit and the length: " + output_of(over_limit));
    check(output_of(over_limit) == "pattern must be at most 200 characters; got 201", "pattern refusal is also in output");

    gmnew::SearchVerbs verbs(dir);
    Value file_root = verbs.call("grep", Value(gmnew::json::Object{{"pattern", "planWaves"}, {"root", "src/planner.js"}}));
    check(file_root.find("ok") && file_root.find("ok")->as_bool(), "grep accepts a file root");
    check(output_of(file_root).find("planner.js:1 function planWaves") != std::string::npos, "file root finds its line: " + output_of(file_root));

    Value file_root_untracked = verbs.call("grep", Value(gmnew::json::Object{{"pattern", "needle_loose"}, {"root", "loose.txt"}}));
    check(output_of(file_root_untracked) == "loose.txt is not tracked by git; grep does not search it",
          "file root that is untracked says so: " + output_of(file_root_untracked));

    Value file_root_search = verbs.call("search", Value(gmnew::json::Object{{"query", "planWaves"}, {"root", "src/planner.js"}}));
    check(file_root_search.find("error") && file_root_search.find("error")->as_string() == "refused: root is not a directory: src/planner.js",
          "search still refuses a file root: " + output_of(file_root_search));

    Value file_root_path = verbs.call("grep", Value(gmnew::json::Object{{"pattern", "planWaves"}, {"root", "src/planner.js"}, {"path", "src"}}));
    check(file_root_path.find("error") && file_root_path.find("error")->as_string() == "refused: path cannot be combined with a file root",
          "grep refuses path with a file root: " + output_of(file_root_path));

    Value bad = parse(searcher.grep(Value(gmnew::json::Object{{"pattern", "(["}, {"mode", "regex"}})));
    check(bad.find("ok") && !bad.find("ok")->as_bool(), "invalid regex is an error");
    check(bad.find("error") && bad.find("error")->as_string().rfind("bad pattern", 0) == 0, "invalid regex error text");

    fs::remove_all(dir);
    if (failures == 0) std::cout << "search tests passed\n";
    return failures == 0 ? 0 : 1;
}
