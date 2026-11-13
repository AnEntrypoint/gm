#include "gm/tool.hpp"
#if !defined(_WIN32)

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <future>
#include <system_error>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

constexpr double kClock = 1.0 / 60.0;

std::string slow_line() {
    return std::string(31, 'a') + "b";
}

std::int64_t scaled(std::int64_t ms) {
    return std::max<std::int64_t>(1, static_cast<std::int64_t>(std::llround(static_cast<double>(ms) * kClock)));
}

struct Timed {
    long long elapsed = -1;
    json::Value reply;
};

Timed run_timed(Session& session, const json::Value& args) {
    const auto began = std::chrono::steady_clock::now();
    Timed timed;
    timed.reply = tool_json(session, "run_code", args);
    timed.elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - began).count();
    return timed;
}

json::Value output_of(const json::Value& reply) {
    return output_value(reply);
}

bool flag(const json::Value& value, const std::string& dotted, bool expected) {
    const json::Value* found = value_at(value, dotted);
    return found != nullptr && found->is_bool() && found->as_bool() == expected;
}

bool absent(const json::Value& value, const std::string& dotted) {
    return value_at(value, dotted) == nullptr;
}

bool number_is(const json::Value& value, const std::string& dotted, double expected) {
    const json::Value* found = value_at(value, dotted);
    return found != nullptr && found->is_number() && found->as_number() == expected;
}

}

CheckResult check_run_code_budget(const std::string& binary) {
    CheckResult result;
    const auto started = std::chrono::steady_clock::now();
    const auto stamp = started.time_since_epoch().count();
    const fs::path sandbox = fs::temp_directory_path() / ("gm-budget-check-" + std::to_string(stamp));
    const fs::path workspace = sandbox / "ws";
    fs::create_directories(workspace);
    std::ofstream(sandbox / "quiet.json") << R"({"mcpServers":{"playwriter":{"disabled":true}}})";
    const std::int64_t hold_ms = scaled(50000);
    const std::int64_t fetch_ms = std::max<std::int64_t>(300, scaled(3000));
    set_env("GMNEW_TEST_CLOCK", "1");
    set_env("GM_CLOCK_SCALE", "0.016666666666666666");
    long long spin_elapsed = -1;
    long long leaf_elapsed = -1;
    long long matched_elapsed = -1;
    long long timed_out_elapsed = -1;
    long long capped_elapsed = -1;
    {
        HoldServer server(std::chrono::milliseconds(hold_ms), slow_line() + "\n");
        if (server.port() == 0) {
            result.failures.push_back("the local test server did not listen");
        } else {
            Session session(binary, workspace, sandbox, 240000, true);
            if (!session.started()) {
                result.failures.push_back("gm serve did not start from " + binary);
            } else {
                session.rpc("initialize", json::Object{{"protocolVersion", "2025-06-18"}, {"capabilities", json::Object{}},
                                                      {"clientInfo", json::Object{{"name", "gm-budget-check"}, {"version", "1"}}}});
                session.notify("notifications/initialized", json::Object{});
                session.rpc("resources/read", json::Object{{"uri", "skill://gm/SKILL.md"}});
                tool_json(session, "next_context", json::Object{});
                const std::string port = std::to_string(server.port());
                const std::string capped_body = "const end = Date.now() + " + std::to_string(scaled(115000)) + "; let n = 0; while (Date.now() < end) { n += 1; } return { spun: n > 0 };";
                const std::string spin_body = "const end = Date.now() + " + std::to_string(scaled(65000)) + "; let n = 0; while (Date.now() < end) { n += 1; } return { spun: n > 0 };";
                const std::string leaf_body = "return await gm.fetch({ url: 'http://127.0.0.1:" + port + "/', timeoutMs: " + std::to_string(scaled(60000)) + " });";
                const std::string match_body = "return await gm.fetch({ url: 'http://127.0.0.1:" + port + "/fast', match: '(a+)+$', timeoutMs: " + std::to_string(fetch_ms) + " });";
                const std::string timeout_body = "return await gm.fetch({ url: 'http://127.0.0.1:" + port + "/', timeoutMs: " + std::to_string(fetch_ms) + " });";
                auto spin = std::async(std::launch::async, [&] {
                    return run_timed(session, json::Object{{"format", "esm"}, {"timeoutMs", scaled(100000)}, {"body", spin_body}});
                });
                auto leaf = std::async(std::launch::async, [&] {
                    return run_timed(session, json::Object{{"format", "esm"}, {"timeoutMs", scaled(400000)}, {"body", leaf_body}});
                });
                auto capped = std::async(std::launch::async, [&] {
                    return run_timed(session, json::Object{{"format", "esm"}, {"timeoutMs", 300000}, {"body", capped_body}});
                });
                auto matched = std::async(std::launch::async, [&] {
                    return run_timed(session, json::Object{{"format", "esm"}, {"timeoutMs", 100000}, {"body", match_body}});
                });
                auto timed_out = std::async(std::launch::async, [&] {
                    return run_timed(session, json::Object{{"format", "esm"}, {"timeoutMs", 100000}, {"body", timeout_body}});
                });
                const Timed spin_run = spin.get();
                const Timed leaf_run = leaf.get();
                const Timed matched_run = matched.get();
                const Timed capped_run = capped.get();
                const Timed timed_out_run = timed_out.get();
                spin_elapsed = spin_run.elapsed;
                leaf_elapsed = leaf_run.elapsed;
                matched_elapsed = matched_run.elapsed;
                capped_elapsed = capped_run.elapsed;
                timed_out_elapsed = timed_out_run.elapsed;

                const json::Value spin_value = output_of(spin_run.reply);
                if (!flag(spin_run.reply, "ok", true) || !absent(spin_run.reply, "background"))
                    result.failures.push_back("js budget: a " + std::to_string(scaled(100000)) + " ms timeoutMs body moved to background or failed: " + json::dump(spin_run.reply).substr(0, 200));
                if (spin_elapsed < scaled(64000)) result.failures.push_back("js budget: the " + std::to_string(scaled(65000)) + " ms body returned after " + std::to_string(spin_elapsed) + " ms");
                if (!flag(spin_value, "spun", true)) result.failures.push_back("js budget: the body returned " + json::dump(spin_value).substr(0, 200));

                const std::string leaf_dump = json::dump(leaf_run.reply);
                if (leaf_dump.find("passed its deadline of " + std::to_string(scaled(120000)) + " ms") != std::string::npos || leaf_dump.find("passed its deadline of " + std::to_string(scaled(60000)) + " ms") != std::string::npos)
                    result.failures.push_back("leaf deadline: the old fixed limit cut the fetch leaf after " + std::to_string(leaf_elapsed) + " ms: " + leaf_dump.substr(0, 200));
                if (leaf_elapsed < hold_ms) result.failures.push_back("leaf deadline: the server held the fetch for " + std::to_string(hold_ms) + " ms but the leaf returned after " + std::to_string(leaf_elapsed) + " ms");
                if (!absent(leaf_run.reply, "background") || !number_is(output_of(leaf_run.reply), "status", 200))
                    result.failures.push_back("leaf deadline: expected status 200 in the foreground reply after " + std::to_string(leaf_elapsed) + " ms, got " + leaf_dump.substr(0, 200));

                if (absent(capped_run.reply, "background") || capped_elapsed < scaled(95000) || capped_elapsed >= scaled(115000))
                    result.failures.push_back("foreground cap: a 300000 ms timeoutMs body that runs " + std::to_string(scaled(115000)) + " ms returned after " + std::to_string(capped_elapsed) + " ms without a background run: " + json::dump(capped_run.reply).substr(0, 200));

                const json::Value match_value = output_of(matched_run.reply);
                if (matched_elapsed >= 20000) result.failures.push_back("match bound: a " + std::to_string(fetch_ms) + " ms fetch with a catastrophic match returned after " + std::to_string(matched_elapsed) + " ms");
                const bool match_timed_out = text_at(match_value, "code") == "ETIMEDOUT" && text_at(match_value, "error") == "timed out after " + std::to_string(fetch_ms) + " ms" && number_is(match_value, "attempts", 1);
                const bool regex_limit = text_at(match_value, "error").find("exceeded a pre-set level") != std::string::npos;
                if (!match_timed_out && !regex_limit)
                    result.failures.push_back("match bound: expected a " + std::to_string(fetch_ms) + " ms timeout in one attempt, got " + json::dump(match_value).substr(0, 200));

                const json::Value timeout_value = output_of(timed_out_run.reply);
                if (timed_out_elapsed >= 15000) result.failures.push_back("whole call: a " + std::to_string(fetch_ms) + " ms fetch that times out returned after " + std::to_string(timed_out_elapsed) + " ms");
                if (text_at(timeout_value, "code") != "ETIMEDOUT" || !number_is(timeout_value, "attempts", 1))
                    result.failures.push_back("whole call: expected a timeout in one attempt, got " + json::dump(timeout_value).substr(0, 200));
            }
            session.stop();
        }
    }
    unset_env("GMNEW_TEST_CLOCK");
    unset_env("GM_CLOCK_SCALE");
    std::error_code ignored;
    fs::remove_all(sandbox, ignored);
    const double wall = std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count();
    result.summary = "a " + std::to_string(scaled(115000)) + " ms body with timeoutMs 300000 became a background run at " + std::to_string(capped_elapsed) + " ms (the foreground cap); a " + std::to_string(scaled(65000)) + " ms JavaScript body with timeoutMs " + std::to_string(scaled(100000)) + " returned in " + std::to_string(spin_elapsed) +
                     " ms; a fetch leaf held for " + std::to_string(hold_ms) + " ms ended in " + std::to_string(leaf_elapsed) + " ms with no old fixed limit; a " + std::to_string(fetch_ms) +
                     " ms fetch with a catastrophic match timed out in " + std::to_string(matched_elapsed) + " ms in one attempt; a " + std::to_string(fetch_ms) + " ms fetch that timed out ended in " +
                     std::to_string(timed_out_elapsed) + " ms in one attempt (wall " + std::to_string(wall) + " s)";
    return result;
}

CheckResult check_run_code_lifetime(const std::string& binary) {
    CheckResult result;
    const auto started = std::chrono::steady_clock::now();
    const auto stamp = started.time_since_epoch().count();
    const fs::path sandbox = fs::temp_directory_path() / ("gm-run-code-lifetime-" + std::to_string(stamp));
    const fs::path workspace = sandbox / "ws";
    fs::create_directories(workspace);
    constexpr std::int64_t kLifetimeMs = 4000;
    constexpr std::int64_t kSpinMs = 9000;
    constexpr std::int64_t kHostMs = 6000;
    long long spin_ms = -1;
    long long host_ms = -1;
    {
        Session session(binary, workspace, sandbox, 240000, true, {"--job-lifetime-ms", std::to_string(kLifetimeMs)});
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + binary);
        } else {
            session.rpc("initialize", json::Object{{"protocolVersion", "2025-06-18"}, {"capabilities", json::Object{}},
                                                  {"clientInfo", json::Object{{"name", "gm-run-code-lifetime-check"}, {"version", "1"}}}});
            session.notify("notifications/initialized", json::Object{});
            session.rpc("resources/read", json::Object{{"uri", "skill://gm/SKILL.md"}});
            tool_text(session, "next_context", json::Object{});
            const auto settle = [&session](const std::string& job) {
                json::Value status;
                for (int attempt = 0; attempt < 10; ++attempt) {
                    status = output_of(tool_json(session, "run_code", json::Object{{"format", "esm"}, {"timeoutMs", 150000},
                                                                                  {"body", "return await gm.job_status({ job: " + json::quote(job) + ", waitMs: 100000 });"}}));
                    const std::string state = text_at(status, "state");
                    if (state != "running" && state != "queued") break;
                }
                return status;
            };

            const auto spin_began = std::chrono::steady_clock::now();
            const json::Value spin = tool_json(session, "run_code", json::Object{{"format", "esm"}, {"timeoutMs", 1000},
                                                                                {"body", "const end = Date.now() + " + std::to_string(kSpinMs) + "; while (Date.now() < end) {} return 'spun';"}});
            const std::string spin_job = text_at(spin, "background");
            const json::Value spin_status = spin_job.empty() ? json::Value(json::Object{}) : settle(spin_job);
            spin_ms = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - spin_began).count();
            if (spin_job.empty()) result.failures.push_back("the spin body did not move to background: " + json::dump(spin).substr(0, 200));
            if (!(text_at(spin_status, "state") == "killed" && json::dump(spin_status).find("lifetime") != std::string::npos))
                result.failures.push_back("the spin body ended " + json::dump(spin_status).substr(0, 240));
            if (!(spin_ms >= kLifetimeMs - 500 && spin_ms < kSpinMs))
                result.failures.push_back("the spin body was killed after " + std::to_string(spin_ms) + " ms, not near " + std::to_string(kLifetimeMs) + " ms");

            const auto host_began = std::chrono::steady_clock::now();
            const json::Value host = tool_json(session, "run_code", json::Object{{"format", "esm"}, {"timeoutMs", 1000},
                                                                                {"body", "return await gm.run_shell({ command: 'sleep " + std::to_string(kHostMs / 1000) + "; echo done', timeoutMs: 30000 });"}});
            const std::string host_job = text_at(host, "background");
            const json::Value host_status = host_job.empty() ? json::Value(json::Object{}) : settle(host_job);
            host_ms = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - host_began).count();
            if (host_job.empty()) result.failures.push_back("the host-call body did not move to background: " + json::dump(host).substr(0, 200));
            if (!(text_at(host_status, "state") == "exited" && json::dump(host_status).find("done") != std::string::npos))
                result.failures.push_back("the host-call body ended " + json::dump(host_status).substr(0, 240));
            if (host_ms < kHostMs) result.failures.push_back("the host-call body finished in " + std::to_string(host_ms) + " ms, before its " + std::to_string(kHostMs) + " ms host call");
        }
        session.stop();
    }
    std::error_code ignored;
    fs::remove_all(sandbox, ignored);
    const double wall = std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count();
    result.summary = "a spin body with a " + std::to_string(kLifetimeMs) + " ms job lifetime was killed with reason lifetime after " + std::to_string(spin_ms) +
                     " ms of wall time; a " + std::to_string(kHostMs) + " ms run_shell host call did not count against the lifetime and returned done after " + std::to_string(host_ms) +
                     " ms (wall " + std::to_string(wall) + " s)";
    return result;
}

}
#else

namespace gm::tool {

CheckResult check_run_code_lifetime(const std::string&) {
    CheckResult result;
    result.summary = "skipped: POSIX-only check, runs on Linux and macOS";
    return result;
}

CheckResult check_run_code_budget(const std::string&) {
    CheckResult result;
    result.summary = "skipped: POSIX-only check, runs on Linux and macOS";
    return result;
}

}
#endif
