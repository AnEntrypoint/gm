#include "support.hpp"

#include <chrono>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <thread>

namespace gm::tool {

#if defined(_WIN32)

CheckResult check_lazy_cache(const std::string&) {
    CheckResult result;
    result.summary = "skipped: POSIX-only check, runs on Linux and macOS";
    return result;
}

#else

using namespace support;

namespace {

namespace fs = std::filesystem;

std::vector<long long> playwriter_of(const std::vector<long long>& pids) {
    std::vector<long long> found;
    for (const long long pid : pids) {
        std::string text;
        for (const std::string& part : proc::command_of(pid)) {
            if (!text.empty()) text += ' ';
            text += part;
        }
        if (text.find("playwriter") != std::string::npos) found.push_back(pid);
    }
    return found;
}

bool file_within(const fs::path& file, std::chrono::milliseconds limit) {
    const auto deadline = std::chrono::steady_clock::now() + limit;
    std::error_code ec;
    while (!fs::exists(file, ec)) {
        if (std::chrono::steady_clock::now() >= deadline) return false;
        std::this_thread::sleep_for(std::chrono::milliseconds(200));
    }
    return true;
}

bool gone_within(const std::vector<long long>& pids, std::chrono::milliseconds limit) {
    const auto deadline = std::chrono::steady_clock::now() + limit;
    while (!alive_of(pids).empty()) {
        if (std::chrono::steady_clock::now() >= deadline) return false;
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }
    return true;
}

}

CheckResult check_lazy_cache(const std::string& binary) {
    CheckResult result;
    const auto stamp = std::chrono::steady_clock::now().time_since_epoch().count();
    const fs::path scratch = fs::temp_directory_path() / ("gm-lazy-cache-" + std::to_string(stamp));
    const fs::path workspace = scratch / "ws";
    const fs::path home = scratch / "home";
    const fs::path bin_dir = scratch / "bin";
    const fs::path engine = bin_dir / fs::path(binary).filename();
    const fs::path cache = bin_dir / "defaults" / "mcp-tools" / "playwriter.json";
    std::error_code ignored;
    fs::create_directories(workspace);
    fs::create_directories(home / ".gmnew");
    fs::create_directories(bin_dir);
    const fs::path host = fs::path(binary).parent_path();
    fs::copy_file(binary, engine, fs::copy_options::overwrite_existing);
    make_executable(engine);
    for (const char* sub : {"leaves", "skills", "defaults"}) {
        std::error_code ec;
        if (fs::exists(host / sub, ec)) fs::copy(host / sub, bin_dir / sub, fs::copy_options::recursive, ec);
    }
    fs::remove_all(bin_dir / "defaults" / "mcp-tools", ignored);
    const char* real_home = std::getenv("HOME");
    const fs::path installed_pw = fs::path(real_home == nullptr ? "" : real_home) / ".gmnew" / "pw";
    std::error_code linked;
    if (real_home == nullptr || !fs::is_directory(installed_pw, linked)) {
        result.failures.push_back("no installed playwriter package at " + installed_pw.string() + "; this check reuses it and never installs one");
        fs::remove_all(scratch, ignored);
        return result;
    }
    std::error_code link_ec;
    fs::create_directory_symlink(installed_pw, home / ".gmnew" / "pw", link_ec);
    if (link_ec) result.failures.push_back("cannot link " + installed_pw.string() + " into the sandbox: " + link_ec.message());

    std::vector<long long> first_gates;
    {
        Session first(engine.string(), workspace, home, 480000, false);
        if (!first.started()) {
            result.failures.push_back("gm serve did not start from " + engine.string());
        } else {
            start_session(first, "lazy-cache-check");
            if (!file_within(cache, std::chrono::seconds(240))) {
                result.failures.push_back("the first worker wrote no tool cache at " + cache.string() + ": its tools/list was not saved");
            } else {
                const auto parsed = json::parse(read_text(cache));
                const json::Value* listed = parsed && parsed->is_object() ? parsed->find("tools") : nullptr;
                if (listed == nullptr || !listed->is_array() || listed->as_array().empty())
                    result.failures.push_back("the tool cache " + cache.string() + " has no non-empty tools array");
            }
            first_gates = playwriter_of(first.descendants());
            if (first_gates.empty()) result.failures.push_back("the first worker started no playwriter gate, so there was no discovery to cache");
            first.stop();
        }
    }
    if (!first_gates.empty() && !gone_within(first_gates, std::chrono::seconds(15)))
        result.failures.push_back("the first worker's gate was still alive 15 s after its owner released it");

    std::vector<long long> second_gates;
    {
        Session second(engine.string(), workspace, home, 300000, false);
        if (!second.started()) {
            result.failures.push_back("the second worker did not start from " + engine.string());
        } else {
            start_session(second, "lazy-cache-check");
            std::this_thread::sleep_for(std::chrono::seconds(5));
            second_gates = playwriter_of(second.descendants());
            const std::string verbs = json::dump(output_value(tool_json(second, "run_code", json::Object{{"format", "esm"}, {"timeoutMs", 30000}, {"body", "return JSON.stringify(gm.verbs().map((v) => v.name).filter((n) => n.startsWith('playwriter_')));"}})));
            const std::vector<long long> after_listing = playwriter_of(second.descendants());
            second_gates.insert(second_gates.end(), after_listing.begin(), after_listing.end());
            if (verbs.find("playwriter_execute") == std::string::npos)
                result.failures.push_back("the second worker lists no playwriter_execute verb although the cache holds its tools: " + verbs.substr(0, 200));
            second.stop();
        }
    }
    if (!second_gates.empty())
        result.failures.push_back("a second worker on the same home started " + std::to_string(second_gates.size()) + " playwriter gate process(es) although the cache holds its tools");

    std::vector<long long> spawned = first_gates;
    spawned.insert(spawned.end(), second_gates.begin(), second_gates.end());
    kill_processes(processes_mentioning(scratch.string()));
    if (!gone_within(spawned, std::chrono::seconds(5)))
        result.failures.push_back(std::to_string(alive_of(spawned).size()) + " playwriter gate process(es) of this check are still alive after cleanup");
    fs::remove_all(scratch, ignored);
    if (result.failures.empty())
        result.summary = "a lazy playwriter client with no tool cache discovers its tools on the first worker and writes them to the cache; after its owner releases the gate, a second worker on the same home starts no gate and lists playwriter_execute from the cache";
    return result;
}

#endif

}
