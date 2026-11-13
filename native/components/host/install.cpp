#include "gm/host/install.hpp"

#include <algorithm>
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
constexpr const char* kPlaywriterPin = "df54652";

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

std::map<std::string, std::string> tree_marks(const fs::path& root) {
    std::map<std::string, std::string> marks;
    std::error_code ec;
    for (fs::recursive_directory_iterator it(root, ec), end; !ec && it != end; it.increment(ec)) {
        std::error_code entry_ec;
        if (!it->is_regular_file(entry_ec)) continue;
        marks[it->path().lexically_relative(root).generic_string()] =
            std::to_string(it->file_size(entry_ec)) + ":" + std::to_string(it->last_write_time(entry_ec).time_since_epoch().count());
    }
    return marks;
}

void report_touched(const fs::path& root, const std::map<std::string, std::string>& before) {
    const auto after = tree_marks(root);
    std::vector<std::string> touched;
    for (const auto& [path, mark] : after) {
        const auto known = before.find(path);
        if (known == before.end() || known->second != mark) touched.push_back(path);
    }
    for (const auto& [path, mark] : before) {
        if (after.find(path) == after.end()) touched.push_back(path);
    }
    std::sort(touched.begin(), touched.end());
    std::cout << "files touched under " << root.string() << ": " << touched.size() << "\n";
    for (const std::string& path : touched) std::cout << "  " << (root / path).string() << "\n";
}

void print_server_entry(const HostArgs& args, const fs::path& exe) {
    json::Array argv;
    argv.push_back(json::Value(std::string("serve")));
    if (auto mcp_config = args.flag("--mcp-config")) {
        argv.push_back(json::Value(std::string("--mcp-config")));
        argv.push_back(json::Value(*mcp_config));
    }
    json::Value entry = json::Object{};
    entry.set("command", json::Value(exe.string()));
    entry.set("args", json::Value(argv));
    json::Value servers = json::Object{};
    servers.set("gm", entry);
    json::Value root = json::Object{};
    root.set("mcpServers", servers);
    std::cout << "gm writes no harness settings file. Add this entry to the mcpServers object of your MCP client's configuration:\n"
              << json::dump(root) << "\n";
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
    const auto before_marks = tree_marks(*root);
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
    report_touched(*root, before_marks);
    print_server_entry(args, current / exe_name("gm"));
    return 0;
}

int run_uninstall_command(const HostArgs&) {
    std::cout << "gm writes no harness settings file, so uninstall changed nothing. Remove the gm entry from the mcpServers object of your MCP client's configuration; the installed binaries were kept\n";
    std::cout << "files touched: 0\n";
    return 0;
}

int run_install_command(const HostArgs& args) {
    if (auto local = args.flag("--local")) return install_local(args, fs::absolute(*local));
    print_server_entry(args, stable_executable(current_executable()));
    std::cout << "files touched: 0\n";
    return 0;
}

}

