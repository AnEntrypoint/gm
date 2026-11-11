#include "gm/tool.hpp"

#include <algorithm>
#include <chrono>
#include <filesystem>
#include <fstream>
#include <functional>
#include <future>
#include <memory>
#include <sstream>
#include <system_error>
#include <thread>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

struct Row {
    std::string id;
    std::vector<std::string> failures;
    std::string line;
    void expect(bool ok, const std::string& what) {
        if (!ok) failures.push_back(what);
    }
};

struct Context {
    std::string binary;
    fs::path sandbox;
    fs::path repo;
};

std::string clip(const json::Value& value) { return json::dump(value).substr(0, 300); }

std::unique_ptr<Session> open_session(const Context& context, const std::string& id, Row& row) {
    const fs::path home = context.sandbox / id;
    const fs::path workspace = home / "ws";
    fs::create_directories(workspace);
    std::ofstream(workspace / "README.md") << "hello\n";
    std::ofstream(home / "quiet.json") << R"({"mcpServers":{"playwriter":{"disabled":true}}})";
    auto session = std::make_unique<Session>(context.binary, workspace, home, 180000, true);
    if (!session->started()) {
        row.failures.push_back("gm serve did not start from " + context.binary);
        return nullptr;
    }
    session->rpc("initialize", json::Object{{"protocolVersion", "2025-06-18"}, {"capabilities", json::Object{}},
                                           {"clientInfo", json::Object{{"name", "parity-contract"}, {"version", "1"}}}});
    session->notify("notifications/initialized", json::Object{});
    return session;
}

json::Value read_resource(Session& session, const std::string& uri) {
    return session.rpc("resources/read", json::Object{{"uri", uri}});
}

json::Value call(Session& session, const std::string& name, json::Value args) {
    const json::Value reply = session.rpc("tools/call", json::Object{{"name", name}, {"arguments", std::move(args)}});
    const json::Value* structured = value_at(reply, "result.structuredContent");
    return structured != nullptr ? *structured : json::Value();
}

json::Value run_body(Session& session, const std::string& body) {
    return call(session, "run_code", json::Object{{"body", body}});
}

void ready(Session& session) {
    read_resource(session, "skill://gm/SKILL.md");
    call(session, "next_context", json::Object{});
}

bool is_true(const json::Value& value, const std::string& dotted) {
    const json::Value* found = value_at(value, dotted);
    return found != nullptr && found->is_bool() && found->as_bool();
}

bool is_false(const json::Value& value, const std::string& dotted) {
    const json::Value* found = value_at(value, dotted);
    return found != nullptr && found->is_bool() && !found->as_bool();
}

double number_of(const json::Value& value, const std::string& dotted, double fallback = -1) {
    const json::Value* found = value_at(value, dotted);
    return found != nullptr && found->is_number() ? found->as_number() : fallback;
}

std::string first_text(const json::Value& reply) {
    const json::Value* contents = value_at(reply, "result.contents");
    if (contents == nullptr || !contents->is_array() || contents->as_array().empty()) return {};
    return text_at(contents->as_array().front(), "text");
}

std::vector<std::string> keys_of(const json::Value& value) {
    std::vector<std::string> keys;
    if (!value.is_object()) return keys;
    for (const auto& member : value.as_object()) keys.push_back(member.first);
    std::sort(keys.begin(), keys.end());
    return keys;
}

std::string joined(const std::vector<std::string>& parts, const std::string& by) {
    std::string text;
    for (const std::string& part : parts) {
        if (!text.empty()) text += by;
        text += part;
    }
    return text;
}

class Sleeper {
public:
    explicit Sleeper(const std::string& seconds) {
        auto spawned = proc::Child::spawn({"sleep", seconds});
        if (!spawned) return;
        child_ = *spawned;
        reaper_ = std::thread([child = child_] { child->wait_for(std::chrono::hours(1)); });
    }
    ~Sleeper() {
        if (child_) child_->kill();
        if (reaper_.joinable()) reaper_.join();
    }
    Sleeper(const Sleeper&) = delete;
    Sleeper& operator=(const Sleeper&) = delete;
    long long pid() const { return child_ ? child_->pid() : -1; }

private:
    std::shared_ptr<proc::Child> child_;
    std::thread reaper_;
};

std::string pid_wait_body(long long pid, long long wait_ms) {
    return "return await gm.job_status({ pid: " + std::to_string(pid) + ", waitMs: " + std::to_string(wait_ms) + " });";
}

void w1(const Context& context, Row& row) {
    auto session = open_session(context, "w1", row);
    if (!session) return;
    const json::Value listed = session->rpc("tools/list", json::Object{});
    const json::Value* tools = value_at(listed, "result.tools");
    std::vector<std::string> names;
    if (tools != nullptr && tools->is_array())
        for (const json::Value& tool : tools->as_array()) names.push_back(text_at(tool, "name"));
    std::sort(names.begin(), names.end());
    row.line = "tools " + joined(names, ",");
    row.expect(row.line == "tools finish,next_context,run_code", "tools/list is not exactly finish, next_context, run_code: " + row.line);
}

void w2(const Context& context, Row& row) {
    auto session = open_session(context, "w2", row);
    if (!session) return;
    ready(*session);
    const json::Value reply = run_body(*session, "return { a: 1 };");
    row.line = "run_code " + clip(reply);
    row.expect(is_true(reply, "ok"), "run_code did not succeed: " + clip(reply));
    const json::Value* output = value_at(reply, "output");
    row.expect(output != nullptr && json::dump(*output) == R"({"a":1})", "run_code output is not {\"a\":1}: " + clip(reply));
    row.expect(is_false(reply, "truncated"), "run_code truncated is not false: " + clip(reply));
    const json::Value* loads = value_at(reply, "loads");
    row.expect(loads != nullptr && loads->is_array() && loads->as_array().empty(), "run_code loads is not []: " + clip(reply));
}

void w3(const Context& context, Row& row) {
    auto session = open_session(context, "w3", row);
    if (!session) return;
    ready(*session);
    const json::Value thrown = run_body(*session, "throw new Error(\"x\");");
    const json::Value syntax = run_body(*session, "return (;");
    const std::string error = text_at(thrown, "error");
    const std::string first_line = error.substr(0, error.find('\n'));
    const std::string prefix = text_at(syntax, "error").substr(0, 28);
    row.line = "throw first line " + first_line + "; syntax prefix " + prefix;
    row.expect(is_false(thrown, "ok") && first_line == "x", "a thrown Error(\"x\") did not reply ok false with first line x: " + clip(thrown));
    row.expect(is_false(syntax, "ok") && prefix == "the body does not load: unex", "a syntax error did not reply 'the body does not load: unex...': " + clip(syntax));
}

void w4(const Context& context, Row& row) {
    auto session = open_session(context, "w4", row);
    if (!session) return;
    const json::Value first = run_body(*session, "return 1;");
    const json::Value again = run_body(*session, "return 2;");
    const bool refused = text_at(first, "error").find("had not been read") != std::string::npos;
    row.line = std::string("first refused ") + (refused ? "once" : "no") + "; second ok " + (is_true(again, "ok") ? "true" : "false");
    row.expect(is_false(first, "ok") && refused, "the first run_code before the skill read was not refused: " + clip(first));
    row.expect(is_true(again, "ok"), "the second run_code was refused: " + clip(again));
}

void w5(const Context& context, Row& row) {
    auto session = open_session(context, "w5", row);
    if (!session) return;
    read_resource(*session, "skill://gm/SKILL.md");
    const json::Value first = call(*session, "next_context", json::Object{});
    const json::Value unchanged = call(*session, "next_context", json::Object{});
    const std::string keys = joined(keys_of(unchanged), ",");
    row.line = "repeat keys " + keys;
    row.expect(value_at(first, "rules") != nullptr && value_at(first, "prefixSha") != nullptr, "the first next_context is not a full reply with prefixSha: " + clip(first));
    row.expect(is_true(unchanged, "unchanged") && keys == "ok,run,steps,stepsLeft,unchanged", "the repeat next_context is not the unchanged reply: " + clip(unchanged));
}

void w6(const Context& context, Row& row) {
    auto session = open_session(context, "w6", row);
    if (!session) return;
    read_resource(*session, "skill://gm/SKILL.md");
    const json::Value ctx = call(*session, "next_context", json::Object{{"full", true}});
    const std::vector<std::string> need{"ok", "step", "run", "stepsLeft", "maxSteps", "rules", "witness", "prefixSha", "total", "pendingCommands", "events", "query"};
    std::vector<std::string> missing;
    for (const std::string& key : need)
        if (value_at(ctx, key) == nullptr) missing.push_back(key);
    const double steps_left = number_of(ctx, "stepsLeft");
    const double max_steps = number_of(ctx, "maxSteps");
    row.line = "full reply has " + std::to_string(need.size() - missing.size()) + "/" + std::to_string(need.size()) + " keys; stepsLeft " + std::to_string(steps_left) + " maxSteps " + std::to_string(max_steps);
    row.expect(missing.empty(), "the full next_context reply lacks " + joined(missing, ","));
    row.expect(max_steps > 0 && steps_left == max_steps - 1, "stepsLeft is not maxSteps - 1 after one step: " + row.line);
}

void w7(const Context& context, Row& row) {
    auto session = open_session(context, "w7", row);
    if (!session) return;
    ready(*session);
    const json::Value finished = call(*session, "finish", json::Object{{"witness", "parity witness"}});
    const json::Value again = call(*session, "finish", json::Object{{"witness", "again"}});
    row.line = "finish " + clip(finished).substr(0, 120);
    row.expect(is_true(finished, "ok") && is_true(finished, "finished") && text_at(finished, "output") == "parity witness", "finish did not end the run with its witness: " + clip(finished));
    row.expect(is_true(again, "refused"), "a second finish was not refused: " + clip(again));
}

void w8(const Context& context, Row& row) {
    auto session = open_session(context, "w8", row);
    if (!session) return;
    ready(*session);
    const json::Value reply = session->rpc("tools/call", json::Object{{"name", "finish"}, {"arguments", json::Object{}}});
    const bool refused = value_at(reply, "error") != nullptr || is_false(reply, "result.structuredContent.ok") || is_true(reply, "result.isError");
    row.line = std::string("finish without witness refused ") + (refused ? "true" : "false");
    row.expect(refused, "a finish without witness was accepted: " + clip(reply));
}

void w9(const Context& context, Row& row) {
    auto session = open_session(context, "w9", row);
    if (!session) return;
    const std::string skill = first_text(read_resource(*session, "skill://gm/SKILL.md"));
    const std::string workflows = first_text(read_resource(*session, "skill://gm/WORKFLOWS.md"));
    const json::Value missing = read_resource(*session, "skill://nope/X.md");
    const double code = number_of(missing, "error.code", 0);
    const std::string message = text_at(missing, "error.message");
    row.line = "unknown skill code " + std::to_string(static_cast<long long>(code)) + " message " + message;
    row.expect(skill.rfind("---\nname:", 0) == 0, "skill://gm/SKILL.md does not start with frontmatter name: " + skill.substr(0, 40));
    row.expect(!workflows.empty(), "skill://gm/WORKFLOWS.md is empty");
    row.expect(code == -32002 && message == "resource not found: skill://nope/X.md", "an unknown skill did not answer -32002 resource not found: " + clip(missing));
}

void w10_w13(const Context& context, Row& row) {
    auto session = open_session(context, "w10", row);
    if (!session) return;
    read_resource(*session, "skill://gm/SKILL.md");
    const json::Value ctx = call(*session, "next_context", json::Object{});
    const json::Value log = read_resource(*session, "run://" + text_at(ctx, "run") + "/log");
    const std::string text = first_text(log);
    const auto first = json::parse(text.substr(0, text.find('\n')));
    const std::string kind = first ? text_at(*first, "kind") : std::string();
    const double seq = first ? number_of(*first, "seq") : -1;
    row.line = "run log readable " + std::string(value_at(log, "result") != nullptr ? "true" : "false") + "; first event kind " + kind + " seq " + std::to_string(static_cast<long long>(seq));
    row.expect(value_at(log, "result") != nullptr, "run://<run>/log is not readable: " + clip(log));
    row.expect(kind == "start" && seq == 1, "the first run log event is not kind start seq 1: " + text.substr(0, 200));
}

void w11(const Context& context, Row& row) {
    auto session = open_session(context, "w11", row);
    if (!session) return;
    read_resource(*session, "skill://gm/SKILL.md");
    const json::Value ctx = call(*session, "next_context", json::Object{});
    const std::string uri = "run://" + text_at(ctx, "run") + "/witness";
    const json::Value before = read_resource(*session, uri);
    call(*session, "finish", json::Object{{"witness", "parity witness text"}});
    const std::string after = first_text(read_resource(*session, uri));
    row.line = "witness before finish code " + std::to_string(static_cast<long long>(number_of(before, "error.code", 0))) + "; after finish " + after;
    row.expect(number_of(before, "error.code", 0) == -32002, "the witness before finish is not -32002: " + clip(before));
    row.expect(after == "parity witness text", "the witness after finish is not the finish witness: " + after.substr(0, 200));
}

void w12(const Context& context, Row& row) {
    auto session = open_session(context, "w12", row);
    if (!session) return;
    const json::Value listed = session->rpc("resources/templates/list", json::Object{});
    const json::Value* templates = value_at(listed, "result.resourceTemplates");
    std::vector<std::string> uris;
    if (templates != nullptr && templates->is_array())
        for (const json::Value& entry : templates->as_array()) uris.push_back(text_at(entry, "uriTemplate"));
    row.line = "templates " + joined(uris, " ");
    row.expect(row.line == "templates skill://{name}/SKILL.md skill://{name}/{path} run://{run}/log run://{run}/witness", "the resource templates differ: " + row.line);
}

void w14(const Context& context, Row& row) {
    auto session = open_session(context, "w14", row);
    if (!session) return;
    ready(*session);
    Sleeper sleeper("2");
    const auto began = std::chrono::steady_clock::now();
    const json::Value reply = run_body(*session, pid_wait_body(sleeper.pid(), 20000));
    const auto wall = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - began).count();
    const json::Value* exit_code = value_at(reply, "output.exitCode");
    row.line = "pid wait state " + text_at(reply, "output.state") + " in " + std::to_string(wall) + " ms";
    row.expect(text_at(reply, "output.state") == "gone", "a pid wait on a 2 s process did not end gone: " + clip(reply));
    row.expect(wall < 15000, "a pid wait on a 2 s process took " + std::to_string(wall) + " ms");
    row.expect(exit_code != nullptr && exit_code->is_null(), "a pid wait on a foreign process has an exitCode that is not null: " + clip(reply));
}

void w15(const Context& context, Row& row) {
    auto session = open_session(context, "w15", row);
    if (!session) return;
    ready(*session);
    const json::Value described = run_body(*session, "return gm.verbs().find((v) => v.name === \"job_status\").description;");
    const std::string description = text_at(described, "output");
    row.expect(description.find("at most 60000") != std::string::npos, "the job_status description does not state 'at most 60000': " + description.substr(0, 200));
    std::string gone;
    for (long long wait_ms : {59999LL, 60001LL}) {
        Sleeper sleeper("2");
        const json::Value reply = run_body(*session, pid_wait_body(sleeper.pid(), wait_ms));
        const bool ok = text_at(reply, "output.state") == "gone" && number_of(reply, "output.waitedMs", 1e9) < 3000;
        gone += ok ? " true" : " false";
        row.expect(ok, "waitMs " + std::to_string(wait_ms) + " on a 2 s process did not return gone before 3 s: " + clip(reply));
    }
    Sleeper live("300");
    const json::Value held = run_body(*session, pid_wait_body(live.pid(), 3000));
    const double waited = number_of(held, "output.waitedMs", 0);
    row.line = "cap stated; below and above the cap gone" + gone + "; live process " + text_at(held, "output.state") + " after " + std::to_string(static_cast<long long>(waited)) + " ms";
    row.expect(text_at(held, "output.state") == "running" && waited >= 2900 && waited < 3500, "a live process with waitMs 3000 did not hold about 3 s and return running: " + clip(held));
}

void w16(const Context& context, Row& row) {
    auto session = open_session(context, "w16", row);
    if (!session) return;
    ready(*session);
    Sleeper sleeper("2");
    const std::string body = "let n = 0; for (;;) { n += 1; const r = await gm.job_status({ pid: " + std::to_string(sleeper.pid()) +
                             ", waitMs: 1000 }); if (r.state !== 'running') return { calls: n, state: r.state }; }";
    const json::Value reply = run_body(*session, body);
    row.line = "one-body loop state " + text_at(reply, "output.state") + " calls " + std::to_string(static_cast<long long>(number_of(reply, "output.calls")));
    row.expect(text_at(reply, "output.state") == "gone" && number_of(reply, "output.calls") >= 2, "the one-body loop did not end gone after 2 or more calls: " + clip(reply));
}

std::vector<fs::path> files_under(const fs::path& dir) {
    std::vector<fs::path> files;
    std::error_code ec;
    for (const auto& entry : fs::recursive_directory_iterator(dir, ec))
        if (entry.is_regular_file(ec)) files.push_back(fs::relative(entry.path(), dir));
    std::sort(files.begin(), files.end());
    return files;
}

std::string read_text(const fs::path& file) {
    std::ifstream in(file, std::ios::binary);
    std::ostringstream text;
    text << in.rdbuf();
    return text.str();
}

void w17_w18(const Context& context, Row& row) {
    const fs::path host = fs::path(context.binary).parent_path();
    const fs::path build = host.parent_path().parent_path().parent_path();
    const fs::path home = context.sandbox / "home17";
    const fs::path root = home / ".gmnew";
    fs::create_directories(home);
    const auto install = [&] {
        return proc::run({"env", "HOME=" + home.string(), "GMNEW_SKIP_REGISTER=1", (host / "gm").string(), "install", "--local", build.string(), "--source", context.repo.string()}, context.repo, {}, 120000);
    };
    const auto first = install();
    if (!first.started || first.exit_code != 0) {
        row.failures.push_back("the first gm install --local failed: " + (first.err.empty() ? first.out : first.err).substr(0, 300));
        return;
    }
    const auto checkout_files = files_under(context.repo / "skills");
    bool same = checkout_files == files_under(root / "current" / "skills");
    for (const fs::path& file : checkout_files)
        same = same && read_text(root / "current" / "skills" / file) == read_text(context.repo / "skills" / file);
    row.expect(same, "the installed skills differ from the checkout's skills");
    std::error_code ec;
    const fs::path linked = fs::read_symlink(root / "current", ec);
    if (ec) {
        row.failures.push_back("current is not a link after the first install");
        return;
    }
    const std::string id = linked.filename().string();
    fs::copy(root / "versions" / id, root / "versions" / "older-dev", fs::copy_options::recursive, ec);
    fs::create_directory_symlink(fs::path("versions") / "older-dev", root / "current.test", ec);
    fs::rename(root / "current.test", root / "current", ec);
    if (ec) {
        row.failures.push_back("could not point current at versions/older-dev: " + ec.message());
        return;
    }
    const auto second = install();
    const fs::path current_now = fs::read_symlink(root / "current", ec);
    const fs::path previous = fs::read_symlink(root / "previous-older-dev", ec);
    row.line = "install exit " + std::to_string(first.exit_code) + "/" + std::to_string(second.exit_code) + "; current " + current_now.string() + "; previous-older-dev " + previous.string() +
               "; skills equal " + (same ? "true" : "false");
    row.expect(second.exit_code == 0, "the second install failed: " + (second.err.empty() ? second.out : second.err).substr(0, 300));
    row.expect(current_now == fs::path("versions") / id, "current is not versions/" + id + " after the second install: " + current_now.string());
    row.expect(previous == fs::path("versions") / "older-dev", "previous-older-dev does not link to versions/older-dev: " + previous.string());
}

void w23(const Context& context, Row& row) {
    auto session = open_session(context, "w23", row);
    if (!session) return;
    ready(*session);
    const json::Value reply = run_body(*session,
        "await gm.run_shell({ command: 'yes a | head -c 18000 > big.txt' });\n"
        "const first = await gm.read_file({ path: 'big.txt' });\n"
        "const again = await gm.read_file({ path: 'big.txt' });\n"
        "const fresh = await gm.read_file({ path: 'big.txt', fresh: true });\n"
        "const whole = await gm.read_file({ path: 'big.txt', full: true });\n"
        "return { first: first.output.length, truncated: first.truncated, omitted: first.omittedChars, pointer: again.step !== undefined && again.output.length < 200, fresh: fresh.output.length, whole: whole.output.length };");
    const double first = number_of(reply, "output.first");
    const double omitted = number_of(reply, "output.omitted");
    row.line = "bounded first read " + std::to_string(static_cast<long long>(first)) + " chars, omitted " + std::to_string(static_cast<long long>(omitted)) + "; full read " +
               std::to_string(static_cast<long long>(number_of(reply, "output.whole")));
    row.expect(first >= 6000 && first < 6400 && is_true(reply, "output.truncated") && omitted > 11000, "an 18000 char read was not bounded to about 6000 chars: " + clip(reply));
    row.expect(is_true(reply, "output.pointer"), "an identical repeat read was not a pointer: " + clip(reply));
    row.expect(number_of(reply, "output.fresh") == first, "a fresh read did not read again: " + clip(reply));
    row.expect(number_of(reply, "output.whole") == 18000, "a full read did not return all 18000 chars: " + clip(reply));
}

void w24(const Context& context, Row& row) {
    auto session = open_session(context, "w24", row);
    if (!session) return;
    ready(*session);
    const json::Value reply = run_body(*session,
        "await gm.run_shell({ command: 'seq 1 3000 | sed \"s/^/match /\" > many.txt' });\n"
        "const g = await gm.run_shell({ command: 'grep match many.txt' });\n"
        "const t = await gm.run_shell({ command: 'echo test-run; seq 1 2000 | sed \"s/^/ok /\"; echo \"FAIL case x\"' });\n"
        "const d = await gm.run_shell({ command: 'cat many.txt', raw: true });\n"
        "return { grepLen: g.output.length, grepOutPath: g.outputPath !== undefined, testLen: t.output.length, testHasFailure: t.output.includes(\"FAIL case x\"), dumpLen: d.output.length, dumpPath: d.outputPath !== undefined };");
    row.line = "grep inline " + std::to_string(static_cast<long long>(number_of(reply, "output.grepLen"))) + ", test inline " + std::to_string(static_cast<long long>(number_of(reply, "output.testLen"))) +
               ", dump inline " + std::to_string(static_cast<long long>(number_of(reply, "output.dumpLen")));
    row.expect(number_of(reply, "output.grepLen", 1e9) < 6000 && is_true(reply, "output.grepOutPath"), "a long grep output was not bounded with an outputPath: " + clip(reply));
    row.expect(number_of(reply, "output.testLen", 1e9) < 6000 && is_true(reply, "output.testHasFailure"), "a long test output was not bounded with its failure line kept: " + clip(reply));
    row.expect(number_of(reply, "output.dumpLen", 1e9) <= 6000 && is_true(reply, "output.dumpPath"), "a raw file dump was not bounded with an outputPath: " + clip(reply));
}

fs::path find_repo() {
    for (fs::path dir = fs::current_path();; dir = dir.parent_path()) {
        std::error_code ec;
        if (fs::exists(dir / "skills" / "gm" / "SKILL.md", ec)) return dir;
        if (dir == dir.parent_path()) return {};
    }
}

}

CheckResult check_parity_contract(const std::string& binary) {
    CheckResult result;
    const auto started = std::chrono::steady_clock::now();
    Context context{binary, fs::temp_directory_path() / ("gm-parity-contract-" + std::to_string(started.time_since_epoch().count())), find_repo()};
    if (context.repo.empty()) {
        result.failures.push_back("run from the checkout: no skills/gm/SKILL.md in the working directory or its parents");
        return result;
    }
    fs::create_directories(context.sandbox);
    using Witness = void (*)(const Context&, Row&);
    const std::vector<std::pair<std::string, Witness>> witnesses{
        {"W1", w1}, {"W2", w2}, {"W3", w3}, {"W4", w4}, {"W5", w5}, {"W6", w6}, {"W7", w7}, {"W8", w8}, {"W9", w9},
        {"W10/W13", w10_w13}, {"W11", w11}, {"W12", w12}, {"W14", w14}, {"W15", w15}, {"W16", w16}, {"W17/W18", w17_w18}, {"W23", w23}, {"W24", w24}};
    std::vector<std::future<Row>> running;
    for (const auto& [id, witness] : witnesses) {
        running.push_back(std::async(std::launch::async, [&context, id, witness] {
            Row row;
            row.id = id;
            witness(context, row);
            return row;
        }));
    }
    std::size_t passed = 0;
    for (auto& future : running) {
        Row row = future.get();
        if (row.failures.empty()) ++passed;
        for (const std::string& failure : row.failures) result.failures.push_back(row.id + ": " + failure);
    }
    std::error_code ignored;
    fs::remove_all(context.sandbox, ignored);
    const double wall = std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count();
    result.summary = std::to_string(passed) + " of " + std::to_string(witnesses.size()) + " parity contract witnesses hold on the native binary (W1 to W18, W23, W24; W21 and W22 are check-install-switch and check-skill-serve) (wall " +
                     std::to_string(wall) + " s)";
    return result;
}

}
