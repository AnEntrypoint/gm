#include <atomic>
#include <chrono>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <string>
#include <thread>
#include <vector>

#include "gm/json.hpp"
#include "gm/proc.hpp"
#include "search.hpp"
#include "search_impl.hpp"

namespace fs = std::filesystem;
using gm::json::Value;

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
    auto parsed = gm::json::parse(text);
    check(parsed.has_value(), "reply is JSON: " + text);
    return parsed ? *parsed : Value();
}

std::string output_of(const Value& reply) {
    const Value* out = reply.find("output");
    return out ? out->as_string() : std::string();
}

std::string hint_of(const Value& reply) {
    const Value* hint = reply.find("hint");
    return hint ? hint->as_string() : std::string();
}

}

int main() {
    fs::path dir = fs::temp_directory_path() / ("gm_search_test_" + std::to_string(std::rand()));
    fs::remove_all(dir);
    fs::create_directories(dir);
    write(dir / "a.txt", "nothing here\nplain text\n");
    write(dir / "src" / "planner.js", "function planWaves() {}\nconst x = 1;\n");
    write(dir / "node_modules" / "dep" / "index.js", "needle_in_vendor\n");
    write(dir / ".gitignore", "ignored.log\n");
    write(dir / "ignored.log", "needle_in_ignored\n");
    write(dir / "loose.txt", "needle_loose\n");
    write(dir / "blob.bin", std::string("needle\0bin\n", 11));
    write(dir / ".env", "TOGETHERAI=dummy_not_a_real_key_12345\n");
    write(dir / ".env.local", "LOCAL_ALIAS=dummy_not_a_real_key_67890\n");
    write(dir / "prod.env", "PROD_TOKEN=dummy_not_a_real_key_99999\n");
    gm::proc::run({"git", "init", "-q"}, dir);
    gm::proc::run({"git", "add", "-f", "a.txt", "src", ".gitignore", "node_modules", "blob.bin", ".env", ".env.local", "prod.env"}, dir);

    gm::search::Searcher searcher(dir);

    Value ranked = parse(searcher.search(Value(gm::json::Object{{"query", "waves"}})));
    check(ranked.find("ok") && ranked.find("ok")->as_bool(), "search ok");
    check(output_of(ranked).rfind("src/planner.js:1 ", 0) == 0, "search ranks the file with the term first: " + output_of(ranked));

    Value env_grep = parse(searcher.grep(Value(gm::json::Object{{"pattern", "TOGETHERAI"}})));
    check(output_of(env_grep).find(".env:1 TOGETHERAI=<redacted>") != std::string::npos, "grep masks a .env value: " + output_of(env_grep));
    check(output_of(env_grep).find("dummy_not_a_real_key_12345") == std::string::npos, "grep does not print a .env value");
    Value env_local_grep = parse(searcher.grep(Value(gm::json::Object{{"pattern", "LOCAL_ALIAS"}})));
    check(output_of(env_local_grep).find(".env.local:1 LOCAL_ALIAS=<redacted>") != std::string::npos, "grep masks a .env.local value: " + output_of(env_local_grep));
    check(output_of(env_local_grep).find("dummy_not_a_real_key_67890") == std::string::npos, "grep does not print a .env.local value");
    Value prod_grep = parse(searcher.grep(Value(gm::json::Object{{"pattern", "PROD_TOKEN"}})));
    check(output_of(prod_grep).find("prod.env:1 PROD_TOKEN=<redacted>") != std::string::npos, "grep masks a *.env value: " + output_of(prod_grep));
    check(output_of(prod_grep).find("dummy_not_a_real_key_99999") == std::string::npos, "grep does not print a *.env value");
    Value env_search = parse(searcher.search(Value(gm::json::Object{{"query", "togetherai"}, {"k", 5}})));
    check(output_of(env_search).find(".env:1 ") != std::string::npos && output_of(env_search).find("TOGETHERAI=<redacted>") != std::string::npos, "search masks a .env value: " + output_of(env_search));
    check(output_of(env_search).find("dummy_not_a_real_key_12345") == std::string::npos, "search does not print a .env value");

    Value literal = parse(searcher.grep(Value(gm::json::Object{{"pattern", "plain text"}})));
    check(output_of(literal).find("a.txt:2 plain text") != std::string::npos, "grep literal");

    Value regex = parse(searcher.grep(Value(gm::json::Object{{"pattern", "plan[A-Z]\\w+"}, {"mode", "regex"}})));
    check(output_of(regex).find("src/planner.js:1") != std::string::npos, "grep regex");

    Value fallback = parse(searcher.grep(Value(gm::json::Object{{"pattern", "plan.aves"}})));
    check(hint_of(fallback) == "no literal match; matched as regex" && output_of(fallback).find("hint:") == std::string::npos,
          "literal falls back to regex, and the hint is a field: " + output_of(fallback));

    Value tracked_skip = parse(searcher.grep(Value(gm::json::Object{{"pattern", "needle_in"}, {"vendor", false}})));
    check(hint_of(tracked_skip).rfind("2 files skipped (1 in node_modules or vendor, 1 gitignored); use scope: 'all' to include them", 0) == 0 &&
              output_of(tracked_skip).rfind("(0 matches", 0) == 0,
          "zero-match hint is the hint field, and output starts with the footer: " + output_of(tracked_skip));

    Value loose_found = parse(searcher.grep(Value(gm::json::Object{{"pattern", "needle_loose"}})));
    check(output_of(loose_found).find("loose.txt:1 needle_loose") != std::string::npos,
          "default scope finds an untracked file that git does not ignore: " + output_of(loose_found));

    Value all = parse(searcher.grep(Value(gm::json::Object{{"pattern", "needle_in"}, {"scope", "all"}})));
    check(output_of(all).find("ignored.log:1") != std::string::npos, "scope all finds gitignored file: " + output_of(all));

    Value by_path = parse(searcher.grep(Value(gm::json::Object{{"pattern", "plain text"}, {"path", "a.txt"}})));
    check(output_of(by_path).find("a.txt:2 plain text") != std::string::npos, "grep path names one tracked file: " + output_of(by_path));

    Value untracked_path = parse(searcher.grep(Value(gm::json::Object{{"pattern", "needle_loose"}, {"path", "loose.txt"}})));
    check(untracked_path.find("ok") && !untracked_path.find("ok")->as_bool(), "untracked file path is refused");
    check(output_of(untracked_path) == "loose.txt is not tracked by git; grep does not search it", "untracked file reply says so in output: " + output_of(untracked_path));

    Value binary_path = parse(searcher.grep(Value(gm::json::Object{{"pattern", "needle"}, {"path", "blob.bin"}})));
    check(output_of(binary_path) == "blob.bin is not text; grep does not search it", "binary file reply says so in output: " + output_of(binary_path));

    Value at_limit = parse(searcher.grep(Value(gm::json::Object{{"pattern", std::string(200, 'a')}})));
    check(at_limit.find("ok") && at_limit.find("ok")->as_bool(), "a 200-character pattern is accepted");
    Value over_limit = parse(searcher.grep(Value(gm::json::Object{{"pattern", std::string(201, 'a')}})));
    check(over_limit.find("ok") && !over_limit.find("ok")->as_bool(), "a 201-character pattern is refused");
    check(over_limit.find("error") && over_limit.find("error")->as_string() == "pattern must be at most 200 characters; got 201",
          "pattern refusal names the limit and the length: " + output_of(over_limit));
    check(output_of(over_limit) == "pattern must be at most 200 characters; got 201", "pattern refusal is also in output");

    gm::SearchVerbs verbs(dir);
    Value file_root = verbs.call("grep", Value(gm::json::Object{{"pattern", "planWaves"}, {"root", "src/planner.js"}}));
    check(file_root.find("ok") && file_root.find("ok")->as_bool(), "grep accepts a file root");
    check(output_of(file_root).find("planner.js:1 function planWaves") != std::string::npos, "file root finds its line: " + output_of(file_root));

    Value file_root_untracked = verbs.call("grep", Value(gm::json::Object{{"pattern", "needle_loose"}, {"root", "loose.txt"}}));
    check(output_of(file_root_untracked) == "loose.txt is not tracked by git; grep does not search it",
          "file root that is untracked says so: " + output_of(file_root_untracked));

    Value untracked_path_all = parse(searcher.grep(Value(gm::json::Object{{"pattern", "needle_loose"}, {"path", "loose.txt"}, {"scope", "all"}})));
    check(output_of(untracked_path_all).find("loose.txt:1 needle_loose") != std::string::npos,
          "scope all finds an untracked file path: " + output_of(untracked_path_all));

    Value ignored_path = parse(searcher.grep(Value(gm::json::Object{{"pattern", "needle_in_ignored"}, {"path", "ignored.log"}})));
    check(ignored_path.find("ok") && !ignored_path.find("ok")->as_bool() && output_of(ignored_path).find("needle_in_ignored") == std::string::npos,
          "default scope still excludes a gitignored file path: " + output_of(ignored_path));

    Value ignored_path_all = parse(searcher.grep(Value(gm::json::Object{{"pattern", "needle_in_ignored"}, {"path", "ignored.log"}, {"scope", "all"}})));
    check(output_of(ignored_path_all).find("ignored.log:1 needle_in_ignored") != std::string::npos,
          "scope all finds a gitignored file path: " + output_of(ignored_path_all));

    Value file_root_untracked_all = verbs.call("grep", Value(gm::json::Object{{"pattern", "needle_loose"}, {"root", "loose.txt"}, {"scope", "all"}}));
    check(output_of(file_root_untracked_all).find("loose.txt:1 needle_loose") != std::string::npos,
          "scope all finds an untracked file root: " + output_of(file_root_untracked_all));

    Value file_root_search = verbs.call("search", Value(gm::json::Object{{"query", "planWaves"}, {"root", "src/planner.js"}}));
    check(file_root_search.find("error") && file_root_search.find("error")->as_string() == "refused: root is not a directory: src/planner.js",
          "search still refuses a file root: " + output_of(file_root_search));

    Value file_root_path = verbs.call("grep", Value(gm::json::Object{{"pattern", "planWaves"}, {"root", "src/planner.js"}, {"path", "src"}}));
    check(file_root_path.find("error") && file_root_path.find("error")->as_string() == "refused: path cannot be combined with a file root",
          "grep refuses path with a file root: " + output_of(file_root_path));

    Value bad = parse(searcher.grep(Value(gm::json::Object{{"pattern", "(["}, {"mode", "regex"}})));
    check(bad.find("ok") && !bad.find("ok")->as_bool(), "invalid regex is an error");
    check(bad.find("error") && bad.find("error")->as_string().rfind("bad pattern", 0) == 0, "invalid regex error text");

    fs::path plain = fs::temp_directory_path() / ("gm_search_plain_" + std::to_string(std::rand()));
    fs::remove_all(plain);
    write(plain / "notes.txt", "planWaves in a plain folder\n");
    Value plain_search = parse(gm::search::Searcher(plain).search(Value(gm::json::Object{{"query", "waves"}})));
    check(plain_search.find("ok") && plain_search.find("ok")->as_bool(), "search accepts a folder outside git");
    check(output_of(plain_search).rfind("notes.txt:1 ", 0) == 0, "search walks a folder outside git: " + output_of(plain_search));
    fs::create_directories(plain / "empty");
    Value plain_empty = parse(gm::search::Searcher(plain / "empty").search(Value(gm::json::Object{{"query", "waves"}})));
    check(plain_empty.find("ok") && !plain_empty.find("ok")->as_bool(), "search refuses a folder with no files");
    fs::remove_all(plain);

    fs::path stable = fs::temp_directory_path() / ("gm_search_stable_" + std::to_string(std::rand()));
    fs::remove_all(stable);
    write(stable / "stable.txt", "guest frame peer frames stall tick 810 rotation hero\n");
    gm::proc::run({"git", "init", "-q"}, stable);
    gm::proc::run({"git", "add", "-A"}, stable);
    std::this_thread::sleep_for(std::chrono::milliseconds(3100));
    gm::search::Searcher stable_searcher(stable);
    Value first = parse(stable_searcher.search(Value(gm::json::Object{{"query", "guest rotation"}})));
    Value again = parse(stable_searcher.search(Value(gm::json::Object{{"query", "guest rotation"}})));
    check(output_of(first).find("stable.txt:1 ") != std::string::npos, "first search on a settled tree ranks the line: " + output_of(first));
    check(output_of(again) == output_of(first), "a cached index stays valid on a second search: " + output_of(again));
    fs::remove_all(stable);

    fs::path concurrent = fs::temp_directory_path() / ("gm_search_concurrent_" + std::to_string(std::rand()));
    fs::remove_all(concurrent);
    for (int i = 0; i < 6; ++i)
        write(concurrent / ("root" + std::to_string(i)) / "doc.txt", "guest frame peer frames stall tick 810 rotation hero\n");
    gm::proc::run({"git", "init", "-q"}, concurrent);
    gm::proc::run({"git", "add", "-A"}, concurrent);
    gm::SearchVerbs shared(concurrent);
    std::atomic<int> concurrent_failures = 0;
    std::vector<std::thread> threads;
    for (int t = 0; t < 8; ++t) {
        threads.emplace_back([&, t] {
            for (int i = 0; i < 8; ++i) {
                std::string root = "root" + std::to_string((t + i) % 6);
                Value grepped = shared.call("grep", Value(gm::json::Object{{"pattern", "guest"}, {"root", root}}));
                Value ranked = shared.call("search", Value(gm::json::Object{{"query", "guest rotation"}, {"root", root}}));
                if (!grepped.find("ok") || !grepped.find("ok")->as_bool() || !ranked.find("ok") || !ranked.find("ok")->as_bool()) ++concurrent_failures;
            }
        });
    }
    for (std::thread& thread : threads) thread.join();
    check(concurrent_failures.load() == 0, "concurrent search and grep on one verb table all succeed: " + std::to_string(concurrent_failures.load()) + " failures");
    fs::remove_all(concurrent);

    fs::path wide = fs::temp_directory_path() / ("gm_search_wide_" + std::to_string(std::rand()));
    fs::remove_all(wide);
    write(wide / "hit.txt", "npm i install-everything\n");
    write(wide / "long.txt", "install" + std::string(999000, 'a') + "\n");
    gm::search::Searcher wide_searcher(wide);
    Value alternating = parse(wide_searcher.grep(Value(gm::json::Object{{"pattern", "npm i|bun i|install.*gm|gmnew install|install --"}, {"limit", 6}})));
    check(alternating.find("ok") && alternating.find("ok")->as_bool(), "the exact alternating pattern survives a 999000-character line: " + output_of(alternating));
    check(output_of(alternating).find("hit.txt:1 npm i install-everything") != std::string::npos, "the short hit is still reported: " + output_of(alternating));
    check(output_of(alternating).size() < 300, "a long line is truncated in the reply: " + std::to_string(output_of(alternating).size()));
    check(hint_of(alternating).find("no literal match; matched as regex") != std::string::npos, "the literal fallback still runs: " + hint_of(alternating));
    fs::remove_all(wide);

    fs::path bulk = fs::temp_directory_path() / ("gm_search_bulk_" + std::to_string(std::rand()));
    fs::remove_all(bulk);
    write(bulk / "0000-turn.txt", "scenarios/moba/turn_rates.lua turn_rates\n");
    write(bulk / "0001-fx.txt", "ability_fx effect mapping\n");
    for (int i = 0; i < 40; ++i) write(bulk / ("bulk" + std::to_string(i) + ".txt"), std::string(999000, 'a'));
    gm::search::Searcher bulk_searcher(bulk);
    Value bounded = parse(bulk_searcher.grep(Value(gm::json::Object{{"pattern", "needle_not_here"}})));
    check(bounded.find("ok") && bounded.find("ok")->as_bool(), "a root past the work budget returns normally: " + output_of(bounded));
    check(hint_of(bounded).find("scan budget hit: stopped after") != std::string::npos, "the work budget is reported in the hint: " + hint_of(bounded));
    check(output_of(bounded).rfind("(0 matches", 0) == 0, "the budget hit keeps the reply footer: " + output_of(bounded));
    Value alternation = parse(bulk_searcher.grep(Value(gm::json::Object{{"pattern", "turn_rates|ability_fx"}, {"mode", "content"}, {"limit", 10}})));
    check(output_of(alternation).find("0000-turn.txt:1 ") != std::string::npos, "the first alternation term matches past the scan budget: " + output_of(alternation));
    check(output_of(alternation).find("0001-fx.txt:1 ") != std::string::npos, "the second alternation term matches past the scan budget: " + output_of(alternation));
    check(hint_of(alternation).find("no literal match; matched as regex") != std::string::npos, "the regex retry runs on a budget-capped root: " + hint_of(alternation));
    fs::remove_all(bulk);

    fs::path long_lines = fs::temp_directory_path() / ("gm_search_long_lines_" + std::to_string(std::rand()));
    fs::remove_all(long_lines);
    const std::string marker = "LONG_MARK_9f3a";
    const std::string straddle = "STRADDLE_MARK_7b2c";
    write(long_lines / "long.txt", std::string(1500, 'x') + " " + marker + " " + std::string(1600, 'y') + "\n");
    write(long_lines / "boundary.txt", std::string(1018, 'a') + straddle + std::string(1600, 'z') + "\n");
    write(long_lines / ".env", "KEY=" + std::string(1500, 'v') + "SECRET_LONG_VALUE_7c1d\n");
    gm::search::Searcher long_searcher(long_lines);
    Value long_literal = parse(long_searcher.grep(Value(gm::json::Object{{"pattern", marker}})));
    check(output_of(long_literal).find("long.txt:1") != std::string::npos && output_of(long_literal).find(marker) != std::string::npos,
          "a literal hit past character 1024 is found and shown: " + output_of(long_literal));
    check(output_of(long_literal).find("(1 matches;") != std::string::npos, "the long-line literal counts one match: " + output_of(long_literal));
    check(hint_of(long_literal).find("bounded windows") != std::string::npos, "long lines are named in the hint: " + hint_of(long_literal));
    Value long_word = parse(long_searcher.grep(Value(gm::json::Object{{"pattern", marker}, {"mode", "word"}})));
    check(output_of(long_word).find("long.txt:1") != std::string::npos && output_of(long_word).find(marker) != std::string::npos,
          "a word hit past character 1024 is found and shown: " + output_of(long_word));
    Value long_regex = parse(long_searcher.grep(Value(gm::json::Object{{"pattern", "LONG_MARK.*9f3a"}, {"mode", "regex"}})));
    check(output_of(long_regex).find("long.txt:1") != std::string::npos && output_of(long_regex).find(marker) != std::string::npos,
          "a regex hit past character 1024 is found and shown: " + output_of(long_regex));
    Value straddle_regex = parse(long_searcher.grep(Value(gm::json::Object{{"pattern", straddle}, {"mode", "regex"}})));
    check(output_of(straddle_regex).find("boundary.txt:1") != std::string::npos && output_of(straddle_regex).find(straddle) != std::string::npos,
          "a regex hit across a window boundary is found: " + output_of(straddle_regex));
    Value long_env = parse(long_searcher.grep(Value(gm::json::Object{{"pattern", "SECRET_LONG_VALUE"}})));
    check(output_of(long_env).find("<redacted>") != std::string::npos && output_of(long_env).find("SECRET_LONG_VALUE_7c1d") == std::string::npos,
          "a long .env line never prints its value: " + output_of(long_env));
    fs::remove_all(long_lines);

    fs::path huge = fs::temp_directory_path() / ("gm_search_huge_" + std::to_string(std::rand()));
    fs::remove_all(huge);
    write(huge / "huge.txt", "install" + std::string(999000, 'a') + "\n");
    gm::search::Searcher huge_searcher(huge);
    auto begun = std::chrono::steady_clock::now();
    Value catastrophic = parse(huge_searcher.grep(Value(gm::json::Object{{"pattern", "install.*gm"}, {"mode", "regex"}})));
    long long elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - begun).count();
    check(catastrophic.find("ok") && catastrophic.find("ok")->as_bool(), "a catastrophic regex on a 999000-character line returns normally: " + output_of(catastrophic));
    check(output_of(catastrophic).rfind("(0 matches", 0) == 0, "the catastrophic regex reports no match: " + output_of(catastrophic));
    check(elapsed < 10000, "the catastrophic regex stays under the scan deadline: " + std::to_string(elapsed) + " ms");
    check(hint_of(catastrophic).find("bounded windows") != std::string::npos, "the bounded-window hint names the cap: " + hint_of(catastrophic));
    fs::remove_all(huge);

    fs::remove_all(dir);
    if (failures == 0) std::cout << "search tests passed\n";
    return failures == 0 ? 0 : 1;
}
