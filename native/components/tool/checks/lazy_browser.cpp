#include "gm/tool.hpp"

#include <chrono>
#include <filesystem>
#include <fstream>
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
    {
        Session session(binary, workspace, sandbox, 180000, false);
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + binary);
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
            if (verbs.find("playwriter_execute") == std::string::npos || verbs.find("playwriter_browsers") == std::string::npos)
                result.failures.push_back("the lazy browser verbs are missing from gm.verbs(): " + verbs.substr(0, 200));
            if (verbs.find("playwriter_reset") != std::string::npos) result.failures.push_back("the denied reset verb is listed");
            const std::size_t after_listing = count_playwriter(session.descendants());
            if (after_listing != 0) result.failures.push_back("listing the verbs started " + std::to_string(after_listing) + " browser tooling process(es)");
            result.summary = "a fresh session has no browser tooling process; its verbs playwriter_execute and playwriter_browsers are listed without a start";
        }
        session.stop();
    }
    std::error_code ignored;
    fs::remove_all(sandbox, ignored);
    return result;
}

}
