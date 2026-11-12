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

constexpr std::size_t kRefusalLimitBytes = 1000;
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

            const json::Value refusal = client.rpc("tools/call", json::Object{{"name", "run_code"}, {"arguments", json::Object{{"body", kSample}}}});
            const json::Value* refusal_result = value_at(refusal, "result");
            const json::Value* refusal_blocks = refusal_result != nullptr ? value_at(*refusal_result, "content") : nullptr;
            const std::string refusal_dump = json::dump(refusal);
            const std::size_t refusal_bytes = refusal_dump.size();
            json::Value gated;
            if (const json::Value* structured = value_at(refusal, "result.structuredContent")) {
                gated = *structured;
            } else if (refusal_blocks != nullptr && refusal_blocks->is_array() && !refusal_blocks->as_array().empty()) {
                if (auto parsed = json::parse(text_at(refusal_blocks->as_array().front(), "text"))) gated = *parsed;
            }
            if (!flag(gated, "ok", false) || text_at(gated, "error").rfind("run_code refused:", 0) != 0)
                result.failures.push_back("the first run_code was not refused: " + json::dump(gated).substr(0, 300));
            const std::string refusal_error = text_at(gated, "error");
            if (refusal_error.find("skill://gm/SKILL.md") == std::string::npos || refusal_error.find('\n') != std::string::npos)
                result.failures.push_back("the refusal does not name the skill read in one line: " + refusal_error);
            const std::string marker_line = [&] {
                std::istringstream lines(disk);
                std::string line;
                while (std::getline(lines, line)) {
                    if (line.rfind("description:", 0) == 0) return line;
                }
                return std::string();
            }();
            const std::string escaped = json::dump(json::Value(marker_line)).substr(1, json::dump(json::Value(marker_line)).size() - 2);
            if (count_of(refusal_dump, escaped) != 0) result.failures.push_back("the refusal embeds the skill text");
            if (refusal_bytes > kRefusalLimitBytes) result.failures.push_back("the refusal is " + std::to_string(refusal_bytes) + " bytes; it names the read step and does not carry the skill");
            if (value_at(gated, "rulesNotice") != nullptr) result.failures.push_back("the refusal carries a rules notice");

            const json::Value early = tool_json(client, "run_code", json::Object{{"body", kSample}});
            if (!flag(early, "ok", true) || !contains_text(early, "tool-only client")) result.failures.push_back("the second run_code did not run its body: " + json::dump(early).substr(0, 300));
            if (text_at(early, "rulesNotice").find("rule 2") == std::string::npos) result.failures.push_back("run_code before next_context has no rule 2 notice");

            const json::Value first = tool_json(client, "next_context", json::Object{});
            if (!flag(first, "ok", true) || value_at(first, "step") == nullptr || value_at(first, "step")->as_number() != 1) result.failures.push_back("next_context did not open step 1: " + json::dump(first).substr(0, 200));
            if (text_at(first, "rulesPending").find("rule 2") == std::string::npos) result.failures.push_back("the first next_context does not report rule 2 once");

            const json::Value after = tool_json(client, "run_code", json::Object{{"body", kSample}});
            if (!flag(after, "ok", true) || !contains_text(after, "tool-only client")) result.failures.push_back("run_code after next_context did not run: " + json::dump(after).substr(0, 300));
            if (value_at(after, "rulesNotice") != nullptr) result.failures.push_back("the rule 2 notice is still on run_code after a correct next_context");

            const json::Value viaVerb = tool_json(client, "run_code", json::Object{{"body", "return (await gm.read_file({ path: 'skill://gm/SKILL.md' })).output.length;"}});
            if (!flag(viaVerb, "ok", true)) result.failures.push_back("gm.read_file of the skill uri failed in a body");

            const json::Value second = tool_json(client, "next_context", json::Object{});
            if (!flag(second, "ok", true) || !flag(second, "unchanged", true)) result.failures.push_back("the second next_context, with nothing new, is not the unchanged reply");
            if (value_at(second, "rulesPending") != nullptr) result.failures.push_back("the second next_context still has rulesPending");

            const std::size_t restarts_before = restart_count(log);
            fs::last_write_time(engine, fs::file_time_type::clock::now() + std::chrono::seconds(60));
            const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(60);
            while (restart_count(log) == restarts_before && std::chrono::steady_clock::now() < deadline) std::this_thread::sleep_for(std::chrono::milliseconds(100));
            if (restart_count(log) <= restarts_before) result.failures.push_back("no restart event in the run log within 60000 ms of the trigger");

            const json::Value after_restart = tool_json(client, "run_code", json::Object{{"body", kSample}});
            if (!flag(after_restart, "ok", true) || !contains_text(after_restart, "tool-only client")) result.failures.push_back("run_code after a worker restart did not run for the tool-only client");
            const json::Value finished = tool_json(client, "finish", json::Object{{"witness", "run_code returned \"tool-only client\" from sample.txt with no resources/read on the connection"}});
            if (!flag(finished, "ok", true) || !flag(finished, "finished", true)) result.failures.push_back("finish was refused: " + json::dump(finished).substr(0, 200));
        }
        client.stop();
    }
    std::error_code ignored;
    fs::remove_all(scratch, ignored);
    const double wall = std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count();
    result.summary = "with only initialize, tools/list and tools/call, the first run_code is refused once with one copy of the skill text; the next run_code runs after next_context; a worker restart keeps the tool-only client working (wall " + std::to_string(wall) + " s)";
    return result;
}

}
