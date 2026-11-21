#include "support.hpp"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <filesystem>
#include <string>
#include <system_error>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;


}

CheckResult check_next_hold_cap(const std::string& binary) {
    CheckResult result;
    const fs::path sandbox = support::fresh_sandbox("next-hold-cap");
    const fs::path workspace = sandbox / "ws";
    const std::int64_t cap_ms = scaled(60000);
    const std::int64_t asked_ms = scaled(120000);
    const std::int64_t margin_ms = scaled(30000);
    set_env("GMNEW_TEST_CLOCK", "1");
    set_env("GM_CLOCK_SCALE", "0.016666666666666666");
    double elapsed_ms = -1;
    {
        Session session(binary, workspace, sandbox, 300000, true);
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + binary);
        } else {
            support::start_session(session, "next-hold-cap-check");
            const auto began = std::chrono::steady_clock::now();
            const json::Value held = tool_json(session, "next_context", json::Object{{"waitMs", asked_ms}});
            elapsed_ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - began).count();
            if (held.find("pendingEvents") != nullptr)
                result.failures.push_back("the held next_context returned early with pending events, so the cap was not measured: " + json::dump(held).substr(0, 300));
            else if (elapsed_ms < 0.9 * static_cast<double>(cap_ms))
                result.failures.push_back("next_context with waitMs " + std::to_string(asked_ms) + " returned after " + std::to_string(static_cast<long long>(elapsed_ms)) + " ms, before the wait cap of " + std::to_string(cap_ms) + " ms");
            else if (elapsed_ms >= static_cast<double>(asked_ms - margin_ms))
                result.failures.push_back("next_context with waitMs " + std::to_string(asked_ms) + " returned after " + std::to_string(static_cast<long long>(elapsed_ms)) + " ms, so the wait was not capped at " + std::to_string(cap_ms) + " ms");
            session.stop();
        }
    }
    unset_env("GMNEW_TEST_CLOCK");
    unset_env("GM_CLOCK_SCALE");
    std::error_code ignored;
    fs::remove_all(sandbox, ignored);
    result.summary = "a next_context with waitMs " + std::to_string(asked_ms) + " on a fresh session with no pending events returned after " + std::to_string(static_cast<long long>(elapsed_ms)) + " ms, held to the " + std::to_string(cap_ms) + " ms wait cap";
    return result;
}

}
