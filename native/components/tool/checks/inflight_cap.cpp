#include "gm/tool.hpp"
#include "support.hpp"

#include <algorithm>
#include <chrono>
#include <filesystem>
#include <string>
#include <system_error>
#include <vector>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

constexpr int kCalls = 3;
constexpr int kBodyMs = 1500;

struct Window {
    std::int64_t start = 0;
    std::int64_t end = 0;
    bool ok = false;
};

std::vector<Window> run_busy_calls(Session& session) {
    const std::string busy = "const t0 = Date.now(); while (Date.now() - t0 < " + std::to_string(kBodyMs) + ") {} return JSON.stringify({ start: t0, end: Date.now() });";
    std::vector<std::int64_t> ids;
    for (int call = 0; call < kCalls; ++call) {
        ids.push_back(session.send("tools/call", json::Object{{"name", "run_code"}, {"arguments", json::Object{{"body", busy}, {"timeoutMs", 60000}}}}));
    }
    std::vector<Window> windows;
    for (const std::int64_t id : ids) {
        Window window;
        const auto reply = session.await_reply(id, std::chrono::milliseconds(60000));
        const json::Value* result = reply ? reply->find("result") : nullptr;
        const json::Value* structured = result ? result->find("structuredContent") : nullptr;
        const json::Value* output = structured ? structured->find("output") : nullptr;
        if (output != nullptr && output->is_string()) {
            if (auto parsed = json::parse(output->as_string())) {
                const json::Value* start = parsed->find("start");
                const json::Value* end = parsed->find("end");
                if (start != nullptr && end != nullptr && start->is_number() && end->is_number()) {
                    window.start = static_cast<std::int64_t>(start->as_number());
                    window.end = static_cast<std::int64_t>(end->as_number());
                    window.ok = true;
                }
            }
        }
        windows.push_back(window);
    }
    return windows;
}

}

CheckResult check_inflight_cap(const std::string& binary) {
    CheckResult result;
    const fs::path sandbox = support::fresh_sandbox("ic");
    const fs::path workspace = sandbox / "ws";
    long long capped_wait = -1;
    long long open_wait = -1;
    for (const bool capped : {true, false}) {
        std::vector<std::string> extra;
        if (capped) extra = {"--max-inflight", "2"};
        Session session(binary, workspace, sandbox, 180000, true, extra);
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + binary);
            continue;
        }
        support::connect(session);
        session.rpc("resources/read", json::Object{{"uri", "skill://gm/SKILL.md"}});
        session.rpc("tools/call", json::Object{{"name", "next_context"}, {"arguments", json::Object{}}});
        const std::vector<Window> windows = run_busy_calls(session);
        session.stop();
        if (!std::all_of(windows.begin(), windows.end(), [](const Window& window) { return window.ok; })) {
            result.failures.push_back(std::string(capped ? "with --max-inflight 2" : "with no cap") + ": a run_code call was refused or gave no reply");
            continue;
        }
        const std::int64_t earliest_end = std::min({windows[0].end, windows[1].end, windows[2].end});
        const std::int64_t latest_start = std::max({windows[0].start, windows[1].start, windows[2].start});
        (capped ? capped_wait : open_wait) = latest_start - earliest_end;
    }
    if (capped_wait != -1 && capped_wait < -50) result.failures.push_back("with --max-inflight 2 the third call started " + std::to_string(-capped_wait) + " ms before any call ended: the cap is not enforced");
    if (open_wait != -1 && open_wait > -kBodyMs / 2) result.failures.push_back("with no cap the third call did not start with the others (it started " + std::to_string(open_wait) + " ms after the first end): the control does not discriminate");
    std::error_code ec;
    fs::remove_all(sandbox, ec);
    if (result.failures.empty()) result.summary = "with --max-inflight 2 the third of three " + std::to_string(kBodyMs) + " ms bodies starts only after one of the first two ended (" + std::to_string(capped_wait) + " ms from that end), and with no cap all three start together (" + std::to_string(open_wait) + " ms)";
    return result;
}

}
