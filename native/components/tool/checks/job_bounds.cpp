#include "gm/tool.hpp"

#include <chrono>
#include <filesystem>
#include <future>
#include <system_error>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

constexpr std::int64_t kLifetimeMs = 5000;

std::string job_body(const std::string& name, const std::string& command, std::int64_t timeout_ms) {
    return "const t0 = Date.now(); await gm.job_start({ job: " + json::quote(name) + ", command: " + json::quote(command) + ", timeoutMs: " + std::to_string(timeout_ms) +
           " }); const status = await gm.job_status({ job: " + json::quote(name) + ", waitMs: 60000 }); return { elapsed: Date.now() - t0, status };";
}

std::string sleep_command(std::int64_t ms) {
    return "node -e \"setTimeout(() => {}, " + std::to_string(ms) + ")\"";
}

double number_at(const json::Value& value, const std::string& dotted) {
    const json::Value* found = value_at(value, dotted);
    return found != nullptr && found->is_number() ? found->as_number() : -1;
}

}

CheckResult check_job_bounds(const std::string& binary) {
    CheckResult result;
    const auto started = std::chrono::steady_clock::now();
    const auto stamp = started.time_since_epoch().count();
    const fs::path sandbox = fs::temp_directory_path() / ("gm-job-bounds-" + std::to_string(stamp));
    const fs::path workspace = sandbox / "ws";
    fs::create_directories(workspace);
    {
        Session session(binary, workspace, sandbox, 240000, true, {"--job-lifetime-ms", std::to_string(kLifetimeMs)});
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + binary);
        } else {
            session.rpc("initialize", json::Object{{"protocolVersion", "2025-06-18"}, {"capabilities", json::Object{}},
                                                  {"clientInfo", json::Object{{"name", "gm-job-bounds-check"}, {"version", "1"}}}});
            session.notify("notifications/initialized", json::Object{});
            session.rpc("resources/read", json::Object{{"uri", "skill://gm/SKILL.md"}});
            tool_text(session, "next_context", json::Object{});

            auto run = [&session](const std::string& body) {
                return std::async(std::launch::async, [&session, body] {
                    return output_value(tool_json(session, "run_code", json::Object{{"format", "esm"}, {"timeoutMs", 120000}, {"body", body}}));
                });
            };
            auto by_timeout = run(job_body("bound-timeout", sleep_command(30000), 2000));
            auto by_lifetime = run(job_body("bound-lifetime", sleep_command(30000), 7200000));
            auto exited = run(job_body("bound-exit", "sleep 1", 4000));
            const json::Value timeout_out = by_timeout.get();
            const json::Value lifetime_out = by_lifetime.get();
            const json::Value exit_out = exited.get();

            const json::Value* t = value_at(timeout_out, "status");
            if (t == nullptr || text_at(*t, "state") != "killed" || text_at(*t, "reason") != "timeout")
                result.failures.push_back("timeout bound: a 2000 ms job with a 5000 ms lifetime ended " + json::dump(t != nullptr ? *t : json::Value()).substr(0, 200));
            const double timeout_elapsed = number_at(timeout_out, "elapsed");
            if (timeout_elapsed < 1900 || timeout_elapsed >= 6000) result.failures.push_back("timeout bound: the job ended after " + std::to_string(timeout_elapsed) + " ms, expected about 2000");

            const json::Value* l = value_at(lifetime_out, "status");
            if (l == nullptr || text_at(*l, "state") != "killed" || text_at(*l, "reason") != "lifetime")
                result.failures.push_back("lifetime bound: a 7200000 ms job ended " + json::dump(l != nullptr ? *l : json::Value()).substr(0, 200));
            if (l == nullptr || text_at(*l, "statement").find("the job lifetime of " + std::to_string(kLifetimeMs) + " ms") == std::string::npos)
                result.failures.push_back("lifetime bound: the statement is " + (l != nullptr ? text_at(*l, "statement") : std::string()));
            const double lifetime_elapsed = number_at(lifetime_out, "elapsed");
            if (lifetime_elapsed < kLifetimeMs - 200 || lifetime_elapsed >= 9000) result.failures.push_back("lifetime bound: the job ended after " + std::to_string(lifetime_elapsed) + " ms, expected about " + std::to_string(kLifetimeMs));

            const json::Value* e = value_at(exit_out, "status");
            if (e == nullptr || text_at(*e, "state") != "exited" || number_at(*e, "exitCode") != 0)
                result.failures.push_back("natural exit: a 1000 ms job with a 4000 ms timeout ended " + json::dump(e != nullptr ? *e : json::Value()).substr(0, 200));
            const double exit_elapsed = number_at(exit_out, "elapsed");
            if (exit_elapsed >= 4000) result.failures.push_back("natural exit: the job took " + std::to_string(exit_elapsed) + " ms");
            result.summary = "a 2000 ms job timeout ended as timeout in " + std::to_string(timeout_elapsed) + " ms; a 7200000 ms job timeout ended as lifetime at " + std::to_string(lifetime_elapsed) +
                             " ms under a " + std::to_string(kLifetimeMs) + " ms lifetime; a 1000 ms job exited 0 in " + std::to_string(exit_elapsed) + " ms";
        }
        session.stop();
    }
    std::error_code ignored;
    fs::remove_all(sandbox, ignored);
    const double wall = std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count();
    result.summary += " (wall " + std::to_string(wall) + " s)";
    return result;
}

}
