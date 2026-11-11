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

constexpr const char* kSkill = "skill://gm/SKILL.md";

std::string read_text(const fs::path& file) {
    std::ifstream in(file, std::ios::binary);
    std::ostringstream text;
    text << in.rdbuf();
    return text.str();
}

std::optional<std::string> read_skill(Session& session) {
    const json::Value reply = session.rpc("resources/read", json::Object{{"uri", kSkill}});
    const json::Value* contents = value_at(reply, "result.contents");
    if (contents == nullptr || !contents->is_array() || contents->as_array().empty()) return std::nullopt;
    const json::Value* text = contents->as_array().front().find("text");
    if (text == nullptr || !text->is_string()) return std::nullopt;
    return text->as_string();
}

void open_connection(Session& session) {
    session.rpc("initialize", json::Object{{"protocolVersion", "2025-06-18"}, {"capabilities", json::Object{}},
                                          {"clientInfo", json::Object{{"name", "skill-serve-check"}, {"version", "1"}}}});
}

}

CheckResult check_skill_serve(const std::string& binary) {
    CheckResult result;
    const auto started = std::chrono::steady_clock::now();
    const auto stamp = started.time_since_epoch().count();
    const fs::path scratch = fs::temp_directory_path() / ("gm-skill-serve-" + std::to_string(stamp));
    const fs::path workspace = scratch / "ws";
    fs::create_directories(workspace);
    const fs::path binary_skill = fs::path(binary).parent_path() / "skills" / "gm" / "SKILL.md";
    {
        Session defaults(binary, workspace, scratch, 180000, true);
        if (!defaults.started()) {
            result.failures.push_back("default serve did not start from " + binary);
        } else {
            open_connection(defaults);
            const auto served = read_skill(defaults);
            const std::string disk = read_text(binary_skill);
            if (!served || *served != disk)
                result.failures.push_back("default serve: " + std::string(kSkill) + " is not the binary's skills/gm/SKILL.md (served " + (served ? std::to_string(served->size()) : std::string("nothing")) +
                                          " bytes, disk " + std::to_string(disk.size()) + " bytes)");
        }
        defaults.stop();
    }
    fs::path repo;
    for (fs::path dir = fs::current_path();; dir = dir.parent_path()) {
        std::error_code exists_ec;
        if (fs::exists(dir / "skills" / "gm" / "SKILL.md", exists_ec)) {
            repo = dir;
            break;
        }
        if (dir == dir.parent_path()) break;
    }
    if (repo.empty()) {
        result.failures.push_back("run from the checkout: no skills/gm/SKILL.md in the working directory or its parents");
    } else {
        const fs::path skills = scratch / "skills";
        fs::copy(repo / "skills", skills, fs::copy_options::recursive);
        const fs::path copy = skills / "gm" / "SKILL.md";
        const std::string before = read_text(copy);
        const std::string nonce = "served-after-change-" + std::to_string(started.time_since_epoch().count());
        Session live(binary, workspace, scratch, 180000, true, {"--skills", skills.string()});
        if (!live.started()) {
            result.failures.push_back("live serve did not start from " + binary);
        } else {
            open_connection(live);
            const auto first = read_skill(live);
            if (!first || *first != before) result.failures.push_back("live serve: first read is not the copy's text");
            std::ofstream(copy, std::ios::binary | std::ios::trunc) << before << "\n## Served Skill Witness\n\n" << nonce << "\n";
            const auto second = read_skill(live);
            if (!second || second->find(nonce) == std::string::npos) result.failures.push_back("live serve: read after a change on the same connection lacks " + nonce);
            if (!second || *second != read_text(copy)) result.failures.push_back("live serve: read after a change differs from the file on disk");
            std::ofstream(copy, std::ios::binary | std::ios::app) << "\n" << nonce << "-again\n";
            const auto third = read_skill(live);
            if (!third || third->find(nonce + "-again") == std::string::npos) result.failures.push_back("live serve: a second change is not served on the same connection");
        }
        live.stop();
    }
    std::error_code ignored;
    fs::remove_all(scratch, ignored);
    const double wall = std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count();
    result.summary = "the default serve returns the binary's " + std::string(kSkill) + ", and a live connection returns each change to the copied file on the next read (wall " + std::to_string(wall) + " s)";
    return result;
}

}
