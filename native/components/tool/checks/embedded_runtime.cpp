#include "gm/tool.hpp"

#include <chrono>
#include <filesystem>
#include <fstream>
#include <system_error>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

constexpr std::int64_t kTimerMs = 300;
constexpr std::int64_t kClockGranularityMs = 1;
constexpr int kFreshRuntimes = 20;

json::Value run(Session& session, const std::string& body, const std::string& format = "") {
    json::Object args{{"body", body}};
    if (!format.empty()) args.push_back({"format", format});
    return tool_json(session, "run_code", args);
}

json::Value value_of(const json::Value& reply) {
    return output_value(reply);
}

bool number_is(const json::Value& value, const std::string& dotted, double expected) {
    const json::Value* found = value_at(value, dotted);
    return found != nullptr && found->is_number() && found->as_number() == expected;
}

bool string_is(const json::Value& value, const std::string& dotted, const std::string& expected) {
    return text_at(value, dotted) == expected;
}

bool flag(const json::Value& value, const std::string& dotted, bool expected) {
    const json::Value* found = value_at(value, dotted);
    return found != nullptr && found->is_bool() && found->as_bool() == expected;
}

}

CheckResult check_embedded_runtime(const std::string& binary) {
    CheckResult result;
    const auto started = std::chrono::steady_clock::now();
    const auto stamp = started.time_since_epoch().count();
    const fs::path scratch = fs::temp_directory_path() / ("gm-embedded-runtime-" + std::to_string(stamp));
    const fs::path workspace = scratch / "ws";
    fs::create_directories(workspace);
    std::ofstream(workspace / "helper.mjs") << "export const doubled = (n) => n * 2;\n";
    long long timer_waited = -1;
    long long ms_per_body = -1;
    bool skipped = false;
    {
        Session session(binary, workspace, scratch, 180000, true);
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + binary);
        } else {
            const json::Value init = session.rpc("initialize", json::Object{{"protocolVersion", "2025-06-18"}, {"capabilities", json::Object{}},
                                                                            {"clientInfo", json::Object{{"name", "embedded-runtime-check"}, {"version", "1"}}}});
            if (value_at(init, "result") == nullptr) result.failures.push_back("no initialize result");
            session.notify("notifications/initialized", json::Object{});
            session.rpc("resources/read", json::Object{{"uri", "skill://gm/SKILL.md"}});
            tool_text(session, "next_context", json::Object{});

            const json::Value globals_reply = run(session, "return { timer: typeof setTimeout, url: typeof URL, encoder: typeof TextEncoder, hostApi: typeof tjs, alert: typeof alert };");
            if (!flag(globals_reply, "ok", true)) {
                result.failures.push_back("the first run_code body did not run: " + json::dump(globals_reply).substr(0, 300));
            } else {
                const json::Value globals = value_of(globals_reply);
                if (string_is(globals, "timer", "undefined")) {
                    skipped = true;
                } else {
                    if (!string_is(globals, "url", "function") || !string_is(globals, "encoder", "function")) result.failures.push_back("the web globals of the embedded runtime are missing: " + json::dump(globals).substr(0, 300));
                    if (!string_is(globals, "hostApi", "undefined") || !string_is(globals, "alert", "undefined")) result.failures.push_back("a body can name the embedded runtime's own host API: " + json::dump(globals).substr(0, 300));

                    const json::Value timed_reply = run(session, "const began = Date.now(); const value = await new Promise((done) => setTimeout(() => done('fired'), " + std::to_string(kTimerMs) + ")); return { value, waited: Date.now() - began };");
                    const json::Value timed = value_of(timed_reply);
                    const json::Value* waited = value_at(timed, "waited");
                    if (waited != nullptr && waited->is_number()) timer_waited = static_cast<long long>(waited->as_number());
                    if (!string_is(timed, "value", "fired") || timer_waited < kTimerMs - kClockGranularityMs)
                        result.failures.push_back("a body awaiting a " + std::to_string(kTimerMs) + " ms timer did not get its value after the wait: " + json::dump(timed_reply).substr(0, 300));

                    const json::Value parsed_reply = run(session, "const url = new URL('https://example.org:8443/a/b?x=1#frag'); return { host: url.host, path: url.pathname, x: url.searchParams.get('x'), bytes: new TextEncoder().encode('gm').length };");
                    const json::Value parsed = value_of(parsed_reply);
                    if (!string_is(parsed, "host", "example.org:8443") || !string_is(parsed, "path", "/a/b") || !string_is(parsed, "x", "1") || !number_is(parsed, "bytes", 2))
                        result.failures.push_back("URL and TextEncoder do not work in a body: " + json::dump(parsed_reply).substr(0, 300));

                    const json::Value logged_reply = run(session, "console.log('not on the protocol stream'); console.error('nor this'); return 'quiet';");
                    const json::Value logged = value_of(logged_reply);
                    const auto strays = session.stray_lines();
                    if (!(logged.is_string() && logged.as_string() == "quiet") || !strays.empty())
                        result.failures.push_back("console output reached the protocol stream: " + (strays.empty() ? std::string("none") : strays.front().substr(0, 200)));

                    const json::Value imported_reply = run(session, "import { doubled } from './helper.mjs';\nreturn doubled(21);", "esm");
                    const json::Value imported = value_of(imported_reply);
                    if (!(imported.is_number() && imported.as_number() == 42)) result.failures.push_back("a body's relative import did not load through the module loader: " + json::dump(imported_reply).substr(0, 300));

                    const json::Value verbs_reply = run(session, "const [file, rows] = await Promise.all([gm.read_file({ path: 'helper.mjs' }), gm.prd_list({})]); return { file: file.output, rowsOk: rows.ok };");
                    const json::Value verbs = value_of(verbs_reply);
                    if (text_at(verbs, "file").find("doubled") == std::string::npos || !flag(verbs, "rowsOk", true))
                        result.failures.push_back("a native verb and a leaf verb did not both answer: " + json::dump(verbs_reply).substr(0, 300));

                    const json::Value pending_reply = run(session, "return await new Promise(() => {});");
                    if (!flag(pending_reply, "ok", false) || text_at(pending_reply, "error").empty())
                        result.failures.push_back("a promise that can never settle, with no timer alive, did not end with an error: " + json::dump(pending_reply).substr(0, 300));

                    const auto round_started = std::chrono::steady_clock::now();
                    for (int round = 0; round < kFreshRuntimes; ++round) run(session, "return 1;");
                    ms_per_body = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - round_started).count() / kFreshRuntimes;
                }
            }
        }
        session.stop();
    }
    std::error_code ignored;
    fs::remove_all(scratch, ignored);
    const double wall = std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count();
    if (skipped) {
        result.summary = "skipped: this build has no embedded txiki runtime, setTimeout is undefined; it is built where GMNEW_TXIKI is ON";
    } else {
        result.summary = "a body awaited a " + std::to_string(kTimerMs) + " ms timer for " + std::to_string(timer_waited) + " ms; URL and TextEncoder work; a body cannot name the runtime's own host API; console output stays off the protocol stream; a relative import loads; a native verb and a leaf verb both answer; a body that never settles ends with an error; " +
                         std::to_string(ms_per_body) + " ms per fresh body (wall " + std::to_string(wall) + " s)";
    }
    return result;
}

}
