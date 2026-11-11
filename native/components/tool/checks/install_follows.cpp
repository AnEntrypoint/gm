#include "gm/tool.hpp"

#include <chrono>
#include <cstdlib>
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

std::size_t await_restart(Session& session, const fs::path& log, std::size_t before) {
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(30);
    std::size_t count = restart_events(log).size();
    while (count <= before && std::chrono::steady_clock::now() < deadline) {
        session.rpc("tools/call", json::Object{{"name", "next_context"}, {"arguments", json::Object{{"waitMs", 250}}}});
        count = restart_events(log).size();
    }
    return count;
}

std::string offline_playwriter_path(const fs::path& sandbox) {
    const fs::path offline_bin = sandbox / "offline-bin";
    fs::create_directories(offline_bin);
    write_bytes(offline_bin / "git", "#!/bin/sh\nif [ \"$1\" = clone ]; then for last; do :; done; mkdir -p \"$last\"; fi\nexit 0\n");
    write_bytes(offline_bin / "npm", "#!/bin/sh\nmkdir -p bin && : > bin/playwriter-project\n");
    for (const char* name : {"git", "npm"}) fs::permissions(offline_bin / name, fs::perms::owner_all | fs::perms::group_read | fs::perms::group_exec, fs::perm_options::replace);
    const char* inherited = std::getenv("PATH");
    return "PATH=" + offline_bin.string() + (inherited != nullptr ? ":" + std::string(inherited) : std::string());
}

long long worker_pid(const Session& session) {
    for (const long long pid : session.descendants()) {
        if (proc::process_exe(pid).filename() == "gm-core") return pid;
    }
    return -1;
}

std::string running_core(long long pid) {
    if (pid < 0) return "";
    return proc::process_exe(pid).string();
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
    const std::string install_path = offline_playwriter_path(sandbox);

    const auto install = [&] {
        return proc::run({"env", "HOME=" + home.string(), install_path, (build_host / "gm").string(), "install", "--local", build.string(), "--source", tree.string()}, sandbox, {}, 300000);
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
                    const std::size_t patched = replace_all(bytes, old_stamp, new_stamp);
                    if (std::string(name) == "gm" && patched == 0) result.failures.push_back("the build stamp was not found in gm");
                    write_bytes(build_host / name, bytes);
                    fs::permissions(build_host / name, fs::perms::owner_all | fs::perms::group_read | fs::perms::group_exec | fs::perms::others_read | fs::perms::others_exec, fs::perm_options::replace);
                }
                fs::remove_all(build_host / "skills");
                fs::copy(tree / "skills", build_host / "skills", fs::copy_options::recursive);
                const std::size_t before_second = restart_events(log).size();
                const auto second = install();
                if (!second.started || second.exit_code != 0) result.failures.push_back("the second install failed: " + tail(second.out + second.err));
                const std::string second_version = version_of(installed_gm);
                if (second_version == first_version) result.failures.push_back("the second install did not change the installed version");

                await_restart(session, log, before_second);
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

CheckResult check_skill_reload(const std::string& binary) {
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
    const fs::path sandbox = fs::temp_directory_path() / ("gm-skill-reload-" + std::to_string(stamp));
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
    const auto executable = fs::perms::owner_all | fs::perms::group_read | fs::perms::group_exec | fs::perms::others_read | fs::perms::others_exec;
    const std::string original_gm = read_bytes(host / "gm");
    const std::string original_core = read_bytes(host / "gm-core");
    const std::string original_version = version_of(host / "gm");
    const std::string old_stamp = original_version.substr(0, 12);
    write_bytes(home / "quiet.json", R"({"mcpServers":{"playwriter":{"disabled":true}}})");
    const std::string install_path = offline_playwriter_path(sandbox);

    const auto variant = [&](char first) {
        const std::string new_stamp = std::string(1, first) + old_stamp.substr(1);
        std::string gm_bytes = original_gm;
        std::string core_bytes = original_core;
        const std::size_t patched_gm = replace_all(gm_bytes, old_stamp, new_stamp);
        replace_all(core_bytes, old_stamp, new_stamp);
        if (patched_gm == 0) result.failures.push_back("the build stamp was not found in gm");
        write_bytes(build_host / "gm", gm_bytes);
        write_bytes(build_host / "gm-core", core_bytes);
        fs::permissions(build_host / "gm", executable, fs::perm_options::replace);
        fs::permissions(build_host / "gm-core", executable, fs::perm_options::replace);
        fs::remove_all(build_host / "skills");
        fs::copy(tree / "skills", build_host / "skills", fs::copy_options::recursive);
        const auto done = proc::run({"env", "HOME=" + home.string(), install_path, (build_host / "gm").string(), "install", "--local", build.string(), "--source", tree.string()}, sandbox, {}, 300000);
        if (!done.started || done.exit_code != 0) result.failures.push_back("an install failed: " + tail(done.out + done.err));
    };
    const fs::path installed = home / ".gmnew" / "current";
    const fs::path log = workspace / "runs" / "check" / "log.jsonl";
    variant(old_stamp[0] == '1' ? '2' : '1');
    if (result.failures.empty()) {
        Session session(installed / "gm", workspace, home);
        if (!session.started()) result.failures.push_back("the installed gm did not start");
        if (session.started()) {
            session.rpc("initialize", json::Object{{"protocolVersion", "2025-06-18"}, {"capabilities", json::Object{}},
                                                  {"clientInfo", json::Object{{"name", "gm-tool"}, {"version", "1"}}}});
            session.notify("notifications/initialized", json::Object{});
            session.rpc("resources/read", json::Object{{"uri", "skill://gm/SKILL.md"}});
            session.rpc("tools/call", json::Object{{"name", "next_context"}, {"arguments", json::Object{}}});
            const auto reads = log.empty() ? std::string() : read_bytes(log);
            if (reads.find("\"kind\":\"skill-loaded\"") == std::string::npos) result.failures.push_back("the skill read logged no skill-loaded event");
            if (reads.find("\"sha\":\"sha256:") == std::string::npos) result.failures.push_back("the skill-loaded event carries no sha");

            const std::size_t before_move = restart_events(log).size();
            variant(old_stamp[0] == '3' ? '4' : '3');
            await_restart(session, log, before_move);
            const auto moved = restart_events(log);
            if (moved.size() == before_move) {
                result.failures.push_back("the path-only move did not restart the worker");
            } else {
                const json::Value& event = moved.back();
                const json::Value* changed = event.find("skillChanged");
                const json::Value* read = event.find("skillRead");
                if (changed == nullptr || changed->as_bool(true)) result.failures.push_back("a path-only move reported the skill changed");
                if (read == nullptr || !read->as_bool(false)) result.failures.push_back("a path-only move lost the skill read");
            }
            const std::string moved_reply = session.body("return 1;");
            if (moved_reply.find("refused") != std::string::npos) result.failures.push_back("a path-only move refused the next run_code: " + moved_reply.substr(0, 200));

            write_bytes(tree / "skills" / "gm" / "SKILL.md", read_bytes(tree / "skills" / "gm" / "SKILL.md") + "\nskill-reload scratch edit\n");
            const std::size_t before_edit = restart_events(log).size();
            variant(old_stamp[0] == '5' ? '6' : '5');
            await_restart(session, log, before_edit);
            const auto edited = restart_events(log);
            if (edited.size() == before_edit) {
                result.failures.push_back("the real edit did not restart the worker");
            } else {
                const json::Value* changed = edited.back().find("skillChanged");
                if (changed == nullptr || !changed->as_bool(false)) result.failures.push_back("a real skill edit did not report the skill changed");
            }
            const std::string edited_reply = session.body("return 1;");
            if (edited_reply.find("changed since this run read it") == std::string::npos) result.failures.push_back("the next run_code after a real edit was not refused with the changed-skill reason: " + edited_reply.substr(0, 200));
        }
        session.stop();
    }
    std::error_code ignored;
    fs::remove_all(sandbox, ignored);
    const double wall = std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count();
    result.summary = "a path-only move restarts the worker with the skill unchanged and no refusal; a real skill edit restarts it with skillChanged set, and the next run_code is refused once with the changed-skill reason (wall " + std::to_string(wall) + " s)";
#else
    result.summary = "not measured: the reload witness reads /proc, which this platform does not have";
#endif
    return result;
}

}
