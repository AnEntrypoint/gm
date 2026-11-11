#include "gm/tool.hpp"

#include <chrono>
#include <filesystem>
#include <fstream>
#include <regex>
#include <system_error>

namespace gm::tool {
namespace fs = std::filesystem;

CheckResult check_lazy_browser(const std::string& binary) {
    CheckResult result;
    const auto stamp = std::chrono::steady_clock::now().time_since_epoch().count();
    const auto sandbox = fs::temp_directory_path() / ("gm-lazy-browser-" + std::to_string(stamp));
    const auto workspace = sandbox / "ws";
    fs::create_directories(workspace);
    auto count_playwriter = [](const std::vector<long long>& pids) {
        std::size_t count = 0;
        for (long long pid : pids) {
            std::ifstream cmdline("/proc/" + std::to_string(pid) + "/cmdline");
            std::string text((std::istreambuf_iterator<char>(cmdline)), std::istreambuf_iterator<char>());
            if (text.find("playwriter") != std::string::npos) ++count;
        }
        return count;
    };
    const fs::path host = fs::path(binary).parent_path();
    const fs::path build = host.parent_path().parent_path().parent_path();
    const fs::path source = build.parent_path().parent_path();
    const fs::path installed = sandbox / ".gmnew" / "current" / "gm";
    std::vector<std::string> started_pids;
    const auto install = proc::run({"env", "HOME=" + sandbox.string(), (host / "gm").string(), "install", "--local", build.string(), "--source", source.string()}, sandbox, {}, 900000);
    if (!install.started || install.exit_code != 0) result.failures.push_back("the sandbox install failed: " + (install.err.empty() ? install.out : install.err).substr(0, 400));
    {
        Session session(installed.string(), workspace, sandbox, 180000, false);
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + installed.string());
        } else {
            session.rpc("initialize", json::Object{{"protocolVersion", "2025-06-18"}, {"capabilities", json::Object{}},
                                                  {"clientInfo", json::Object{{"name", "gm-tool"}, {"version", "1"}}}});
            session.notify("notifications/initialized", json::Object{});
            session.rpc("resources/read", json::Object{{"uri", "skill://gm/SKILL.md"}});
            session.rpc("tools/call", json::Object{{"name", "next_context"}, {"arguments", json::Object{}}});
            const std::size_t at_start = count_playwriter(session.descendants());
            if (at_start != 0) result.failures.push_back("a fresh session started " + std::to_string(at_start) + " browser tooling process(es) before any use");
            const std::string verbs = session.body(
                "return JSON.stringify(gm.verbs().map((v) => v.name).filter((n) => n.startsWith('playwriter_')));");
            if (verbs.find("playwriter_execute") == std::string::npos)
                result.failures.push_back("the lazy browser verb playwriter_execute is missing from gm.verbs(): " + verbs.substr(0, 200));
            if (verbs.find("playwriter_reset") != std::string::npos) result.failures.push_back("the denied reset verb is listed");
            const std::size_t after_listing = count_playwriter(session.descendants());
            if (after_listing != 0) result.failures.push_back("listing the verbs started " + std::to_string(after_listing) + " browser tooling process(es)");
            const std::string first_call = session.body("return JSON.stringify(await gm.playwriter_execute({ code: 'return 1;' }));");
            const std::regex launched("(?:gate pid|browser running pid) ([0-9]+)");
            for (auto it = std::sregex_iterator(first_call.begin(), first_call.end(), launched); it != std::sregex_iterator(); ++it)
                started_pids.push_back((*it)[1].str());
            if (first_call.find("[return value] 1") == std::string::npos) result.failures.push_back("the first browser call did not run through the installed playwriter launcher: " + first_call.substr(0, 300));
            result.summary = "a fresh session has no browser tooling process; its verb playwriter_execute is listed without a start, and the first browser call runs through the launcher that a clean install placed under the sandbox HOME (playwriter_browsers is optional at the pin)";
        }
        session.stop();
    }
    for (const std::string& pid : started_pids) {
        if (fs::exists("/proc/" + pid)) proc::run({"kill", "-TERM", pid}, sandbox, {}, 10000);
    }
    std::error_code ignored;
    fs::remove_all(sandbox, ignored);
    return result;
}

}
