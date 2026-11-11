#include "gm/tool.hpp"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdlib>
#include <filesystem>
#include <format>
#include <fstream>
#include <system_error>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

constexpr double kClock = 1.0 / 60.0;
constexpr const char* kToken = "tick-1";

std::int64_t scaled(std::int64_t ms) {
    return std::max<std::int64_t>(1, static_cast<std::int64_t>(std::llround(static_cast<double>(ms) * kClock)));
}

std::string seconds(std::int64_t ms) {
    return std::format("{}", static_cast<double>(ms) / 1000.0);
}

struct Timed {
    long long elapsed = -1;
    json::Value reply;
};

json::Value envelope_of(const json::Value& reply) {
    const json::Value* result = reply.find("result");
    const json::Value* content = result ? result->find("content") : nullptr;
    const json::Value* first = content && content->is_array() && !content->as_array().empty() ? content->as_array().front().find("text") : nullptr;
    const std::string text = first && first->is_string() ? first->as_string() : json::dump(reply);
    auto parsed = json::parse(text);
    if (!parsed) return json::Object{{"ok", false}, {"error", "run_code reply was not JSON: " + text.substr(0, 200)}};
    json::Value envelope = *parsed;
    const json::Value* output = envelope.find("output");
    const bool placeholder = output != nullptr && output->is_string() && output->as_string() == "[the output is the text block after this one]";
    if (placeholder && content->as_array().size() > 1) {
        const json::Value* second = content->as_array()[1].find("text");
        const std::string value = second != nullptr && second->is_string() ? second->as_string() : std::string();
        if (auto value_json = json::parse(value)) envelope.set("output", *value_json);
        else envelope.set("output", value);
    }
    return envelope;
}

Timed run_timed(Session& session, const json::Value& args, const std::string& token = {}) {
    const auto began = std::chrono::steady_clock::now();
    json::Object params{{"name", "run_code"}, {"arguments", args}};
    if (!token.empty()) params.emplace_back("_meta", json::Object{{"progressToken", token}});
    Timed timed;
    const json::Value reply = session.rpc("tools/call", json::Value(params));
    timed.reply = envelope_of(reply);
    timed.elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - began).count();
    return timed;
}

bool flag(const json::Value& value, const std::string& dotted, bool expected) {
    const json::Value* found = value_at(value, dotted);
    return found != nullptr && found->is_bool() && found->as_bool() == expected;
}

bool absent(const json::Value& value, const std::string& dotted) {
    return value_at(value, dotted) == nullptr;
}

std::vector<double> progress_of(const std::vector<json::Value>& notes, const std::string& token) {
    std::vector<double> values;
    for (const json::Value& note : notes) {
        if (text_at(note, "method") != "notifications/progress") continue;
        const json::Value* params = note.find("params");
        if (params == nullptr || text_at(*params, "progressToken") != token) continue;
        const json::Value* progress = params->find("progress");
        values.push_back(progress != nullptr && progress->is_number() ? progress->as_number() : std::nan(""));
    }
    return values;
}

}

CheckResult check_run_code_progress(const std::string& binary) {
    CheckResult result;
    const auto started = std::chrono::steady_clock::now();
    const auto stamp = started.time_since_epoch().count();
    const fs::path sandbox = fs::temp_directory_path() / ("gm-progress-check-" + std::to_string(stamp));
    const fs::path workspace = sandbox / "ws";
    fs::create_directories(workspace);
    std::ofstream(sandbox / "quiet.json") << R"({"mcpServers":{"playwriter":{"disabled":true}}})";
    set_env("GMNEW_TEST_CLOCK", "1");
    set_env("GM_CLOCK_SCALE", "0.016666666666666666");
    std::size_t own_count = 0;
    {
        Session session(binary, workspace, sandbox, 90000, true);
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + binary);
        } else {
            session.rpc("initialize", json::Object{{"protocolVersion", "2025-06-18"}, {"capabilities", json::Object{}},
                                                  {"clientInfo", json::Object{{"name", "gm-progress-check"}, {"version", "1"}}}});
            session.notify("notifications/initialized", json::Object{});
            session.rpc("resources/read", json::Object{{"uri", "skill://gm/SKILL.md"}});

            const std::string tick_body = "return await gm.run_shell({ command: 'sleep " + seconds(scaled(15000)) + "; echo ticked', timeoutMs: 20000 });";
            const Timed ticks = run_timed(session, json::Object{{"format", "esm"}, {"timeoutMs", scaled(60000)}, {"body", tick_body}}, kToken);
            const json::Value tick_value = output_value(ticks.reply);
            if (!flag(ticks.reply, "ok", true) || !absent(ticks.reply, "background"))
                result.failures.push_back("foreground: expected a foreground reply, got " + json::dump(ticks.reply).substr(0, 200));
            if (ticks.elapsed < scaled(14000))
                result.failures.push_back("foreground: returned after " + std::to_string(ticks.elapsed) + " ms, expected the " + std::to_string(scaled(15000)) + " ms body to run to its end");
            if (text_at(tick_value, "output").find("ticked") == std::string::npos)
                result.failures.push_back("foreground: output was " + json::dump(tick_value).substr(0, 200));
            const std::vector<json::Value> notes = session.notes();
            const std::vector<double> own = progress_of(notes, kToken);
            own_count = own.size();
            if (own.empty())
                result.failures.push_back("progress: no notifications/progress with progressToken tick-1 arrived during the " + std::to_string(scaled(15000)) + " ms body (three tick intervals of " +
                                          std::to_string(scaled(5000)) + " ms)");
            bool increasing = true;
            for (std::size_t i = 1; i < own.size(); ++i) increasing = increasing && own[i] > own[i - 1];
            if (!increasing) result.failures.push_back("progress: progress values must increase");

            const std::string short_body = "return await gm.run_shell({ command: 'sleep " + seconds(scaled(60000)) + "; echo late', timeoutMs: 10000 });";
            const Timed brief = run_timed(session, json::Object{{"format", "esm"}, {"timeoutMs", scaled(2000)}, {"body", short_body}});
            const json::Value* background = value_at(brief.reply, "background");
            if (background == nullptr || !background->is_string() || text_at(brief.reply, "state") != "running")
                result.failures.push_back("budget: a " + std::to_string(scaled(2000)) + " ms timeoutMs call should move to background, got " + json::dump(brief.reply).substr(0, 200));

            const std::string longer_body = "return await gm.run_shell({ command: 'sleep " + seconds(scaled(4000)) + "; echo inside', timeoutMs: 10000 });";
            const Timed longer = run_timed(session, json::Object{{"format", "esm"}, {"timeoutMs", scaled(30000)}, {"body", longer_body}});
            const json::Value longer_value = output_value(longer.reply);
            if (!flag(longer.reply, "ok", true) || !absent(longer.reply, "background"))
                result.failures.push_back("budget: a " + std::to_string(scaled(30000)) + " ms timeoutMs call moved to background: " + json::dump(longer.reply).substr(0, 200));
            if (text_at(longer_value, "output").find("inside") == std::string::npos)
                result.failures.push_back("budget: a " + std::to_string(scaled(30000)) + " ms timeoutMs call returned " + json::dump(longer_value).substr(0, 200));
        }
        session.stop();
    }
    unset_env("GMNEW_TEST_CLOCK");
    unset_env("GM_CLOCK_SCALE");
    std::error_code ignored;
    fs::remove_all(sandbox, ignored);
    const double wall = std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count();
    result.summary = std::to_string(scaled(15000)) + " ms foreground body gave " + std::to_string(own_count) + " progress notice(s); a " + std::to_string(scaled(2000)) +
                     " ms budget backgrounded while its " + std::to_string(scaled(60000)) + " ms body was still running; a " + std::to_string(scaled(30000)) +
                     " ms budget returned foreground (wall " + std::to_string(wall) + " s)";
    return result;
}

}
