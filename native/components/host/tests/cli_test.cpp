#include <cstdio>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <string>

#include "gm/log.hpp"

#ifdef _WIN32
#define popen _popen
#define pclose _pclose
#endif

namespace {

namespace fs = std::filesystem;
int failures = 0;

void check(bool ok, const std::string& what) {
    std::cout << (ok ? "ok   " : "FAIL ") << what << '\n';
    if (!ok) ++failures;
}

std::string capture(const std::string& command) {
    std::string out;
    FILE* pipe = popen(command.c_str(), "r");
    if (pipe == nullptr) return out;
    char buffer[4096];
    while (std::size_t n = std::fread(buffer, 1, sizeof buffer, pipe)) out.append(buffer, n);
    pclose(pipe);
    return out;
}

std::string run_gm(const std::string& arguments) { return capture(std::string("\"") + GMNEW_BINARY + "\" " + arguments + " 2>&1"); }

}

int main() {
    const fs::path dir = fs::temp_directory_path() / "gm-cli-test-run";
    fs::remove_all(dir);
    fs::create_directories(dir);
    auto log = gm::RunLog::open(dir);
    check(log.has_value(), "run log opens");
    gm::json::Value first;
    first.set("tool", "run_code");
    log->append("action", first);
    gm::json::Value second;
    second.set("status", "ok");
    log->append("job", second);
    {
        std::ofstream queue(dir / "pending.jsonl");
        queue << "{\"id\":2,\"seq\":2,\"kind\":\"job\",\"status\":\"ok\"}\n";
    }
    const std::string d = "--dir \"" + dir.string() + "\"";

    check(run_gm("query " + d + " --js \"events.length\"") == "2\n", "query counts events");
    check(run_gm("query " + d + " --js \"events.map(e => e.kind)\"") == "[\"action\",\"job\"]\n", "query expression");
    check(run_gm("query " + d + " --js \"const x = events.length; return x + 1;\"") == "3\n", "query statement body falls back");
    check(run_gm("query " + d + " --js \"undefined\"") == "undefined\n", "query undefined");
    check(run_gm("query " + d + " --js \"events.nope.x\"").find("gm: query failed: ") == 0, "query error text");
    check(run_gm("query " + d).find("\"kind\":\"action\"") != std::string::npos, "query without js prints lines");

    check(run_gm("events " + d + " --wait") == "{\"id\":2,\"seq\":2,\"kind\":\"job\",\"status\":\"ok\"}\n", "events prints queued");
    check(run_gm("events " + d).empty(), "events prints nothing once cleared");
    check(run_gm("events " + d + " --wait --timeout-ms 300") == "events: timed out after 300 ms with no event pending\n", "events wait times out");
    check(!fs::exists(dir / "pending.jsonl"), "queue file consumed");

    fs::remove_all(dir);
    std::cout << (failures == 0 ? "cli_test passed" : "cli_test FAILED") << '\n';
    return failures == 0 ? 0 : 1;
}
