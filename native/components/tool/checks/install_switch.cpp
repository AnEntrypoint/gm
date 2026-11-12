#include "gm/tool.hpp"

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <system_error>
#include <thread>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

constexpr std::chrono::milliseconds kSwitchBudget{15000};

std::string read_text(const fs::path& file) {
    std::ifstream in(file, std::ios::binary);
    std::ostringstream text;
    text << in.rdbuf();
    return text.str();
}

std::string tail_of(const std::string& text, std::size_t count) {
    return text.size() > count ? text.substr(text.size() - count) : text;
}

std::string exe_of(long long pid) {
    return proc::process_exe(pid).string();
}

std::vector<fs::path> files_under(const fs::path& dir) {
    std::vector<fs::path> files;
    std::error_code ec;
    for (const auto& entry : fs::recursive_directory_iterator(dir, ec)) {
        if (entry.is_regular_file(ec)) files.push_back(fs::relative(entry.path(), dir));
    }
    std::sort(files.begin(), files.end());
    return files;
}

json::Value traced(Session& session, const std::string& label, const std::string& method, json::Value params) {
    const auto began = std::chrono::steady_clock::now();
    std::fprintf(stderr, "install-switch: %s start\n", label.c_str());
    json::Value reply = session.rpc(method, std::move(params));
    const auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - began).count();
    std::fprintf(stderr, "install-switch: %s done in %lld ms\n", label.c_str(), static_cast<long long>(ms));
    return reply;
}

}

CheckResult check_install_switch(const std::string& binary) {
    CheckResult result;
    const auto started = std::chrono::steady_clock::now();
    const auto stamp = started.time_since_epoch().count();
    const fs::path host = fs::path(binary).parent_path();
    const fs::path build = host.parent_path().parent_path().parent_path();
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
        return result;
    }
    const fs::path scratch = fs::temp_directory_path() / ("gm-install-switch-" + std::to_string(stamp));
    const fs::path home = scratch / "home";
    const fs::path install_root = home / ".gmnew";
    fs::create_directories(home);
    std::string first;
    long long switched_ms = -1;
    {
        const auto installed = proc::run({"env", "HOME=" + home.string(), "GMNEW_SKIP_REGISTER=1", (host / "gm").string(), "install", "--local", build.string(), "--source", repo.string()}, repo, {}, 120000);
        if (!installed.started || installed.exit_code != 0) {
            result.failures.push_back("gm install --local failed: " + (installed.err.empty() ? installed.out : installed.err).substr(0, 300));
        } else {
            const auto checkout_files = files_under(repo / "skills");
            const auto installed_files = files_under(install_root / "current" / "skills");
            if (checkout_files != installed_files) result.failures.push_back("the installed skill files differ from the checkout's");
            for (const fs::path& file : checkout_files) {
                if (read_text(install_root / "current" / "skills" / file) != read_text(repo / "skills" / file)) result.failures.push_back("installed skills/" + file.string() + " is not the checkout's");
            }
            first = fs::read_symlink(install_root / "current").string();
            fs::copy(install_root / first, install_root / "versions" / "switched-dev", fs::copy_options::recursive);
            const fs::path workspace = scratch / "ws";
            fs::create_directories(workspace);
            std::ofstream(workspace / "README.md") << "x\n";
            std::ofstream(home / "quiet.json") << R"({"mcpServers":{"playwriter":{"disabled":true}}})";
            Session session((install_root / "current" / "gm").string(), workspace, home, 180000, true);
            if (!session.started()) {
                result.failures.push_back("the installed gm did not start");
            } else {
                traced(session, "initialize", "initialize", json::Object{{"protocolVersion", "2025-06-18"}, {"capabilities", json::Object{}},
                                                                         {"clientInfo", json::Object{{"name", "install-switch-check"}, {"version", "1"}}}});
                session.notify("notifications/initialized", json::Object{});
                traced(session, "resources/read", "resources/read", json::Object{{"uri", "skill://gm/SKILL.md"}});
                traced(session, "next_context before switch", "tools/call", json::Object{{"name", "next_context"}, {"arguments", json::Object{}}});
                const std::string before = exe_of(session.pid());
                if (before.find(first) == std::string::npos) result.failures.push_back("the relay did not start from the installed version " + first + ": " + before);

                fs::create_directories(install_root / "versions");
                const fs::path next = install_root / "current.switch";
                fs::create_directory_symlink(fs::path("versions") / "switched-dev", next);
                fs::rename(next, install_root / "current");
                const auto switch_at = std::chrono::steady_clock::now();
                std::string after;
                for (int tick = 0; after.find("switched-dev") == std::string::npos && std::chrono::steady_clock::now() - switch_at < kSwitchBudget; ++tick) {
                    std::this_thread::sleep_for(std::chrono::milliseconds(500));
                    traced(session, "next_context tick " + std::to_string(tick), "tools/call", json::Object{{"name", "next_context"}, {"arguments", json::Object{}}});
                    after = exe_of(session.pid());
                    std::fprintf(stderr, "install-switch: tick %d exe %s\n", tick, after.c_str());
                }
                switched_ms = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - switch_at).count();
                if (after.find("switched-dev") == std::string::npos) result.failures.push_back("the relay did not re-execute onto switched-dev within " + std::to_string(kSwitchBudget.count() / 1000) + " s: exe " + after + "; stderr " + tail_of(session.stderr_text(), 300));
                if (session.stderr_text().find("re-executing") == std::string::npos) result.failures.push_back("the relay did not say it re-executed: " + tail_of(session.stderr_text(), 300));
                const json::Value alive = traced(session, "next_context after switch", "tools/call", json::Object{{"name", "next_context"}, {"arguments", json::Object{}}});
                if (alive.find("result") == nullptr) result.failures.push_back("the re-executed relay does not answer next_context");
            }
            session.stop();
        }
    }
    std::error_code ignored;
    fs::remove_all(scratch, ignored);
    const double wall = std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count();
    result.summary = "the install link moved from " + first + " to switched-dev in " + std::to_string(switched_ms) + " ms; the running relay re-executed through the stable path on the same pid (wall " + std::to_string(wall) + " s)";
    return result;
}

}
