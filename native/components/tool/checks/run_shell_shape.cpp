#include "gm/tool.hpp"
#include "support.hpp"

#include <system_error>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

bool has(const json::Value& value, const std::string& dotted) {
    return value_at(value, dotted) != nullptr;
}

}

CheckResult check_run_shell_shape(const std::string& binary) {
    CheckResult result;
    const fs::path sandbox = support::fresh_sandbox("run-shell-shape");
    {
        Session session(binary, sandbox / "ws", sandbox, 300000, true);
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + binary);
        } else {
            support::start_session(session, "check-run-shell-shape");
            const std::string body = "return { plain: await gm.run_shell({ command: 'echo hi' }), timeout: await gm.run_shell({ command: 'sleep 3', timeoutMs: 1000 }) };";
            const json::Value reply = output_value(tool_json(session, "run_code", json::Object{{"body", body}}));
            for (const char* field : {"ok", "output", "truncated", "complete", "exitCode", "signal"}) {
                if (!has(reply, std::string("plain.") + field)) result.failures.push_back(std::string("a plain run_shell reply lacks ") + field + ": " + json::dump(reply).substr(0, 240));
            }
            for (const char* field : {"ok", "output", "timedOut", "truncated", "complete", "exitCode", "signal"}) {
                if (!has(reply, std::string("timeout.") + field)) result.failures.push_back(std::string("a timed-out run_shell reply lacks ") + field);
            }
        }
    }
    std::error_code ec;
    fs::remove_all(sandbox, ec);
    result.summary = "a plain and a timed-out run_shell reply carry the same keys: ok, output, truncated, complete, exitCode, signal";
    return result;
}

}
