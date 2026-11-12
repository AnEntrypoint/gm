#include "gm/tool.hpp"

#include <chrono>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <system_error>
#include <thread>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

constexpr std::size_t kRefusalLimitBytes = 2000;
constexpr const char* kSample = "return (await gm.read_file({ path: 'sample.txt', fresh: true })).output;";

std::string read_text(const fs::path& file) {
    std::ifstream in(file, std::ios::binary);
    std::ostringstream text;
    text << in.rdbuf();
    return text.str();
}

std::size_t count_of(const std::string& text, const std::string& needle) {
    std::size_t count = 0;
    for (std::size_t at = text.find(needle); at != std::string::npos; at = text.find(needle, at + needle.size())) ++count;
    return count;
}

std::size_t restart_count(const fs::path& log) {
    std::size_t count = 0;
    std::istringstream lines(read_text(log));
    std::string line;
    while (std::getline(lines, line)) {
        if (line.find("\"kind\":\"restart\"") != std::string::npos) ++count;
    }
    return count;
}

fs::path checkout_skill() {
    for (fs::path dir = fs::current_path();; dir = dir.parent_path()) {
        std::error_code ec;
        if (fs::exists(dir / "skills" / "gm" / "SKILL.md", ec)) return dir / "skills" / "gm" / "SKILL.md";
        if (dir == dir.parent_path()) return {};
    }
}

bool contains_text(const json::Value& value, const std::string& needle) {
    return json::dump(value).find(needle) != std::string::npos;
}

bool flag(const json::Value& value, const std::string& key, bool expected) {
    const json::Value* found = value.is_object() ? value.find(key) : nullptr;
    return found != nullptr && found->is_bool() && found->as_bool() == expected;
}

json::Value gate_reply(const json::Value& rpc) {
    if (const json::Value* structured = value_at(rpc, "result.structuredContent")) return *structured;
    const json::Value* blocks = value_at(rpc, "result.content");
    if (blocks != nullptr && blocks->is_array() && !blocks->as_array().empty()) {
        if (auto parsed = json::parse(text_at(blocks->as_array().front(), "text"))) return *parsed;
    }
    return json::Value();
}

}

CheckResult check_no_resource_client(const std::string& binary) {
    CheckResult result;
    const auto started = std::chrono::steady_clock::now();
    const auto stamp = started.time_since_epoch().count();
    const fs::path scratch = fs::temp_directory_path() / ("gm-no-resource-client-" + std::to_string(stamp));
    const fs::path workspace = scratch / "ws";
    const fs::path bin_dir = scratch / "bin";
    fs::create_directories(workspace);
    fs::create_directories(bin_dir);
    std::ofstream(workspace / "sample.txt") << "tool-only client\n";
    std::ofstream(scratch / "quiet.json") << R"({"mcpServers":{"playwriter":{"disabled":true}}})";
    const fs::path host = fs::path(binary).parent_path();
    const fs::path engine = bin_dir / fs::path(binary).filename();
    fs::copy_file(binary, engine, fs::copy_options::overwrite_existing);
    fs::permissions(engine, fs::perms::owner_all | fs::perms::group_read | fs::perms::group_exec | fs::perms::others_read | fs::perms::others_exec, fs::perm_options::replace);
    for (const char* sub : {"leaves", "skills", "defaults"}) {
        std::error_code ec;
        if (fs::exists(host / sub, ec)) fs::copy(host / sub, bin_dir / sub, fs::copy_options::recursive, ec);
    }
    const fs::path disk_skill = checkout_skill();
    if (disk_skill.empty()) {
        result.failures.push_back("run from the checkout: no skills/gm/SKILL.md in the working directory or its parents");
        return result;
    }
    const std::string disk = read_text(disk_skill);
    const fs::path log = workspace / "runs" / "check" / "log.jsonl";
    {
        Session client(engine.string(), workspace, scratch, 180000, true);
        if (!client.started()) {
            result.failures.push_back("gm serve did not start from " + engine.string());
        } else {
            const json::Value init = client.rpc("initialize", json::Object{{"protocolVersion", "2025-06-18"}, {"capabilities", json::Object{}},
                                                                          {"clientInfo", json::Object{{"name", "no-resource-client-check"}, {"version", "1"}}}});
            if (value_at(init, "result") == nullptr) result.failures.push_back("no initialize result");
            client.notify("notifications/initialized", json::Object{});
            const json::Value listed = client.rpc("tools/list", json::Object{});
            bool has_run = false;
            bool has_next = false;
            if (const json::Value* tools = value_at(listed, "result.tools")) {
                if (tools->is_array()) {
                    for (const json::Value& tool : tools->as_array()) {
                        if (text_at(tool, "name") == "run_code") has_run = true;
                        if (text_at(tool, "name") == "next_context") has_next = true;
                    }
                }
            }
            if (!has_run || !has_next) result.failures.push_back("tools/list lacks run_code or next_context");

            const std::string marker_line = [&] {
                std::istringstream lines(disk);
                std::string line;
                while (std::getline(lines, line)) {
                    if (line.rfind("description:", 0) == 0) return line;
                }
                return std::string();
            }();
            const std::string escaped = json::dump(json::Value(marker_line)).substr(1, json::dump(json::Value(marker_line)).size() - 2);
            auto expect_refused = [&](const json::Value& rpc, const std::string& label) {
                const json::Value gated = gate_reply(rpc);
                const std::string error = text_at(gated, "error");
                if (!flag(gated, "ok", false) || error.rfind("run_code refused:", 0) != 0) result.failures.push_back(label + " was not refused: " + json::dump(gated).substr(0, 300));
                if (error.find("skill://gm/SKILL.md") == std::string::npos || error.find('\n') != std::string::npos)
                    result.failures.push_back(label + " does not name the skill read in one line: " + error);
                const std::string dump = json::dump(rpc);
                if (dump.size() > kRefusalLimitBytes) result.failures.push_back(label + " is " + std::to_string(dump.size()) + " bytes; it names the read and must not carry the skill");
                if (count_of(dump, escaped) != 0) result.failures.push_back(label + " embeds the skill text");
            };
            const json::Value run_args = json::Object{{"name", "run_code"}, {"arguments", json::Object{{"body", kSample}}}};

            expect_refused(client.rpc("tools/call", run_args), "the first run_code");
            expect_refused(client.rpc("tools/call", run_args), "the second run_code");
            const json::Value opened = tool_json(client, "next_context", json::Object{});
            if (!flag(opened, "ok", true)) result.failures.push_back("next_context was refused: " + json::dump(opened).substr(0, 200));
            expect_refused(client.rpc("tools/call", run_args), "the run_code after next_context");

            const std::size_t restarts_before = restart_count(log);
            fs::last_write_time(engine, fs::file_time_type::clock::now() + std::chrono::seconds(60));
            const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(60);
            while (restart_count(log) == restarts_before && std::chrono::steady_clock::now() < deadline) std::this_thread::sleep_for(std::chrono::milliseconds(100));
            if (restart_count(log) <= restarts_before) result.failures.push_back("no restart event in the run log within 60000 ms of the trigger");
            expect_refused(client.rpc("tools/call", run_args), "the run_code after a worker restart");

            const json::Value read = client.rpc("resources/read", json::Object{{"uri", "skill://gm/SKILL.md"}});
            if (value_at(read, "result.contents") == nullptr) result.failures.push_back("resources/read of the skill returned no contents: " + json::dump(read).substr(0, 200));
            const json::Value ran = tool_json(client, "run_code", json::Object{{"body", kSample}});
            if (!flag(ran, "ok", true) || !contains_text(ran, "tool-only client")) result.failures.push_back("run_code after resources/read did not run: " + json::dump(ran).substr(0, 300));
            const json::Value viaVerb = tool_json(client, "run_code", json::Object{{"body", "return (await gm.read_file({ path: 'skill://gm/SKILL.md' })).output.length;"}});
            if (!flag(viaVerb, "ok", true)) result.failures.push_back("gm.read_file of the skill uri failed in a body");
            else if (!output_value(viaVerb).is_number() || output_value(viaVerb).as_number() != static_cast<double>(disk.size())) result.failures.push_back("gm.read_file of the skill uri gave " + json::dump(output_value(viaVerb)) + " in a body; the file has " + std::to_string(disk.size()) + " bytes");
        }
        client.stop();
    }
    std::error_code ignored;
    fs::remove_all(scratch, ignored);
    const double wall = std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count();
    result.summary = "a client that never reads skill://gm/SKILL.md is refused on every run_code: before and after next_context, and after a worker restart; after resources/read on the connection its run_code runs and gm.read_file returns the whole skill (wall " + std::to_string(wall) + " s)";
    return result;
}

}
