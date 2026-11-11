#include "gm/tool.hpp"

#include <chrono>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <system_error>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

std::string read_bytes(const fs::path& file) {
    std::ifstream in(file, std::ios::binary);
    std::ostringstream text;
    text << in.rdbuf();
    return text.str();
}

bool write_bytes(const fs::path& file, const std::string& bytes) {
    std::ofstream out(file, std::ios::binary | std::ios::trunc);
    out.write(bytes.data(), static_cast<std::streamsize>(bytes.size()));
    return static_cast<bool>(out);
}

std::size_t replace_all(std::string& text, const std::string& from, const std::string& to) {
    std::size_t count = 0;
    for (std::size_t at = text.find(from); at != std::string::npos; at = text.find(from, at + to.size())) {
        text.replace(at, from.size(), to);
        ++count;
    }
    return count;
}

fs::path repo_root() {
    for (fs::path dir = fs::current_path();; dir = dir.parent_path()) {
        std::error_code ec;
        if (fs::exists(dir / "skills" / "gm" / "SKILL.md", ec)) return dir;
        if (dir == dir.parent_path()) return {};
    }
}

std::string tail(const std::string& text) { return text.size() > 400 ? text.substr(text.size() - 400) : text; }

std::string version_of(const fs::path& gm) {
    const auto outcome = proc::run({gm.string(), "--version"}, gm.parent_path(), {}, 20000);
    std::istringstream words(outcome.out);
    std::string first;
    words >> first;
    return first;
}

std::vector<json::Value> restart_events(const fs::path& log) {
    std::vector<json::Value> events;
    std::istringstream lines(read_bytes(log));
    std::string line;
    while (std::getline(lines, line)) {
        auto parsed = json::parse(line);
        if (!parsed) continue;
        const json::Value* kind = parsed->find("kind");
        if (kind != nullptr && kind->is_string() && kind->as_string() == "restart") events.push_back(*parsed);
    }
    return events;
}

long long worker_pid(const Session& session) {
    for (const long long pid : session.descendants()) {
        std::error_code ec;
        const auto exe = fs::read_symlink("/proc/" + std::to_string(pid) + "/exe", ec);
        if (!ec && exe.filename() == "gm-core") return pid;
    }
    return -1;
}

std::string running_core(long long pid) {
    if (pid < 0) return "";
    std::error_code ec;
    const auto exe = fs::read_symlink("/proc/" + std::to_string(pid) + "/exe", ec);
    return ec ? "" : exe.string();
}

}

CheckResult check_install_follows(const std::string& binary) {
    CheckResult result;
#if defined(__linux__)
    const auto started = std::chrono::steady_clock::now();
    const fs::path root = repo_root();
    if (root.empty()) {
        result.failures.push_back("run from the checkout: no skills/gm/SKILL.md in the working directory or its parents");
        return result;
    }
    const fs::path host = fs::path(binary).parent_path();
    const auto stamp = started.time_since_epoch().count();
    const fs::path sandbox = fs::temp_directory_path() / ("gm-install-follows-" + std::to_string(stamp));
    const fs::path home = sandbox / "home";
    const fs::path workspace = sandbox / "ws";
    const fs::path tree = sandbox / "tree";
    const fs::path build = sandbox / "build";
    const fs::path build_host = build / "native" / "components" / "host";
    fs::create_directories(build_host);
    fs::create_directories(home);
    fs::create_directories(workspace);
    fs::create_directories(tree / "native" / "leaves");
    fs::copy(root / "skills", tree / "skills", fs::copy_options::recursive);
    fs::copy(root / "defaults", tree / "defaults", fs::copy_options::recursive);
    fs::copy(root / "skills", build_host / "skills", fs::copy_options::recursive);
    for (const char* name : {"gm", "gm-core"}) {
        fs::copy_file(host / name, build_host / name, fs::copy_options::overwrite_existing);
        fs::permissions(build_host / name, fs::perms::owner_all | fs::perms::group_read | fs::perms::group_exec | fs::perms::others_read | fs::perms::others_exec, fs::perm_options::replace);
    }
    write_bytes(home / "quiet.json", R"({"mcpServers":{"playwriter":{"disabled":true}}})");

    const auto install = [&] {
        return proc::run({"env", "HOME=" + home.string(), (build_host / "gm").string(), "install", "--local", build.string(), "--source", tree.string()}, sandbox, {}, 300000);
    };
    const fs::path installed = home / ".gmnew" / "current";
    const fs::path installed_gm = installed / "gm";
    const fs::path installed_core = installed / "gm-core";
    const fs::path log = workspace / "runs" / "check" / "log.jsonl";
    {
        const auto first = install();
        if (!first.started || first.exit_code != 0) result.failures.push_back("the first install failed: " + tail(first.out + first.err));
    }
    if (result.failures.empty()) {
        const std::string first_version = version_of(installed_gm);
        {
            Session session(installed_gm.string(), workspace, home);
            if (!session.started()) result.failures.push_back("the installed gm did not start");
            if (session.started()) {
                session.rpc("initialize", json::Object{{"protocolVersion", "2025-06-18"}, {"capabilities", json::Object{}},
                                                      {"clientInfo", json::Object{{"name", "gm-tool"}, {"version", "1"}}}});
                session.notify("notifications/initialized", json::Object{});
                session.rpc("tools/call", json::Object{{"name", "next_context"}, {"arguments", json::Object{}}});
                const long long first_pid = worker_pid(session);
                const std::string first_exe = running_core(first_pid);
                std::error_code ec;
                if (first_exe.empty() || fs::canonical(first_exe, ec) != fs::canonical(installed_core, ec))
                    result.failures.push_back("the worker does not run the installed gm-core at start: " + first_exe);

                const std::string skill_before = read_bytes(installed / "skills" / "gm" / "SKILL.md");
                write_bytes(tree / "skills" / "gm" / "SKILL.md", read_bytes(tree / "skills" / "gm" / "SKILL.md") + "\ninstall-follows scratch edit\n");
                session.rpc("tools/call", json::Object{{"name", "next_context"}, {"arguments", json::Object{{"waitMs", 3000}}}});
                if (read_bytes(installed / "skills" / "gm" / "SKILL.md") != skill_before) result.failures.push_back("a scratch skill edit changed the installed skill");
                if (!restart_events(log).empty()) result.failures.push_back("a scratch skill edit restarted the installed worker");

                const std::string old_stamp = first_version.substr(0, 12);
                const std::string new_stamp = (old_stamp[0] == '0' ? "1" : "0") + old_stamp.substr(1);
                for (const char* name : {"gm", "gm-core"}) {
                    std::string bytes = read_bytes(host / name);
                    if (replace_all(bytes, old_stamp, new_stamp) == 0) result.failures.push_back(std::string("the build stamp was not found in ") + name);
                    write_bytes(build_host / name, bytes);
                    fs::permissions(build_host / name, fs::perms::owner_all | fs::perms::group_read | fs::perms::group_exec | fs::perms::others_read | fs::perms::others_exec, fs::perm_options::replace);
                }
                fs::remove_all(build_host / "skills");
                fs::copy(tree / "skills", build_host / "skills", fs::copy_options::recursive);
                const auto second = install();
                if (!second.started || second.exit_code != 0) result.failures.push_back("the second install failed: " + tail(second.out + second.err));
                const std::string second_version = version_of(installed_gm);
                if (second_version == first_version) result.failures.push_back("the second install did not change the installed version");

                session.rpc("tools/call", json::Object{{"name", "next_context"}, {"arguments", json::Object{{"waitMs", 30000}}}});
                const auto restarts = restart_events(log);
                if (restarts.empty()) {
                    result.failures.push_back("the running session did not restart onto the installed build");
                } else {
                    const json::Value* reason = restarts.back().find("reason");
                    if (reason == nullptr || !reason->is_string() || reason->as_string().empty()) result.failures.push_back("the restart carries no reason");
                }
                const long long second_pid = worker_pid(session);
                const std::string second_exe = running_core(second_pid);
                if (second_exe.empty() || fs::canonical(second_exe, ec) != fs::canonical(installed_core, ec))
                    result.failures.push_back("the worker after the install does not run the installed gm-core: " + second_exe);
                if (second_pid == first_pid) result.failures.push_back("the worker process did not change after the install");
            }
            session.stop();
        }
    }
    std::error_code ignored;
    fs::remove_all(sandbox, ignored);
    const double wall = std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count();
    result.summary = "a scratch skill edit leaves the installed skill and the worker unchanged; a second install with a new build stamp restarts the live worker onto the installed gm-core, checked through /proc (wall " + std::to_string(wall) + " s)";
#else
    result.summary = "not measured: the reach witness reads /proc, which this platform does not have";
#endif
    return result;
}

}
