#pragma once

#include "gm/tool.hpp"

#include <chrono>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <string>
#include <system_error>
#include <vector>

namespace gm::tool::support {

namespace fs = std::filesystem;

inline std::string file_sha256(const fs::path& file) {
    for (const std::vector<std::string>& argv : {std::vector<std::string>{"sha256sum", file.string()}, std::vector<std::string>{"shasum", "-a", "256", file.string()}}) {
        const proc::Outcome run = proc::run(argv, {}, {}, 60000);
        if (run.started && run.exit_code == 0) {
            std::istringstream words(run.out);
            std::string digest;
            words >> digest;
            return digest;
        }
    }
    return {};
}

inline std::string read_text(const fs::path& file) {
    std::ifstream in(file, std::ios::binary);
    std::ostringstream text;
    text << in.rdbuf();
    return text.str();
}

inline void make_executable(const fs::path& file) {
    std::error_code ec;
    fs::permissions(file, fs::perms::owner_all | fs::perms::group_read | fs::perms::group_exec | fs::perms::others_read | fs::perms::others_exec, fs::perm_options::replace, ec);
}

inline std::string replace_all(std::string text, const std::string& from, const std::string& to) {
    for (std::size_t at = text.find(from); at != std::string::npos; at = text.find(from, at + to.size())) text.replace(at, from.size(), to);
    return text;
}

inline void point(const fs::path& install, const std::string& version) {
    const fs::path link = install / "current.tmp";
    std::error_code ec;
    fs::remove(link, ec);
    fs::create_directory_symlink(fs::path("versions") / version, link, ec);
    fs::rename(link, install / "current", ec);
}

inline std::vector<long long> children_of(long long pid) {
    std::vector<long long> found;
    for (long long child : process_tree({pid})) {
        if (child != pid) found.push_back(child);
    }
    return found;
}

inline void start_session(Session& session, const std::string& client) {
    session.rpc("initialize", json::Object{{"protocolVersion", "2025-06-18"}, {"capabilities", json::Object{}},
                                          {"clientInfo", json::Object{{"name", client}, {"version", "1"}}}});
    session.notify("notifications/initialized", json::Object{});
    session.rpc("resources/read", json::Object{{"uri", "skill://gm/SKILL.md"}});
    tool_json(session, "next_context", json::Object{});
}

inline void connect(Session& session) {
    start_session(session, "gm-tool");
}

inline fs::path fresh_sandbox(const std::string& label) {
    const auto stamp = std::chrono::steady_clock::now().time_since_epoch().count();
    const fs::path sandbox = fs::temp_directory_path() / ("gm-" + label + "-" + std::to_string(stamp));
    fs::create_directories(sandbox / "ws");
    std::ofstream(sandbox / "quiet.json") << R"({"mcpServers":{"playwriter":{"disabled":true}}})";
    return sandbox;
}

}
