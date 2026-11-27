#pragma once

#include "gm/tool.hpp"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <string>
#include <string_view>
#include <system_error>
#include <vector>

#if !defined(_WIN32)
#include <fcntl.h>
#include <unistd.h>
#endif

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

inline bool flag(const json::Value& value, const std::string& dotted, bool expected) {
    const json::Value* found = value_at(value, dotted);
    return found != nullptr && found->is_bool() && found->as_bool() == expected;
}

inline bool flag_of(const json::Value& value, const char* key) {
    return flag(value, key, true);
}

inline std::string text_of(const json::Value& value, const char* key) {
    const json::Value* found = value_at(value, key);
    return found != nullptr && found->is_string() ? found->as_string() : std::string();
}

inline double number_at(const json::Value& value, const std::string& dotted) {
    const json::Value* found = value_at(value, dotted);
    return found != nullptr && found->is_number() ? found->as_number() : -1;
}

inline bool contains(std::string_view text, std::string_view part) {
    return text.find(part) != std::string_view::npos;
}

inline std::string cause_of(const std::string& reply, std::size_t limit = 1500) {
    const std::size_t error = reply.find("Error executing code");
    return reply.substr(error == std::string::npos ? 0 : error, limit);
}

inline std::string replace_all(std::string text, const std::string& from, const std::string& to) {
    if (from.empty()) return text;
    std::string out;
    std::size_t start = 0;
    for (std::size_t at = text.find(from); at != std::string::npos; at = text.find(from, start)) {
        out.append(text, start, at - start);
        out += to;
        start = at + from.size();
    }
    out.append(text, start, std::string::npos);
    return out;
}

inline void point(const fs::path& install, const std::string& version) {
    const fs::path link = install / ("current." + std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()));
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

inline void initialize_session(Session& session, const std::string& client) {
    session.rpc("initialize", json::Object{{"protocolVersion", "2025-06-18"}, {"capabilities", json::Object{}},
                                          {"clientInfo", json::Object{{"name", client}, {"version", "1"}}}});
    session.notify("notifications/initialized", json::Object{});
}

inline void start_session(Session& session, const std::string& client) {
    initialize_session(session, client);
    session.rpc("resources/read", json::Object{{"uri", "skill://gm/SKILL.md"}});
    tool_json(session, "next_context", json::Object{});
}

inline void connect(Session& session) {
    start_session(session, "gm-tool");
}

inline fs::path fresh_sandbox(const std::string& label) {
    const auto stamp = std::chrono::steady_clock::now().time_since_epoch().count();
    const fs::path sandbox = fs::temp_directory_path() / ("gm-" + label + "-" + std::to_string(stamp % 1000000));
    fs::create_directories(sandbox / "ws");
    std::ofstream(sandbox / "quiet.json") << R"({"mcpServers":{"playwriter":{"disabled":true}}})";
    return sandbox;
}

#if !defined(_WIN32)
inline void write_script(const fs::path& file, const std::string& text) {
    const int fd = ::open(file.c_str(), O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC, 0644);
    if (fd < 0) return;
    const bool whole = ::write(fd, text.data(), text.size()) == static_cast<ssize_t>(text.size());
    ::close(fd);
    if (!whole) ::unlink(file.c_str());
}
#endif

inline std::vector<std::string> install_argv(const fs::path& home, const fs::path& gm, const fs::path& build, const fs::path& repo) {
    std::vector<std::string> argv{"env", "HOME=" + home.string(), "USERPROFILE=" + home.string()};
#if !defined(_WIN32)
    const fs::path offline_bin = home / "offline-bin";
    std::error_code ec;
    fs::create_directories(offline_bin, ec);
    const std::string patch_script = (offline_bin / "patch-package.js").string();
    write_script(offline_bin / "git", "#!/bin/sh\nif [ \"$1\" = clone ]; then for last; do :; done; mkdir -p \"$last\"; exit 0; fi\ncase \" $* \" in *\" apply \"*) mkdir -p bin && printf '%s\\n' 'CHROMIUM_ARGS_VARIABLE' 'lastBrowserLines' 'SCAN_TIME_PATTERN' 'WAIT_HINT_MS' 'START_REASON_CHARS' 'res.end(startReason(error.message))' 'BLANK_GRACE_MS' 'keepBrowser: true' 'gave no websocket address' '/__pwp/handoff' 'trimProfileCaches' 'listed === null' 'PLAYWRITER_RESTORE_SESSION' 'START_ATTEMPTS' 'rotateLog' 'fingerprintNote' 'an unrecorded browser' 'keepAnchor' 'HANDOVER_IDLE_MS' 'PLAYWRITER_RESTORE_SESSION !== ' >> bin/playwriter-project ;; esac\nexit 0\n");
    write_script(offline_bin / "npm", "#!/bin/sh\nmkdir -p node_modules/playwriter/dist node_modules/patch-package && cp '" + patch_script + "' node_modules/patch-package/index.js && printf '#!/bin/sh\\n' > node_modules/playwriter/bin.js && chmod 755 node_modules/playwriter/bin.js\n");
    write_script(offline_bin / "patch-package.js", "const fs = require('fs');\nconst path = require('path');\nconst dist = path.join(process.cwd(), 'node_modules', 'playwriter', 'dist');\nfs.mkdirSync(dist, { recursive: true });\nfs.writeFileSync(path.join(dist, 'executor.js'), 'process.env.PLAYWRITER_CHROMIUM_ARGS\\n...chromiumLaunchArgs(),\\nfunction displayStatus(\\nnamedByCall\\n');\n");
    for (const char* name : {"git", "npm"}) fs::permissions(offline_bin / name, fs::perms::owner_all | fs::perms::group_read | fs::perms::group_exec, fs::perm_options::replace, ec);
    const char* inherited = std::getenv("PATH");
    argv.push_back("PATH=" + offline_bin.string() + (inherited != nullptr ? ":" + std::string(inherited) : std::string()));
    argv.push_back("https_proxy=http://127.0.0.1:9");
    argv.push_back("HTTPS_PROXY=http://127.0.0.1:9");
#endif
    argv.insert(argv.end(), {gm.string(), "install", "--local", build.string(), "--source", repo.string()});
    return argv;
}

inline std::string failure_text(const proc::Outcome& outcome) {
    if (outcome.timed_out) return "timed out";
    return (outcome.err.empty() ? outcome.out : outcome.err).substr(0, 300);
}

inline std::string stage_install(const fs::path& host, const fs::path& repo, const fs::path& install) {
    std::error_code ec;
    fs::create_directories(install, ec);
    for (const char* name : {"gm", "gm-core"}) {
        fs::copy_file(host / name, install / name, fs::copy_options::overwrite_existing, ec);
        if (ec) return std::string("could not stage ") + name + ": " + ec.message();
    }
    for (const char* name : {"leaves", "skills", "defaults"}) {
        const fs::path from = fs::exists(host / name) ? host / name : repo / (std::string(name) == "leaves" ? "native/leaves" : name);
        fs::copy(from, install / name, fs::copy_options::recursive | fs::copy_options::overwrite_existing, ec);
        if (ec) return std::string("could not stage ") + name + ": " + ec.message();
    }
    return {};
}

inline std::string first_word(const std::string& text) {
    const auto start = text.find_first_not_of(" \t\r\n");
    if (start == std::string::npos) return {};
    return text.substr(start, text.find_first_of(" \t\r\n", start) - start);
}

inline bool absent(const json::Value& value, const std::string& dotted) {
    return value_at(value, dotted) == nullptr;
}

inline bool ends_with(const std::string& text, const std::string& tail) {
    return text.size() >= tail.size() && text.compare(text.size() - tail.size(), tail.size(), tail) == 0;
}

inline json::Value envelope_of(const json::Value& reply) {
    const json::Value* result = reply.find("result");
    const json::Value* content = result ? result->find("content") : nullptr;
    const json::Value* first = content && content->is_array() && !content->as_array().empty() ? content->as_array().front().find("text") : nullptr;
    const std::string text = first && first->is_string() ? first->as_string() : json::dump(reply);
    auto parsed = json::parse(text);
    if (!parsed) return json::Object{{"ok", false}, {"error", "run_code reply was not JSON: " + text.substr(0, 200)}};
    json::Value envelope = *parsed;
    const json::Value* output = envelope.find("output");
    const bool placeholder = output != nullptr && output->is_string() && output->as_string() == "[the output is the text block after this one]";
    if (placeholder && content->as_array().size() > 1) {
        const json::Value* second = content->as_array()[1].find("text");
        const std::string value = second != nullptr && second->is_string() ? second->as_string() : std::string();
        if (auto value_json = json::parse(value)) envelope.set("output", *value_json);
        else envelope.set("output", value);
    }
    return envelope;
}

inline fs::path checkout_root() {
    std::error_code ec;
    for (fs::path dir = fs::current_path(ec); !dir.empty(); dir = dir.parent_path()) {
        if (fs::exists(dir / "skills" / "gm" / "SKILL.md", ec)) return dir;
        if (dir == dir.parent_path()) break;
    }
    return {};
}

inline bool is_zombie(long long pid) {
#if defined(__linux__)
    const std::string text = proc::read_text_of("/proc/" + std::to_string(pid) + "/stat");
    const std::size_t close = text.rfind(')');
    return close != std::string::npos && close + 2 < text.size() && text[close + 2] == 'Z';
#else
    const proc::Outcome state = proc::run({"ps", "-o", "stat=", "-p", std::to_string(pid)}, {}, {}, 5000);
    return state.out.find('Z') != std::string::npos;
#endif
}

inline bool has_exited(long long pid) {
    return proc::start_time_of(pid) == 0 || is_zombie(pid);
}

inline bool number_is(const json::Value& value, const std::string& dotted, double expected) {
    const json::Value* found = value_at(value, dotted);
    return found != nullptr && found->is_number() && found->as_number() == expected;
}

inline std::optional<json::Value> reply_of(const std::string& text) {
    auto parsed = json::parse(text);
    if (!parsed || !parsed->is_object()) return std::nullopt;
    return *parsed;
}

inline long long resident_kb(long long pid) {
    return proc::resident_kb(pid);
}

inline constexpr double kClock = 1.0 / 60.0;

inline std::int64_t scaled(std::int64_t ms) {
    return std::max<std::int64_t>(1, static_cast<std::int64_t>(std::llround(static_cast<double>(ms) * kClock)));
}

inline bool succeeded(const proc::Outcome& outcome) {
    return outcome.started && !outcome.timed_out && outcome.exit_code == 0;
}

inline std::string tail_of(const std::string& text, std::size_t count) {
    return text.size() > count ? text.substr(text.size() - count) : text;
}

inline std::optional<std::int64_t> whole_number(const std::string& text) {
    if (text.empty() || text.size() > 18 || text.find_first_not_of("0123456789") != std::string::npos) return std::nullopt;
    return std::stoll(text);
}

inline long long worker_pid(const Session& session) {
    for (const long long pid : session.descendants()) {
        if (proc::process_exe(pid).filename() == "gm-core") return pid;
    }
    return -1;
}

}

namespace gm::tool {
using namespace support;
}
