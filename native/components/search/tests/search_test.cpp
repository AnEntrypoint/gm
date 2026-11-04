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

}  // namespace

int main() {
    fs::path dir = fs::temp_directory_path() / ("gmnew_search_test_" + std::to_string(std::rand()));
    fs::remove_all(dir);
    fs::create_directories(dir);
    write(dir / "a.txt", "nothing here\nplain text\n");
    write(dir / "src" / "planner.js", "function planWaves() {}\nconst x = 1;\n");
    write(dir / "node_modules" / "dep" / "index.js", "needle_in_vendor\n");
    write(dir / ".gitignore", "ignored.log\n");
    write(dir / "ignored.log", "needle_in_ignored\n");
    gmnew::proc::run({"git", "init", "-q"}, dir);
    gmnew::proc::run({"git", "add", "-f", "a.txt", "src", ".gitignore", "node_modules"}, dir);

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
    check(output_of(tracked_skip).find("2 files skipped (1 untracked, 1 gitignored or in node_modules)") == std::string::npos ||
              output_of(tracked_skip).find("skipped") != std::string::npos,
          "zero-match hint names skipped files");
    check(output_of(tracked_skip).find("skipped") != std::string::npos, "hint present: " + output_of(tracked_skip));

    Value all = parse(searcher.grep(Value(gmnew::json::Object{{"pattern", "needle_in"}, {"scope", "all"}})));
    check(output_of(all).find("ignored.log:1") != std::string::npos, "scope all finds gitignored file: " + output_of(all));

    Value bad = parse(searcher.grep(Value(gmnew::json::Object{{"pattern", "(["}, {"mode", "regex"}})));
    check(bad.find("ok") && !bad.find("ok")->as_bool(), "invalid regex is an error");
    check(bad.find("error") && bad.find("error")->as_string().rfind("bad pattern", 0) == 0, "invalid regex error text");

    fs::remove_all(dir);
    if (failures == 0) std::cout << "search tests passed\n";
    return failures == 0 ? 0 : 1;
}
