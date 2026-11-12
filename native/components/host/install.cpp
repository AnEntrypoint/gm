#include "gm/host/install.hpp"

#include <chrono>
#include <cstdlib>
#include <map>
#include <vector>
#include <fstream>
#include <utility>
#include <iostream>
#include <sstream>
#include <system_error>

#include "gm/host/child.hpp"
#include "gm/host/update.hpp"
#include "gm/json.hpp"
#include "gm/proc.hpp"

namespace gm::host {
namespace {

namespace fs = std::filesystem;
constexpr int kMergeAttempts = 5;

std::optional<std::string> read_if_exists(const fs::path& file, std::string& text) {
    std::error_code ec;
    text.clear();
    if (!fs::exists(file, ec)) return std::nullopt;
    std::ifstream in(file, std::ios::binary);
    if (!in) return "cannot read " + file.string();
    std::ostringstream buffer;
    buffer << in.rdbuf();
    text = buffer.str();
    return std::nullopt;
}

bool blank(const std::string& text) { return text.find_first_not_of(" \t\r\n") == std::string::npos; }

std::optional<std::string> merged_config(const std::string& existing, const std::string& name,
                                         const json::Value& entry, std::string& out) {
    json::Value root = json::Object{};
    if (!blank(existing)) {
        auto parsed = json::parse(existing);
        if (!parsed) return "config is not JSON, left untouched: " + parsed.error();
        root = *parsed;
    }
    if (!root.is_object()) return "config is not a JSON object, left untouched";
    json::Value servers = json::Object{};
    if (const json::Value* found = root.find("mcpServers")) {
        if (!found->is_object()) return "mcpServers is not an object, left untouched";
        servers = *found;
    }
    servers.set(name, entry);
    root.set("mcpServers", servers);
    out = json::dump(root) + "\n";
    return std::nullopt;
}

}

std::optional<fs::path> claude_config_path() {
#if defined(_WIN32)
    const char* home = std::getenv("USERPROFILE");
#else
    const char* home = std::getenv("HOME");
#endif
    if (home == nullptr || *home == '\0') return std::nullopt;
    return fs::path(home) / ".claude.json";
}

std::optional<std::string> register_mcp_server(const fs::path& config, const std::string& name,
                                               const std::string& command, const std::vector<std::string>& args) {
    json::Array argv;
    for (const std::string& arg : args) argv.push_back(json::Value(arg));
    json::Value entry = json::Object{};
    entry.set("command", json::Value(command));
    entry.set("args", json::Value(argv));

    const fs::path temp = config.string() + ".gm-tmp";
    for (int attempt = 0; attempt < kMergeAttempts; ++attempt) {
        std::string before;
        if (auto error = read_if_exists(config, before)) return error;
        std::string text;
        if (auto error = merged_config(before, name, entry, text)) return error;
        if (text == before) return std::nullopt;

        {
            std::ofstream out(temp, std::ios::binary | std::ios::trunc);
            if (!out) return "cannot write " + temp.string();
            out << text;
            if (!out) return "cannot write " + temp.string();
        }

        std::string now;
        if (auto error = read_if_exists(config, now)) {
            std::error_code ignored;
            fs::remove(temp, ignored);
            return error;
        }
        if (now != before) {
            std::error_code ignored;
            fs::remove(temp, ignored);
            continue;
        }

        std::error_code ec;
        fs::rename(temp, config, ec);
        if (ec) {
            std::error_code ignored;
            fs::remove(temp, ignored);
            return "cannot replace " + config.string() + ": " + ec.message();
        }
        return std::nullopt;
    }
    return "the config kept changing while it was being written; nothing was written";
}

std::optional<std::string> unregister_mcp_server(const fs::path& config, const std::string& name) {
    const fs::path temp = config.string() + ".gm-tmp";
    for (int attempt = 0; attempt < kMergeAttempts; ++attempt) {
        std::string before;
        if (auto error = read_if_exists(config, before)) return error;
        if (blank(before)) return std::nullopt;
        auto parsed = json::parse(before);
        if (!parsed) return "config is not JSON, left untouched: " + parsed.error();
        if (!parsed->is_object()) return "config is not a JSON object, left untouched";
        const json::Value* found = parsed->find("mcpServers");
        if (found == nullptr) return std::nullopt;
        if (!found->is_object()) return "mcpServers is not an object, left untouched";
        if (found->find(name) == nullptr) return std::nullopt;
        json::Object kept;
        for (const auto& member : found->as_object())
            if (member.first != name) kept.push_back(member);
        json::Value root = *parsed;
        root.set("mcpServers", json::Value(kept));
        const std::string text = json::dump(root) + "\n";
        {
            std::ofstream out(temp, std::ios::binary | std::ios::trunc);
            if (!out) return "cannot write " + temp.string();
            out << text;
            if (!out) return "cannot write " + temp.string();
        }
        std::string now;
        if (auto error = read_if_exists(config, now)) {
            std::error_code ignored;
            fs::remove(temp, ignored);
            return error;
        }
        if (now != before) {
            std::error_code ignored;
            fs::remove(temp, ignored);
            continue;
        }
        std::error_code ec;
        fs::rename(temp, config, ec);
        if (ec) {
            std::error_code ignored;
            fs::remove(temp, ignored);
            return "cannot replace " + config.string() + ": " + ec.message();
        }
        return std::nullopt;
    }
    return "the config kept changing while it was being written; nothing was written";
}

std::string exe_name(const std::string& name) {
#if defined(_WIN32)
    return name + ".exe";
#else
    return name;
#endif
}

std::optional<fs::path> install_root() {
#if defined(_WIN32)
    const char* home = std::getenv("USERPROFILE");
#else
    const char* home = std::getenv("HOME");
#endif
    if (home == nullptr || *home == '\0') return std::nullopt;
    return fs::path(home) / ".gmnew";
}

std::optional<std::map<std::string, std::string>> tree_bytes(const fs::path& root) {
    std::error_code ec;
    if (!fs::is_directory(root, ec)) return std::nullopt;
    std::map<std::string, std::string> files;
    for (fs::recursive_directory_iterator it(root, ec), end; !ec && it != end; it.increment(ec)) {
        if (!it->is_regular_file(ec)) continue;
        std::ifstream in(it->path(), std::ios::binary);
        std::ostringstream text;
        text << in.rdbuf();
        files[it->path().lexically_relative(root).generic_string()] = text.str();
    }
    if (ec) return std::nullopt;
    return files;
}

bool same_tree(const fs::path& a, const fs::path& b) {
    const auto left = tree_bytes(a);
    const auto right = tree_bytes(b);
    return left && right && *left == *right;
}

std::optional<std::string> copy_tree(const fs::path& from, const fs::path& to) {
    std::error_code ec;
    if (!fs::exists(from, ec)) return std::nullopt;
    fs::copy(from, to, fs::copy_options::recursive | fs::copy_options::overwrite_existing, ec);
    if (ec) return "cannot copy " + from.string() + ": " + ec.message();
    return std::nullopt;
}

std::optional<std::string> refresh_tree(const fs::path& from, const fs::path& to) {
    if (!fs::is_directory(from) || same_tree(from, to)) return std::nullopt;
    std::error_code ec;
    fs::remove_all(to, ec);
    return copy_tree(from, to);
}

deoxidene::Result<std::string, std::string> build_version(const fs::path& exe) {
    const auto outcome = proc::run({exe.string(), "--version"}, {}, {}, 20000);
    if (!outcome.started || outcome.exit_code != 0) return deoxidene::Err<std::string>("cannot run " + exe.string() + " --version");
    std::istringstream words(outcome.out);
    std::string version;
    words >> version;
    if (version.empty() || version.find_first_not_of("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._-") != std::string::npos)
        return deoxidene::Err<std::string>("unexpected build version from " + exe.string() + ": '" + version + "'");
    return version;
}

std::int64_t wall_ms() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count();
}

std::string linked_to(const fs::path& link) {
    std::error_code ec;
    if (!fs::is_symlink(link, ec)) return {};
    return fs::read_symlink(link, ec).filename().string();
}

int start_check(const fs::path& exe, const std::string& version) {
    const auto outcome = proc::run({exe.string(), "--version"}, {}, {}, 20000);
    if (!outcome.started || outcome.exit_code != 0 || outcome.out.find(version) == std::string::npos) {
        std::cerr << "gm: install: the installed " << exe.string() << " did not answer --version with " << version << "\n";
        return 1;
    }
    return 0;
}

constexpr const char* kPlaywriterRepo = "https://github.com/AnEntrypoint/pw.git";
constexpr const char* kPlaywriterPin = "a41c6af";

std::optional<std::string> playwriter_step(const std::string& what, const std::vector<std::string>& argv, const fs::path& cwd, std::uint64_t timeout_ms,
                                           std::map<std::string, std::int64_t>& wall) {
    const std::int64_t began = wall_ms();
    const auto outcome = proc::run(argv, cwd, {}, timeout_ms);
    wall[what] = wall_ms() - began;
    if (!outcome.started || outcome.timed_out || outcome.exit_code != 0) {
        const std::string detail = outcome.timed_out ? std::string("timed out") : outcome.err.empty() ? outcome.out : outcome.err;
        return "playwriter " + what + " failed: " + detail.substr(0, 400);
    }
    return std::nullopt;
}

std::optional<std::string> install_playwriter(const fs::path& current) {
    const fs::path dir = current / "pw";
    const fs::path pin_file = dir / "gm-pin";
    std::ifstream known(pin_file);
    std::string pinned;
    std::getline(known, pinned);
    if (pinned == kPlaywriterPin && fs::exists(dir / "bin" / "playwriter-project")) {
        std::cout << "playwriter " << kPlaywriterPin << " is already in " << dir.string() << "\n";
        return std::nullopt;
    }
    std::error_code ec;
    std::map<std::string, std::int64_t> wall;
    const std::int64_t began = wall_ms();
    constexpr int kCloneAttempts = 3;
    for (int attempt = 1;; ++attempt) {
        fs::remove_all(dir, ec);
        const auto cloned = playwriter_step("clone", {"git", "clone", "--quiet", kPlaywriterRepo, dir.string()}, current, 900000, wall);
        if (!cloned) break;
        if (attempt == kCloneAttempts) return cloned;
    }
    if (auto error = playwriter_step("checkout", {"git", "-C", dir.string(), "checkout", "--quiet", "--detach", kPlaywriterPin}, current, 120000, wall)) return error;
    if (auto error = playwriter_step("npm ci", {"npm", "ci", "--no-audit", "--no-fund"}, dir, 1200000, wall)) return error;
    std::ofstream(pin_file) << kPlaywriterPin << "\n";
    std::string longest;
    for (const auto& [name, ms] : wall) {
        if (longest.empty() || ms > wall[longest]) longest = name;
    }
    std::cout << "installed playwriter " << kPlaywriterPin << " at " << dir.string() << " in " << (wall_ms() - began) << " ms; longest step: " << longest << " (" << wall[longest] << " ms)\n";
    return std::nullopt;
}

void print_turn_end_hook(const fs::path& exe) {
    const std::string command = json::dump(json::Value(exe.string() + " turn-end"));
    std::cout << "turn-end release stays off until gm serve runs with --release-at-turn-end yes. To release a lazy server's lease at the end of each turn, add this under the hooks key of the Claude settings file (install does not write it): \"Stop\": [{\"hooks\": [{\"type\": \"command\", \"command\": " << command << "}]}]\n";
}

int register_installed(const HostArgs& args, const fs::path& exe) {
    if (std::getenv("GMNEW_SKIP_REGISTER") != nullptr && std::string_view(std::getenv("GMNEW_SKIP_REGISTER")) == "1") {
        std::cout << "registration skipped (GMNEW_SKIP_REGISTER=1)\n";
        return 0;
    }
    const auto config = args.flag("--config") ? std::optional<fs::path>(fs::absolute(*args.flag("--config"))) : claude_config_path();
    if (!config) {
        std::cerr << "gm: install: neither HOME nor USERPROFILE is set\n";
        return 1;
    }
    std::vector<std::string> server_args{"serve"};
    if (auto mcp_config = args.flag("--mcp-config")) {
        server_args.push_back("--mcp-config");
        server_args.push_back(*mcp_config);
    }
    if (auto error = register_mcp_server(*config, "gm", exe.string(), server_args)) {
        std::cerr << "gm: install: " << *error << "\n";
        return 1;
    }
    std::cout << "registered gm MCP server (user scope) at " << exe.string() << " in " << config->string() << "\n";
    print_turn_end_hook(exe);
    return 0;
}

int install_local(const HostArgs& args, const fs::path& local) {
    const fs::path nested = local / "native" / "components" / "host";
    const fs::path host = fs::exists(nested / exe_name("gm")) ? nested : local;
    std::error_code ec;
    if (!fs::exists(host / exe_name("gm"), ec) || !fs::exists(host / exe_name("gm-core"), ec)) {
        std::cerr << "gm: install: no gm and gm-core in " << host.string() << ": build the gm target first\n";
        return 1;
    }
    if (!fs::is_directory(host / "skills", ec)) {
        std::cerr << "gm: install: no skills in " << host.string() << ": build the gm_skills target first\n";
        return 1;
    }
    if (auto source = args.flag("--source")) {
        if (!same_tree(host / "skills", fs::path(*source) / "skills")) {
            std::cerr << "gm: install: the build skills in " << host.string() << " differ from " << *source
                      << "/skills: run cmake --build with the gm_skills target, then install again\n";
            return 1;
        }
    }
    const auto root = install_root();
    if (!root) {
        std::cerr << "gm: install: neither HOME nor USERPROFILE is set\n";
        return 1;
    }
    const std::optional<fs::path> source = args.flag("--source") ? std::optional<fs::path>(fs::absolute(*args.flag("--source"))) : std::nullopt;
    const fs::path leaves_from = source ? *source / "native" / "leaves" : host / "leaves";
    const fs::path defaults_from = source ? *source / "defaults" : host / "defaults";
    const auto built = build_version(host / exe_name("gm"));
    if (!built) {
        std::cerr << "gm: install: " << built.error() << "\n";
        return 1;
    }
    const std::string version = *built;
    const fs::path current = *root / "current";
    if (linked_to(current) == version) {
        const std::pair<fs::path, const char*> trees[] = {{host / "skills", "skills"}, {leaves_from, "leaves"}, {defaults_from, "defaults"}};
        for (const auto& [from, name] : trees) {
            if (auto error = refresh_tree(from, current / name)) {
                std::cerr << "gm: install: " << *error << "\n";
                return 1;
            }
        }
        std::cout << "installed local build " << version << " from " << local.string() << " at " << (current / exe_name("gm")).string()
                  << "; the stamp is unchanged, so the binaries and their processes were kept\n";
    } else {
        const fs::path stage = *root / ("stage." + version + ".new");
        fs::remove_all(stage, ec);
        fs::create_directories(stage / "new", ec);
        fs::copy_file(host / exe_name("gm"), stage / "new" / exe_name("gm"), fs::copy_options::overwrite_existing, ec);
        fs::copy_file(host / exe_name("gm-core"), stage / "new" / exe_name("gm-core"), fs::copy_options::overwrite_existing, ec);
        if (ec) {
            std::cerr << "gm: install: cannot stage the binaries: " << ec.message() << "\n";
            return 1;
        }
        const std::pair<fs::path, const char*> trees[] = {{host / "skills", "skills"}, {leaves_from, "leaves"}, {defaults_from, "defaults"}};
        for (const auto& [from, name] : trees) {
            if (auto error = copy_tree(from, stage / "new" / name)) {
                std::cerr << "gm: install: " << *error << "\n";
                return 1;
            }
        }
        write_update_state(stage / "new", UpdateState{wall_ms(), "", version, ""});
        if (auto error = switch_version(stage / "new", *root, version)) {
            std::cerr << "gm: install: " << *error << "\n";
            return 1;
        }
        fs::remove_all(stage, ec);
        std::cout << "installed local build " << version << " from " << local.string() << " at " << (current / exe_name("gm")).string() << "\n";
    }
    if (auto error = install_playwriter(current)) {
        std::cerr << "gm: install: " << *error << "\n";
        return 1;
    }
    if (start_check(current / exe_name("gm"), version) != 0) return 1;
    return register_installed(args, current / exe_name("gm"));
}

int run_uninstall_command(const HostArgs& args) {
    const auto config = args.flag("--config") ? std::optional<fs::path>(fs::absolute(*args.flag("--config"))) : claude_config_path();
    if (!config) {
        std::cerr << "gm: uninstall: neither HOME nor USERPROFILE is set\n";
        return 1;
    }
    if (auto error = unregister_mcp_server(*config, "gm")) {
        std::cerr << "gm: uninstall: " << *error << "\n";
        return 1;
    }
    std::cout << "removed the gm MCP server entry from " << config->string() << "; the installed binaries were kept\n";
    return 0;
}

int run_install_command(const HostArgs& args) {
    if (auto local = args.flag("--local")) return install_local(args, fs::absolute(*local));
    const auto default_config = claude_config_path();
    const auto config = args.flag("--config") ? std::optional<fs::path>(fs::absolute(*args.flag("--config")))
                                              : default_config;
    if (!config) {
        std::cerr << "gm: install: neither HOME nor USERPROFILE is set\n";
        return 1;
    }
    std::vector<std::string> server_args{"serve"};
    if (auto mcp_config = args.flag("--mcp-config")) {
        server_args.push_back("--mcp-config");
        server_args.push_back(*mcp_config);
    }
    const std::string exe = stable_executable(current_executable()).string();
    if (auto error = register_mcp_server(*config, "gm", exe, server_args)) {
        std::cerr << "gm: install: " << *error << "\n";
        return 1;
    }
    std::cout << "registered gm MCP server (user scope) at " << exe << " in " << config->string() << "\n";
    return 0;
}

}
