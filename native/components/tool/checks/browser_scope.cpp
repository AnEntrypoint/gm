#include "gm/tool.hpp"
#if !defined(_WIN32)

#include <algorithm>
#include <chrono>
#include <filesystem>
#include <memory>
#include <regex>
#include <system_error>
#include <thread>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

constexpr int kSettleMs = 3000;
constexpr int kPollMs = 50;

const std::string kMarker = "gm-browser-scope-marker";
const std::string kPeerMarker = "gm-browser-scope-run-b";
const std::string kSideMarker = "gm-browser-scope-side";
const std::string kSideCode = "const other = await browser.newContext(); await (await other.newPage()).goto('data:text/html,<title>" + kSideMarker + "</title>'); const project = browser.contexts()[0]; const projectPage = await project.newPage(); await projectPage.goto('data:text/html,<title>" + kSideMarker + "</title>'); state.gmSideCheck = { other, projectPage }; return 'sided';";
const std::string kUndoCode = "const side = state.gmSideCheck; if (side) { await side.projectPage.close(); await side.other.close(); } delete state.gmSideCheck; return 'undone';";
constexpr std::int64_t kCallMs = 180000;

std::string open_code(const std::string& marker) {
    return "const p = await context.newPage(); state.gmScopeCheck = p; await p.goto('data:text/html,<title>" + marker + "</title>'); return p.url();";
}

std::string count_code(const std::string& marker, bool wait_for_zero) {
    const std::string count = "n = 0; for (const c of browser.contexts()) for (const p of c.pages()) if (!p.isClosed() && p.url().includes('" + marker + "')) n += 1; ";
    if (!wait_for_zero) return "let n = 0; " + count + "return n;";
    return "let n = -1; for (let i = 0; i < 10; i += 1) { " + count + "if (n === 0) break; await new Promise((done) => setTimeout(done, 1000)); } return n;";
}

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

long long returned(const json::Value& exec) {
    const json::Value output = part(exec, "output");
    const std::string text = output.is_string() ? output.as_string() : std::string();
    const std::regex value("\\[return value\\] (-?\\d+)");
    std::smatch match;
    return std::regex_search(text, match, value) ? std::stoll(match[1].str()) : -1;
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

void connect(Session& session) {
    session.rpc("initialize", json::Object{{"protocolVersion", "2025-06-18"}, {"capabilities", json::Object{}},
                                          {"clientInfo", json::Object{{"name", "gm-tool"}, {"version", "1"}}}});
    session.notify("notifications/initialized", json::Object{});
    session.rpc("resources/read", json::Object{{"uri", "skill://gm/SKILL.md"}});
}

struct Owned {
    long long pid = 0;
    long long start = 0;
};

std::vector<Owned> owned_of(const std::vector<long long>& roots) {
    std::vector<Owned> owned;
    for (const long long pid : process_tree(roots)) {
        const long long start = proc::start_time_of(pid);
        if (start > 0) owned.push_back(Owned{pid, start});
    }
    return owned;
}

bool still_ours(const Owned& owned) { return owned.start > 0 && proc::start_time_of(owned.pid) == owned.start; }

std::vector<long long> stop_owned(const std::vector<Owned>& owned) {
    std::vector<long long> stopping;
    for (const Owned& each : owned) {
        if (still_ours(each)) stopping.push_back(each.pid);
    }
    kill_processes(stopping);
    std::vector<long long> survivors = alive_of(stopping);
    const auto began = std::chrono::steady_clock::now();
    while (!survivors.empty() && std::chrono::steady_clock::now() - began < std::chrono::milliseconds(kSettleMs)) {
        std::this_thread::sleep_for(std::chrono::milliseconds(kPollMs));
        survivors = alive_of(stopping);
    }
    return survivors;
}

std::vector<Owned> serve_tree(const Session& session) { return owned_of(session.descendants()); }

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
    std::vector<Owned> tree;
    std::string browser_phase = "skipped: playwriter_execute is not served on this engine";
    const json::Value installed_reply = install_sandbox(binary, home);
    expect(flag(installed_reply, "ok"), "the clean install failed: " + json::dump(part(installed_reply, "error")));
    if (result.failures.empty()) {
        const fs::path installed = home / ".gmnew" / "current" / "gm";
        Session session(installed.string(), workspace, home, 900000, false);
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + installed.string());
        } else {
            connect(session);
            const json::Value first = tool_json(session, "next_context", json::Object{});
            expect(flag(first, "ok"), "next_context did not start");
            const json::Value* tabs_field = field(first, "tabs");
            expect(tabs_field != nullptr && tabs_field->is_string(), "next_context reply has no tabs field");

            const json::Value probe = run_code(session, "return { execute: typeof gm.playwriter_execute === 'function', browsers: typeof gm.playwriter_browsers === 'function', tabs: await gm.browser_tabs({}), closeMachine: await gm.browser_close_machine({ confirm: false }), closeRun: typeof gm.playwriter_browsers === 'function' ? await gm.playwriter_browsers({ action: 'close' }) : null };");
            expect(flag(probe, "ok"),"run_code probe failed: " + json::dump(probe).substr(0, 300));
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
                const std::size_t before_phase = result.failures.size();
                const json::Value opened = run_code(session, "return { exec: await gm.playwriter_execute({ code: " + json::quote(open_code(kMarker)) + " }), tabs: await gm.browser_tabs({}) };");
                if (!flag(opened, "ok")) {
                    browser_phase = "failed: the browser open did not run";
                    result.failures.push_back("browser phase: " + browser_phase + ": " + json::dump(part(opened, "error")));
                } else {
                    const json::Value got = output_of(opened);
                    const json::Value exec = part(got, "exec");
                    const json::Value tabs = part(got, "tabs");
                    expect(flag(exec, "ok") && text_has(exec, "output", kMarker), "playwriter_execute did not open the marker page");
                    expect(text_equals(tabs, "state", "changed") && text_has(tabs, "text", "tabs: 1 in this run"), "browser_tabs did not list the run's page");

                    Session peer({installed.string(), "serve", "--workspace", workspace.string(), "--run-dir", (workspace / "runs" / "peer").string()}, workspace, home, 900000);
                    const bool peer_started = peer.started();
                    if (!peer_started) {
                        result.failures.push_back("browser phase: the second run did not start from " + installed.string());
                    } else {
                        connect(peer);
                        expect(flag(tool_json(peer, "next_context", json::Object{}), "ok"), "the second run's next_context did not start");
                        const json::Value peer_opened = run_code(peer, "return { exec: await gm.playwriter_execute({ code: " + json::quote(open_code(kPeerMarker)) + " }), tabs: await gm.browser_tabs({}) };");
                        if (!flag(peer_opened, "ok")) {
                            result.failures.push_back("browser phase: the second run's open did not run: " + json::dump(part(peer_opened, "error")));
                        } else {
                            const json::Value peer_got = output_of(peer_opened);
                            const json::Value peer_exec = part(peer_got, "exec");
                            const json::Value peer_tabs = part(peer_got, "tabs");
                            expect(flag(peer_exec, "ok") && text_has(peer_exec, "output", kPeerMarker), "the second run did not open its page: " + json::dump(peer_exec).substr(0, 300));
                            expect(text_equals(peer_tabs, "state", "changed") && text_has(peer_tabs, "text", "tabs: 1 in this run"), "the second run's browser_tabs did not list exactly its own page");
                            expect(!text_has(peer_tabs, "text", kMarker), "the second run's browser_tabs read the first run's page");
                        }
                    }

                    const json::Value sided = run_code(session, "return { side: await gm.playwriter_execute({ code: " + json::quote(kSideCode) + " }), tabs: await gm.browser_tabs({}) };");
                    if (flag(sided, "ok")) {
                        const json::Value both = output_of(sided);
                        const json::Value tabs_after = part(both, "tabs");
                        const json::Value text_value = part(tabs_after, "text");
                        const std::string text = text_value.is_string() ? text_value.as_string() : std::string();
                        const std::regex other_runs("(\\d+) in other runs");
                        const std::regex project_tabs("(\\d+) in the project browser");
                        std::smatch other_match;
                        std::smatch project_match;
                        expect(flag(part(both, "side"), "ok"), "the side pages did not open: " + json::dump(part(both, "side")).substr(0, 600));
                        expect(text.find("tabs: 1 in this run") != std::string::npos, "browser_tabs lost the run page after the side pages: " + text);
                        expect(std::regex_search(text, other_match, other_runs) && std::stoi(other_match[1].str()) >= 1, "browser_tabs did not count the page of another context: " + text);
                        expect(std::regex_search(text, project_match, project_tabs) && std::stoi(project_match[1].str()) >= 1, "browser_tabs did not count the project browser page: " + text);
                        expect(text.find(kPeerMarker) == std::string::npos && text.find(kSideMarker) == std::string::npos, "browser_tabs listed another run's page: " + text);
                        expect(text.find("about:blank") == std::string::npos, "browser_tabs listed a project browser page as this run's: " + text);
                    } else {
                        result.failures.push_back("browser phase: the tab split did not run: " + json::dump(part(sided, "error")));
                    }

                    const json::Value finish_used = tool_json(session, "finish", json::Object{{"witness", "browser-scope check: browser phase, page opened in the run"}});
                    const json::Value used_browser = part(finish_used, "browser");
                    expect(flag(finish_used, "ok") && has_exactly(used_browser, {"ok", "closedPages"}) && flag(used_browser, "ok") && number(used_browser, "closedPages") == 1,
                           "finish reply browser key must be {ok, closedPages 1} when the run opened one page");
                    tool_json(session, "next_context", json::Object{});

                    const json::Value after_finish = run_code(session, "return { mine: await gm.playwriter_execute({ code: " + json::quote(count_code(kMarker, true)) + " }), peer: await gm.playwriter_execute({ code: " + json::quote(count_code(kPeerMarker, false)) + " }), sides: await gm.playwriter_execute({ code: " + json::quote(count_code(kSideMarker, false)) + " }) };");
                    if (!flag(after_finish, "ok")) {
                        result.failures.push_back("browser phase: the page count after finish did not run: " + json::dump(part(after_finish, "error")));
                    } else {
                        const json::Value counted = output_of(after_finish);
                        if (!flag(part(counted, "mine"), "ok") || !flag(part(counted, "peer"), "ok") || !flag(part(counted, "sides"), "ok")) {
                            result.failures.push_back("the counts after finish did not all run, so no page count was read: " + json::dump(counted).substr(0, 300));
                        } else {
                            expect(returned(part(counted, "mine")) == 0, "the run's page is still open after finish: " + json::dump(counted).substr(0, 300));
                            if (peer_started) expect(returned(part(counted, "peer")) >= 1, "finish closed the second run's page");
                            expect(returned(part(counted, "sides")) >= 2, "finish closed a side page the run does not own: " + json::dump(counted).substr(0, 300));
                        }
                    }

                    if (peer_started) {
                        const json::Value peer_finish = tool_json(peer, "finish", json::Object{{"witness", "browser-scope check: second run finishes its own page"}});
                        const json::Value peer_browser = part(peer_finish, "browser");
                        expect(flag(peer_finish, "ok") && has_exactly(peer_browser, {"ok", "closedPages"}) && flag(peer_browser, "ok") && number(peer_browser, "closedPages") == 1,
                               "the second run's finish did not close exactly its own page: " + json::dump(peer_finish).substr(0, 300));
                        peer.stop();
                        const json::Value after_peer = run_code(session, "return { peer: await gm.playwriter_execute({ code: " + json::quote(count_code(kPeerMarker, true)) + " }), sides: await gm.playwriter_execute({ code: " + json::quote(count_code(kSideMarker, false)) + " }) };");
                        if (!flag(after_peer, "ok")) {
                            result.failures.push_back("browser phase: the page count after the second finish did not run: " + json::dump(part(after_peer, "error")));
                        } else {
                            const json::Value counted = output_of(after_peer);
                            if (!flag(part(counted, "peer"), "ok") || !flag(part(counted, "sides"), "ok")) {
                                result.failures.push_back("the counts after the second finish did not run, so no page count was read: " + json::dump(counted).substr(0, 300));
                            } else {
                                expect(returned(part(counted, "peer")) == 0, "the second run's page is still open after its finish");
                                expect(returned(part(counted, "sides")) >= 2, "the second run's finish closed a side page the run does not own: " + json::dump(counted).substr(0, 300));
                            }
                        }
                    }

                    const json::Value cleanup = run_code(session, "return { undo: await gm.playwriter_execute({ code: " + json::quote(kUndoCode) + " }), sides: await gm.playwriter_execute({ code: " + json::quote(count_code(kSideMarker, false)) + " }), mine: await gm.playwriter_execute({ code: " + json::quote(count_code(kMarker, false)) + " }), peer: await gm.playwriter_execute({ code: " + json::quote(count_code(kPeerMarker, false)) + " }), close: await gm.browser_close_machine({ confirm: true, force: true }) };");
                    if (flag(cleanup, "ok")) {
                        const json::Value both = output_of(cleanup);
                        expect(flag(part(both, "undo"), "ok"), "the side pages were not undone");
                        const json::Value sides_reply = part(both, "sides");
                        const json::Value mine_reply = part(both, "mine");
                        const json::Value peer_reply = part(both, "peer");
                        if (!flag(sides_reply, "ok") || !flag(mine_reply, "ok") || !flag(peer_reply, "ok")) {
                            result.failures.push_back("the cleanup counts did not all run, so no page count was read: sides " + json::dump(sides_reply).substr(0, 200) + ", mine " + json::dump(mine_reply).substr(0, 200) + ", peer " + json::dump(peer_reply).substr(0, 200));
                        } else {
                            expect(returned(sides_reply) == 0, "the side pages are still open after undo: count " + std::to_string(returned(sides_reply)));
                            expect(returned(mine_reply) == 0 && returned(peer_reply) == 0, "a run's page is still open at cleanup, before the browser is closed: mine " + std::to_string(returned(mine_reply)) + ", peer " + std::to_string(returned(peer_reply)));
                        }
                        expect(flag(part(both, "close"), "ok"), "browser_close_machine with confirm did not close the scratch browser");
                    } else {
                        result.failures.push_back("browser phase: the cleanup did not run: " + json::dump(part(cleanup, "error")));
                    }
                    tool_json(session, "finish", json::Object{{"witness", "browser-scope check: browser phase closed"}});
                    if (result.failures.size() == before_phase) browser_phase = "ran: two runs share one browser; each run's browser_tabs listed only its own page, each finish closed exactly that page, and no side page or other run's page was closed by a finish";
                }
            }
            tree = serve_tree(session);
        }
        session.stop();
    }
    const std::vector<long long> survivors = stop_owned(tree);
    if (!survivors.empty()) {
        std::string ids;
        for (const long long pid : survivors) ids += (ids.empty() ? "" : " ") + std::to_string(pid);
        result.failures.push_back(std::to_string(survivors.size()) + " process(es) started by this check are still alive: " + ids);
    }
    std::error_code ignored;
    if (result.failures.empty()) {
        fs::remove_all(sandbox, ignored);
    } else {
        const fs::path logs = workspace / ".playwriter";
        result.failures.push_back("the gate log is kept at " + (logs / "gate.log").string() + " and the browser log at " + (logs / "browser.log").string() + "; the sandbox " + sandbox.string() + " is kept with them");
    }
    const double wall = std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count();
    result.summary = "browser scope: finish browser key, browser_tabs, playwriter_browsers close, browser_close_machine guard; browser run: " + browser_phase + " (wall " + std::to_string(wall) + " s)";
#else
    result.summary = "not measured: the browser check runs the launcher under a Linux process tree";
#endif
    return result;
}

CheckResult check_browser_scope_identity(const std::string& binary) {
    CheckResult result;
#if defined(__linux__)
    const auto started = std::chrono::steady_clock::now();
    const auto stamp = started.time_since_epoch().count();
    const fs::path sandbox = fs::temp_directory_path() / ("gm-browser-scope-identity-" + std::to_string(stamp));
    const fs::path home = sandbox / "home";
    fs::create_directories(home);
    const fs::path workspace = sandbox / "ws";
    fs::create_directories(workspace);
    const auto spawn = [&sandbox](const std::vector<std::string>& argv) -> std::shared_ptr<proc::Child> {
        proc::SpawnOptions options(sandbox);
        options.own_group = true;
        auto spawned = proc::Child::spawn(argv, options);
        return spawned ? *spawned : nullptr;
    };
    const auto reused = spawn({"sleep", "300"});
    const auto foreign = spawn({"sh", "-c", "sleep 300; true", home.string()});
    Session session(binary, workspace, home, 120000, true);
    if (!reused || !foreign) {
        result.failures.push_back("could not start the processes the witness stops");
    } else if (!session.started()) {
        result.failures.push_back("gm serve did not start from " + binary);
    } else {
        connect(session);
        const long long reused_pid = reused->pid();
        const long long foreign_pid = foreign->pid();
        const std::vector<Owned> served = serve_tree(session);
        if (served.empty()) result.failures.push_back("the serve has no process to record, so the witness proves nothing");
        std::vector<long long> served_pids;
        for (const Owned& each : served) served_pids.push_back(each.pid);
        std::vector<Owned> recorded = served;
        recorded.push_back(Owned{reused_pid, proc::start_time_of(reused_pid) + 1});
        const std::vector<long long> mentioned = processes_mentioning(home.string());
        if (std::find(mentioned.begin(), mentioned.end(), foreign_pid) == mentioned.end()) {
            result.failures.push_back("the foreign process does not mention the home path, so the witness proves nothing");
        }
        session.stop();
        stop_owned(recorded);
        if (!alive_of(served_pids).empty()) result.failures.push_back("a process the serve started survived the stop");
        const std::vector<long long> kept = alive_of({reused_pid, foreign_pid});
        const auto is_kept = [&kept](long long pid) { return std::find(kept.begin(), kept.end(), pid) != kept.end(); };
        if (!is_kept(reused_pid)) result.failures.push_back("a pid whose recorded start time differs was stopped: pid " + std::to_string(reused_pid));
        if (!is_kept(foreign_pid)) result.failures.push_back("a foreign process that mentions the home path was stopped: pid " + std::to_string(foreign_pid));
    }
    for (const std::shared_ptr<proc::Child>& child : {reused, foreign}) {
        if (child) child->kill();
    }
    std::error_code ignored;
    fs::remove_all(sandbox, ignored);
    const double wall = std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count();
    if (result.failures.empty()) {
        result.summary = "kill identity: the serve's processes were stopped, a foreign process whose command line mentions the home path survived, and a pid whose recorded start time differs survived (wall " + std::to_string(wall) + " s)";
    }
#else
    result.summary = "not measured: the identity witness runs under a Linux process tree";
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

CheckResult check_browser_scope_identity(const std::string&) {
    CheckResult result;
    result.summary = "skipped: POSIX-only check, runs on Linux and macOS";
    return result;
}

}
#endif
