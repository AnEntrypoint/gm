#include "gm/tool.hpp"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <system_error>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

constexpr double kClock = 1.0 / 60.0;
constexpr std::size_t kUnchangedReplyBytes = 1200;

std::int64_t scaled(std::int64_t ms) {
    return std::max<std::int64_t>(1, static_cast<std::int64_t>(std::llround(static_cast<double>(ms) * kClock)));
}

std::string seconds_of(std::int64_t ms) {
    char text[32];
    std::snprintf(text, sizeof text, "%g", static_cast<double>(ms) / 1000.0);
    return text;
}

std::string brief(const json::Value& value) {
    return json::dump(value).substr(0, 300);
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

bool is_number(const json::Value& value, const std::string& dotted) {
    const json::Value* found = value_at(value, dotted);
    return found != nullptr && found->is_number();
}

double number_at(const json::Value& value, const std::string& dotted) {
    const json::Value* found = value_at(value, dotted);
    return found != nullptr && found->is_number() ? found->as_number() : -1;
}

bool is_string(const json::Value& value, const std::string& dotted) {
    const json::Value* found = value_at(value, dotted);
    return found != nullptr && found->is_string();
}

bool same_at(const json::Value& left, const json::Value& right, const std::string& dotted) {
    const json::Value* a = value_at(left, dotted);
    const json::Value* b = value_at(right, dotted);
    if (a == nullptr || b == nullptr) return a == b;
    return json::dump(*a) == json::dump(*b);
}

std::string field(const json::Value& value, const std::string& dotted) {
    const json::Value* found = value_at(value, dotted);
    return found == nullptr ? std::string("undefined") : json::dump(*found);
}

std::string trimmed(std::string text) {
    const auto first = text.find_first_not_of(" \t\r\n");
    if (first == std::string::npos) return {};
    const auto last = text.find_last_not_of(" \t\r\n");
    return text.substr(first, last - first + 1);
}

json::Value structured(Session& session, const std::string& name, json::Value args) {
    const json::Value reply = session.rpc("tools/call", json::Object{{"name", name}, {"arguments", std::move(args)}});
    const json::Value* content = value_at(reply, "result.structuredContent");
    if (content != nullptr && content->is_object()) return *content;
    return json::Object{};
}

struct Code {
    json::Value reply;
    json::Value value;
};

Code code(Session& session, const std::string& body, std::int64_t timeout_ms = -1) {
    json::Object args{{"body", body}};
    if (timeout_ms >= 0) args.emplace_back("timeoutMs", timeout_ms);
    Code run;
    run.reply = tool_json(session, "run_code", json::Value(std::move(args)));
    run.value = output_value(run.reply);
    return run;
}

}

CheckResult check_turn_economy(const std::string& binary) {
    CheckResult result;
    const auto started = std::chrono::steady_clock::now();
    const auto stamp = started.time_since_epoch().count();
    const fs::path sandbox = fs::temp_directory_path() / ("gm-turn-economy-" + std::to_string(stamp));
    const fs::path workspace = sandbox / "ws";
    fs::create_directories(workspace);
    std::ofstream(sandbox / "quiet.json") << R"({"mcpServers":{"playwriter":{"disabled":true}}})";
    std::ofstream(workspace / "a.txt") << "alpha\n";
    std::ofstream(workspace / "b.txt") << "beta\n";
    const std::int64_t old_wait_cap_ms = scaled(30000);
    const std::int64_t slow_job_ms = scaled(45000);
    setenv("GMNEW_TEST_CLOCK", "1", 1);
    setenv("GM_CLOCK_SCALE", "0.016666666666666666", 1);
    std::size_t full_reply_bytes = 0;
    std::size_t unchanged_reply_bytes = 0;
    long long slow_waited_ms = -1;
    long long jobs_body_wall_ms = -1;
    {
        Session session(binary, workspace, sandbox, 300000, true);
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + binary);
        } else {
            const json::Value init = session.rpc("initialize", json::Object{{"protocolVersion", "2025-06-18"}, {"capabilities", json::Object{}},
                                                                            {"clientInfo", json::Object{{"name", "turn-economy-check"}, {"version", "1"}}}});
            if (absent(init, "result")) {
                const std::string errors = trimmed(session.stderr_text());
                result.failures.push_back("no initialize result (stderr " + (errors.empty() ? std::string("(empty)") : errors) + ")");
            }
            session.notify("notifications/initialized", json::Object{});
            session.rpc("resources/read", json::Object{{"uri", "skill://gm/SKILL.md"}});

            const json::Value first = structured(session, "next_context", json::Object{});
            if (!flag(first, "ok", true) || !number_is(first, "step", 1) || !is_string(first, "rules") || text_at(first, "rules").find("not before every step") == std::string::npos)
                result.failures.push_back("the first next_context is not a full step 1 with the new rule 2: " +
                                          brief(json::Object{{"ok", first.find("ok") ? *first.find("ok") : json::Value()},
                                                             {"step", first.find("step") ? *first.find("step") : json::Value()},
                                                             {"rules", text_at(first, "rules").substr(0, 200)}}));

            const json::Value repeat = structured(session, "next_context", json::Object{});
            full_reply_bytes = json::dump(first).size();
            unchanged_reply_bytes = json::dump(repeat).size();
            if (!flag(repeat, "ok", true) || !flag(repeat, "unchanged", true) || !absent(repeat, "rules") || !absent(repeat, "task"))
                result.failures.push_back("a second next_context with nothing new is not the short unchanged reply: " + brief(repeat));
            if (!same_at(repeat, first, "stepsLeft"))
                result.failures.push_back("the unchanged reply used a step: stepsLeft " + field(repeat, "stepsLeft") + ", was " + field(first, "stepsLeft"));
            if (unchanged_reply_bytes > kUnchangedReplyBytes)
                result.failures.push_back("the unchanged reply is " + std::to_string(unchanged_reply_bytes) + " bytes; the limit is " + std::to_string(kUnchangedReplyBytes));

            const Code batch = code(session, "const [a, b] = await Promise.all([gm.read_file({ path: 'a.txt' }), gm.read_file({ path: 'b.txt' })]); return { a: a.output, b: b.output };");
            if (text_at(batch.value, "a") != "alpha\n" || text_at(batch.value, "b") != "beta\n")
                result.failures.push_back("a two-verb body did not return both files: " + brief(batch.reply));
            if (!absent(batch.reply, "batchNotice") || !absent(batch.reply, "pendingEvents"))
                result.failures.push_back("a two-verb body with nothing pending carries a notice: batchNotice " + field(batch.reply, "batchNotice") + ", pendingEvents " + field(batch.reply, "pendingEvents"));

            const json::Value after_own_call = structured(session, "next_context", json::Object{});
            if (!flag(after_own_call, "unchanged", true))
                result.failures.push_back("next_context after only the caller's own run_code is not unchanged: unchanged " + field(after_own_call, "unchanged") + ", step " + field(after_own_call, "step"));

            const json::Value forced = structured(session, "next_context", json::Object{{"full", true}});
            if (!flag(forced, "ok", true) || !number_is(forced, "step", 2) || !is_string(forced, "rules"))
                result.failures.push_back("next_context with full: true is not a full step 2: ok " + field(forced, "ok") + ", step " + field(forced, "step") + ", unchanged " + field(forced, "unchanged"));

            std::vector<json::Value> singles;
            for (int round = 0; round < 3; ++round) singles.push_back(code(session, "return (await gm.read_file({ path: 'a.txt' })).output;").reply);
            if (!absent(singles[0], "batchNotice") || !absent(singles[1], "batchNotice"))
                result.failures.push_back("a batch notice came before the third single-verb body");
            if (!is_string(singles[2], "batchNotice") || text_at(singles[2], "batchNotice").find("one body") == std::string::npos)
                result.failures.push_back("the third single-verb body in a row has no batch notice: " + brief(singles[2]));

            const std::string jobs_body =
                "const [slow, short, gone] = await Promise.all([\n"
                "  (async () => { await gm.job_start({ job: 'slow', command: 'sleep " + seconds_of(slow_job_ms) + "; echo slow', timeoutMs: 120000 }); const began = Date.now(); const ended = await gm.job_status({ job: 'slow', waitMs: 120000, tail: 5 }); return { state: ended.state, exitCode: ended.exitCode, output: ended.output, durMs: ended.durMs, waitedMs: Date.now() - began }; })(),\n"
                "  (async () => { await gm.job_start({ job: 'short', command: 'sleep 30', timeoutMs: 500 }); const ended = await gm.job_status({ job: 'short', waitMs: 20000, tail: 200 }); return { state: ended.state, reason: ended.reason, statement: ended.statement }; })(),\n"
                "  (async () => { await gm.job_start({ job: 'quick', command: 'sleep " + seconds_of(scaled(2000)) + "' }); const pid = (await gm.job_status({ job: 'quick' })).pid; const waited = await gm.job_status({ pid, waitMs: 20000 }); return { pid, state: waited.state, waitedMs: waited.waitedMs, exitCode: waited.exitCode }; })(),\n"
                "]);\n"
                "return { slow, short, gone };";
            const auto jobs_began = std::chrono::steady_clock::now();
            const Code jobs = code(session, jobs_body, 150000);
            jobs_body_wall_ms = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - jobs_began).count();
            const json::Value* slow_found = value_at(jobs.value, "slow");
            const json::Value* stopped_found = value_at(jobs.value, "short");
            const json::Value* gone_found = value_at(jobs.value, "gone");
            const json::Value slow = slow_found ? *slow_found : json::Value();
            const json::Value stopped = stopped_found ? *stopped_found : json::Value();
            const json::Value gone = gone_found ? *gone_found : json::Value();
            if (is_number(slow, "waitedMs")) slow_waited_ms = static_cast<long long>(number_at(slow, "waitedMs"));
            if (text_at(slow, "state") != "exited" || !number_is(slow, "exitCode", 0) || trimmed(text_at(slow, "output")) != "slow")
                result.failures.push_back("one job_status call did not return the slow job's exit and its 5-character tail: " + brief(slow));
            if (!is_number(slow, "waitedMs") || number_at(slow, "waitedMs") <= static_cast<double>(old_wait_cap_ms))
                result.failures.push_back("the wait returned after " + field(slow, "waitedMs") + " ms, not past the old " + std::to_string(old_wait_cap_ms) + " ms cap");
            if (!is_number(slow, "durMs") || number_at(slow, "durMs") < static_cast<double>(slow_job_ms))
                result.failures.push_back("the ended job has no wall time: durMs " + field(slow, "durMs"));
            if (text_at(stopped, "state") != "killed" || text_at(stopped, "reason") != "timeout" || text_at(stopped, "statement").find("pass timeoutMs") == std::string::npos)
                result.failures.push_back("a job stopped at its limit does not say how to raise it: " + brief(stopped));
            const json::Value* gone_exit = value_at(gone, "exitCode");
            if (text_at(gone, "state") != "gone" || gone_exit == nullptr || !gone_exit->is_null() || !is_number(gone, "waitedMs") || number_at(gone, "waitedMs") >= 15000)
                result.failures.push_back("job_status with a pid did not wait for the process to end: " + brief(gone));
            if (!flag(jobs.reply, "pendingEvents", true))
                result.failures.push_back("a run_code reply with job events queued has no pendingEvents: pendingEvents " + field(jobs.reply, "pendingEvents"));

            const json::Value after_jobs = structured(session, "next_context", json::Object{});
            if (!flag(after_jobs, "ok", true) || !absent(after_jobs, "unchanged") || !is_string(after_jobs, "rules") || !number_is(after_jobs, "step", 3))
                result.failures.push_back("next_context with job events pending is not a full step: unchanged " + field(after_jobs, "unchanged") + ", step " + field(after_jobs, "step"));
            const json::Value settled = structured(session, "next_context", json::Object{});
            if (!flag(settled, "unchanged", true))
                result.failures.push_back("next_context after the events were delivered is not unchanged: unchanged " + field(settled, "unchanged") + ", step " + field(settled, "step"));
        }
        session.stop();
    }
    unsetenv("GMNEW_TEST_CLOCK");
    unsetenv("GM_CLOCK_SCALE");
    std::error_code ignored;
    fs::remove_all(sandbox, ignored);
    const double wall = std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count();
    result.summary = "a next_context with nothing new answers unchanged in " + std::to_string(unchanged_reply_bytes) + " bytes against " + std::to_string(full_reply_bytes) +
                     " for a full reply and takes no step; full: true and pending events give a full step; the third single-verb body carries batchNotice; one job_status call waited " +
                     std::to_string(slow_waited_ms) + " ms for a job and returned its exit code, tail and wall time; a job stopped at its limit says to pass timeoutMs; a pid wait returned when the process ended; a reply with events queued carries pendingEvents; the job body took " +
                     std::to_string(jobs_body_wall_ms) + " ms (wall " + std::to_string(wall) + " s)";
    return result;
}

}
