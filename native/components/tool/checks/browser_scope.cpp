#include "gm/tool.hpp"
#if !defined(_WIN32)

#include <chrono>
#include <filesystem>
#include <regex>
#include <system_error>
#include <thread>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

const std::string kMarker = "gm-browser-scope-marker";
const std::string kOpenCode = "const p = await context.newPage(); state.gmScopeCheck = p; await p.goto('data:text/html,<title>" + kMarker + "</title>'); return p.url();";
const std::string kSideCode = "const other = await browser.newContext(); await (await other.newPage()).goto('data:text/html,<title>side</title>'); const project = browser.contexts().find((c) => c !== state.gmRun); const projectPage = await project.newPage(); state.gmSideCheck = { other, projectPage }; return 'sided';";
const std::string kUndoCode = "const side = state.gmSideCheck; if (side) { await side.projectPage.close(); await side.other.close(); } delete state.gmSideCheck; return 'undone';";
const std::string kCountCode = "let n = -1; for (let i = 0; i < 10; i += 1) { n = 0; for (const c of browser.contexts()) for (const p of c.pages()) if (!p.isClosed() && p.url().includes('" + kMarker + "')) n += 1; if (n === 0) break; await new Promise((done) => setTimeout(done, 1000)); } return n;";
constexpr std::int64_t kCallMs = 180000;

const json::Value* field(const json::Value& value, const char* key) {
    return value.is_object() ? value.find(key) : nullptr;
}

json::Value part(const json::Value& value, const char* key) {
    const json::Value* found = field(value, key);
    return found != nullptr ? *found : json::Value();
}

bool flag(const json::Value& value, const char* key) {
    const json::Value* found = field(value, key);
    return found != nullptr && found->is_bool() && found->as_bool();
}

bool text_equals(const json::Value& value, const char* key, const std::string& text) {
    const json::Value* found = field(value, key);
    return found != nullptr && found->is_string() && found->as_string() == text;
}

bool text_has(const json::Value& value, const char* key, const std::string& text) {
    const json::Value* found = field(value, key);
    return found != nullptr && found->is_string() && found->as_string().find(text) != std::string::npos;
}

double number(const json::Value& value, const char* key) {
    const json::Value* found = field(value, key);
    return found != nullptr && found->is_number() ? found->as_number() : -1;
}

bool has_exactly(const json::Value& value, std::vector<std::string> keys) {
    if (!value.is_object() || value.as_object().size() != keys.size()) return false;
    for (const std::string& key : keys) {
        if (value.find(key) == nullptr) return false;
    }
    return true;
}

json::Value run_code(Session& session, const std::string& body) {
    return tool_json(session, "run_code", json::Object{{"format", "esm"}, {"timeoutMs", kCallMs}, {"body", body}});
}

json::Value output_of(const json::Value& reply) {
    const json::Value output = part(reply, "output");
    if (output.is_string()) {
        if (auto parsed = json::parse(output.as_string())) return *parsed;
    }
    return output;
}

json::Value install_sandbox(const fs::path& binary, const fs::path& home) {
    const fs::path host = binary.parent_path();
    const fs::path build = host.parent_path().parent_path().parent_path();
    const fs::path source = build.parent_path().parent_path();
    const auto done = proc::run({"env", "HOME=" + home.string(), (host / "gm").string(), "install", "--local", build.string(), "--source", source.string()}, home, {}, 900000);
    const std::string text = done.err.empty() ? done.out : done.err;
    return json::Object{{"ok", done.started && done.exit_code == 0}, {"error", text.substr(0, 400)}};
}

}

CheckResult check_browser_scope(const std::string& binary) {
    CheckResult result;
#if defined(__linux__)
    const auto started = std::chrono::steady_clock::now();
    const auto stamp = started.time_since_epoch().count();
    const fs::path sandbox = fs::temp_directory_path() / ("gm-browser-scope-" + std::to_string(stamp));
    const fs::path home = sandbox / "home";
    const fs::path workspace = sandbox / "ws";
    fs::create_directories(home);
    fs::create_directories(workspace);
    auto expect = [&](bool condition, const std::string& text) {
        if (!condition) result.failures.push_back(text);
    };
    std::vector<long long> tree;
    std::string browser_phase = "skipped: playwriter_execute is not served on this engine";
    const json::Value installed_reply = install_sandbox(binary, home);
    expect(flag(installed_reply, "ok"), "the clean install failed: " + json::dump(part(installed_reply, "error")));
    if (result.failures.empty()) {
        const fs::path installed = home / ".gmnew" / "current" / "gm";
        Session session(installed.string(), workspace, home, 900000, false);
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + installed.string());
        } else {
            session.rpc("initialize", json::Object{{"protocolVersion", "2025-06-18"}, {"capabilities", json::Object{}},
                                                  {"clientInfo", json::Object{{"name", "gm-tool"}, {"version", "1"}}}});
            session.notify("notifications/initialized", json::Object{});
            session.rpc("resources/read", json::Object{{"uri", "skill://gm/SKILL.md"}});
            const json::Value first = tool_json(session, "next_context", json::Object{});
            expect(flag(first, "ok"), "next_context did not start");
            const json::Value* tabs_field = field(first, "tabs");
            expect(tabs_field != nullptr && tabs_field->is_string(), "next_context reply has no tabs field");

            const json::Value probe = run_code(session, "return { execute: typeof gm.playwriter_execute === 'function', browsers: typeof gm.playwriter_browsers === 'function', tabs: await gm.browser_tabs({}), closeMachine: await gm.browser_close_machine({ confirm: false }), closeRun: typeof gm.playwriter_browsers === 'function' ? await gm.playwriter_browsers({ action: 'close' }) : null };");
            expect(flag(probe, "ok"), "run_code probe failed: " + json::dump(probe).substr(0, 300));
            if (flag(probe, "ok")) {
                const json::Value got = output_of(probe);
                const json::Value tabs = part(got, "tabs");
                expect(text_equals(tabs, "state", "none") && text_equals(tabs, "text", "tabs: none in this run"), "browser_tabs before any browser use did not report none");
                expect(!flag(part(got, "closeMachine"), "ok"), "browser_close_machine without confirm must be refused");
                if (flag(got, "browsers")) {
                    const json::Value close_run = part(got, "closeRun");
                    expect(has_exactly(close_run, {"ok", "closedPages", "skipped"}) && flag(close_run, "ok") && number(close_run, "closedPages") == 0 && flag(close_run, "skipped"),
                           "playwriter_browsers close with no browser use must be {ok, closedPages 0, skipped}");
                }
            }

            const json::Value finish_plain = tool_json(session, "finish", json::Object{{"witness", "browser-scope check: non-browser phase"}});
            expect(flag(finish_plain, "ok") && flag(finish_plain, "finished"), "finish did not end the run");
            const json::Value plain_browser = part(finish_plain, "browser");
            expect(has_exactly(plain_browser, {"ok", "closedPages", "skipped"}) && flag(plain_browser, "skipped") && number(plain_browser, "closedPages") == 0,
                   "finish reply browser key must be {ok, closedPages 0, skipped true} when no browser was used");

            tool_json(session, "next_context", json::Object{});
            const json::Value served = output_of(run_code(session, "return { execute: typeof gm.playwriter_execute === 'function' };"));
            if (flag(served, "execute")) {
                const json::Value opened = run_code(session, "return { exec: await gm.playwriter_execute({ code: " + json::quote(kOpenCode) + " }), tabs: await gm.browser_tabs({}) };");
                if (!flag(opened, "ok")) {
                    browser_phase = "failed: the browser open did not run";
                    result.failures.push_back("browser phase: " + browser_phase + ": " + json::dump(part(opened, "error")));
                } else {
                    const json::Value got = output_of(opened);
                    const json::Value exec = part(got, "exec");
                    const json::Value tabs = part(got, "tabs");
                    expect(flag(exec, "ok") && text_has(exec, "output", kMarker), "playwriter_execute did not open the marker page");
                    expect(text_equals(tabs, "state", "changed") && text_has(tabs, "text", "tabs: 1 in this run"), "browser_tabs did not list the run's page");
                    const json::Value sided = run_code(session, "return { side: await gm.playwriter_execute({ code: " + json::quote(kSideCode) + " }), tabs: await gm.browser_tabs({}), undo: await gm.playwriter_execute({ code: " + json::quote(kUndoCode) + " }) };");
                    if (flag(sided, "ok")) {
                        const json::Value both = output_of(sided);
                        const json::Value tabs_after = part(both, "tabs");
                        const json::Value text_value = part(tabs_after, "text");
                        const std::string text = text_value.is_string() ? text_value.as_string() : std::string();
                        const std::regex other_runs("(\\d+) in other runs");
                        const std::regex project_tabs("(\\d+) in the project browser");
                        std::smatch other_match;
                        std::smatch project_match;
                        expect(flag(part(both, "side"), "ok"), "the side pages did not open");
                        expect(text.find("tabs: 1 in this run") != std::string::npos, "browser_tabs lost the run page after the side pages: " + text);
                        expect(std::regex_search(text, other_match, other_runs) && std::stoi(other_match[1].str()) >= 1, "browser_tabs did not count the page of another context: " + text);
                        expect(std::regex_search(text, project_match, project_tabs) && std::stoi(project_match[1].str()) >= 1, "browser_tabs did not count the project browser page: " + text);
                    } else {
                        result.failures.push_back("browser phase: the tab split did not run: " + json::dump(part(sided, "error")));
                    }
                    const json::Value finish_used = tool_json(session, "finish", json::Object{{"witness", "browser-scope check: browser phase, page opened in the run"}});
                    const json::Value used_browser = part(finish_used, "browser");
                    expect(flag(finish_used, "ok") && has_exactly(used_browser, {"ok", "closedPages"}) && flag(used_browser, "ok") && number(used_browser, "closedPages") >= 1,
                           "finish reply browser key must be {ok, closedPages >= 1} after the run opened a page");
                    tool_json(session, "next_context", json::Object{});
                    const json::Value counted = run_code(session, "return { count: await gm.playwriter_execute({ code: " + json::quote(kCountCode) + " }), close: await gm.browser_close_machine({ confirm: true, force: true }) };");
                    if (flag(counted, "ok")) {
                        const json::Value both = output_of(counted);
                        const json::Value count_output = part(part(both, "count"), "output");
                        const std::string count_text = count_output.is_string() ? count_output.as_string() : std::string();
                        const std::regex value("\\[return value\\] (-?\\d+)");
                        std::smatch match;
                        expect(std::regex_search(count_text, match, value) && std::stoi(match[1].str()) == 0, "the run's page is still open after finish: " + count_text);
                        expect(flag(part(both, "close"), "ok"), "browser_close_machine with confirm did not close the scratch browser");
                    } else {
                        result.failures.push_back("browser phase: the page count did not run: " + json::dump(part(counted, "error")));
                    }
                    tool_json(session, "finish", json::Object{{"witness", "browser-scope check: browser phase closed"}});
                    bool phase_failed = false;
                    for (const std::string& text : result.failures) {
                        if (text.rfind("browser phase", 0) == 0) phase_failed = true;
                    }
                    if (!phase_failed) browser_phase = "ran: the run page was listed, closed by finish, and gone from the browser after finish";
                }
            }
            std::vector<long long> roots = session.descendants();
            for (const long long pid : processes_mentioning(home.string())) roots.push_back(pid);
            tree = process_tree(roots);
        }
        session.stop();
    }
    kill_processes(tree);
    std::this_thread::sleep_for(std::chrono::milliseconds(200));
    const auto survivors = alive_of(tree);
    if (!survivors.empty()) {
        std::string ids;
        for (const long long pid : survivors) ids += (ids.empty() ? "" : " ") + std::to_string(pid);
        result.failures.push_back(std::to_string(survivors.size()) + " process(es) started by this check are still alive: " + ids);
    }
    std::error_code ignored;
    fs::remove_all(sandbox, ignored);
    const double wall = std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count();
    result.summary = "browser scope: finish browser key, browser_tabs, playwriter_browsers close, browser_close_machine guard; browser run: " + browser_phase + " (wall " + std::to_string(wall) + " s)";
#else
    result.summary = "not measured: the browser check runs the launcher under a Linux process tree";
#endif
    return result;
}

}
#else

namespace gm::tool {

CheckResult check_browser_scope(const std::string&) {
    CheckResult result;
    result.summary = "skipped: POSIX-only check, runs on Linux and macOS";
    return result;
}

}
#endif
