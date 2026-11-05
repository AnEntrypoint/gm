#include <chrono>
#include <cstdio>
#include <filesystem>
#include <mutex>
#include <thread>
#include <fstream>
#include <initializer_list>
#include <random>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

#include "gm/json.hpp"
#include "gm/log.hpp"
#include "gm/mcp.hpp"
#include "gm/verbs.hpp"

#ifdef GMNEW_HAVE_RUNCODE
#include "gm/runcode.hpp"
#endif

namespace fs = std::filesystem;
using gm::json::Value;

namespace {

int failures = 0;

void check(bool ok, const std::string& what) {
    std::cout << (ok ? "ok   " : "FAIL ") << what << std::endl;
    if (!ok) ++failures;
}

class FakeVerbs : public gm::VerbTable {
public:
    std::vector<gm::VerbInfo> list() const override {
        return {{"read_file", "Read a file.", R"({"type":"object","properties":{"path":{"type":"string"}},"required":["path"]})"},
                {"write_file", "Write a file.", R"({"type":"object","properties":{"path":{"type":"string"},"content":{"type":"string"}},"required":["path","content"]})"}};
    }
    Value call(std::string_view name, const Value& args) override {
        const Value* path = args.find("path");
        if (name == "write_file") {
            stored = args.find("content") ? args.find("content")->as_string() : "";
            return Value(gm::json::Object{}).set("ok", true).set("output", "wrote " + (path ? path->as_string() : ""));
        }
        if (name == "read_file") return Value(gm::json::Object{}).set("ok", true).set("output", stored);
        return Value(gm::json::Object{}).set("ok", false).set("error", "unknown verb");
    }
    std::string stored;
};

std::string rpc(int id, const std::string& method, const std::string& params) {
    return R"({"jsonrpc":"2.0","id":)" + std::to_string(id) + R"(,"method":")" + method + R"(","params":)" + params + "}";
}

std::string call(int id, const std::string& tool, const std::string& args) {
    return rpc(id, "tools/call", R"({"name":")" + tool + R"(","arguments":)" + args + "}");
}

const Value* reply_for(const std::vector<Value>& replies, int id) {
    for (const Value& r : replies) {
        const Value* rid = r.find("id");
        if (rid && rid->is_number() && rid->as_number() == id) return &r;
    }
    return nullptr;
}

Value structured(const std::vector<Value>& replies, int id) {
    const Value* r = reply_for(replies, id);
    if (!r || !r->find("result")) return Value();
    const Value* s = r->find("result")->find("structuredContent");
    return s ? *s : Value();
}

std::string run_of(const std::vector<Value>& replies, int id) {
    const Value* r = reply_for(replies, id);
    if (!r || !r->find("result")) return "";
    return r->find("result")->find("_meta")->find("com.anentrypoint.gmnew/run")->as_string();
}

std::string str(const Value& v, const char* key) {
    const Value* f = v.find(key);
    return f && f->is_string() ? f->as_string() : "";
}

Value obj() { return Value(gm::json::Object{}); }

class RowVerbs : public FakeVerbs {
public:
    std::vector<gm::VerbInfo> list() const override {
        auto verbs = FakeVerbs::list();
        verbs.push_back({"prd_list", "List prd rows.", R"({"type":"object","properties":{"status":{"type":"string"}}})"});
        verbs.push_back({"unknown_list", "List question rows.", R"({"type":"object","properties":{"status":{"type":"string"}}})"});
        verbs.push_back({"job_status", "Job status.", R"({"type":"object","properties":{"job":{"type":"string"}}})"});
        return verbs;
    }
    Value call(std::string_view name, const Value& args) override {
        if (name == "prd_list" || name == "unknown_list") {
            std::string kind = name == "prd_list" ? "prd-" : "unknown-";
            bool all = str(args, "status") == "all";
            std::string out;
            for (const auto& row : rows) {
                if (row.rfind(kind, 0) != 0) continue;
                if (!all && row.find(" open ") == std::string::npos) continue;
                out += (out.empty() ? "" : "\n") + row;
            }
            return obj().set("ok", true).set("output", out.empty() ? "(none)" : out);
        }
        if (name == "job_status") return obj().set("ok", false).set("error", "no job named " + str(args, "job"));
        return FakeVerbs::call(name, args);
    }
    std::vector<std::string> rows;
};

struct Harness {
    std::unique_ptr<gm::mcp::Server> server;
    std::vector<Value> out;
    std::mutex lock;
    int next_id = 1000;

    Harness(gm::VerbTable& verbs, gm::mcp::ServerOptions options) {
        auto opened = gm::mcp::Server::open(verbs, std::move(options), [this](std::string_view line) {
            auto parsed = gm::json::parse(line);
            std::lock_guard guard(lock);
            if (parsed) out.push_back(*parsed);
        });
        if (opened) server = std::move(*opened);
        else std::cout << "open failed: " << opened.error() << '\n';
    }

    Value call(const std::string& tool, const std::string& args, int id = 0) {
        if (id == 0) id = ++next_id;
        server->accept(::call(id, tool, args));
        std::lock_guard guard(lock);
        return structured(out, id);
    }

    Value raw(int id) {
        std::lock_guard guard(lock);
        const Value* r = reply_for(out, id);
        return r ? *r : Value();
    }
};

std::vector<Value> log_of(const fs::path& dir) {
    auto log = gm::RunLog::open(dir);
    if (!log) return {};
    auto events = log->read_all();
    return events ? *events : std::vector<Value>{};
}

int count_kind(const std::vector<Value>& events, const std::string& kind) {
    int n = 0;
    for (const Value& e : events) n += str(e, "kind") == kind ? 1 : 0;
    return n;
}

deoxidene::Result<Value, std::string> scripted_body(gm::VerbTable& table, std::string_view body, const fs::path&, std::string_view) {
    std::string text(body);
    if (text.rfind("sleep:", 0) == 0) {
        auto colon = text.find(':', 6);
        int ms = std::stoi(text.substr(6, colon - 6));
        table.call("write_file", obj().set("path", "bg.txt").set("content", "before sleep"));
        std::this_thread::sleep_for(std::chrono::milliseconds(ms));
        Value after = table.call("write_file", obj().set("path", "bg.txt").set("content", "after sleep"));
        return obj().set("value", text.substr(colon + 1)).set("afterOk", after.find("ok") ? *after.find("ok") : Value());
    }
    if (text.rfind("status:", 0) == 0) {
        return table.call("job_status", obj().set("job", text.substr(7)).set("waitMs", 5000));
    }
    return obj().set("echo", text);
}

gm::mcp::ServerOptions fresh_options(const fs::path& root, const std::string& name) {
    gm::mcp::ServerOptions options;
    options.workspace = root / "ws";
    options.runs = root / ("runs-" + name);
    options.skills = fs::path(GMNEW_SOURCE_DIR) / "skills";
    options.run_body = scripted_body;
    fs::create_directories(options.workspace);
    fs::create_directories(options.runs);
    return options;
}

Value result_of(Harness& h, int id) {
    Value reply = h.raw(id);
    const Value* result = reply.find("result");
    return result ? *result : Value();
}

const Value* field(const Value* value, std::initializer_list<const char*> keys) {
    for (const char* key : keys) {
        if (value == nullptr) return nullptr;
        value = value->find(key);
    }
    return value;
}

double number_at(const Value* value) { return value && value->is_number() ? value->as_number() : -1.0; }

Value first_notice(Harness& h, const std::string& method) {
    std::lock_guard guard(h.lock);
    for (const Value& message : h.out) {
        if (str(message, "method") == method) return message;
    }
    return Value();
}

int notice_count(Harness& h, const std::string& method) {
    std::lock_guard guard(h.lock);
    int n = 0;
    for (const Value& message : h.out) n += str(message, "method") == method ? 1 : 0;
    return n;
}

void append_line(const fs::path& file, const std::string& line) { std::ofstream(file, std::ios::app | std::ios::binary) << line; }

}

int main() {
    fs::path root = fs::temp_directory_path() / ("gm-mcp-test-" + std::to_string(std::random_device{}()));
    fs::path workspace = root / "ws";
    fs::path runs = root / "runs";
    fs::create_directories(workspace);
    fs::create_directories(runs);

    FakeVerbs verbs;
    gm::mcp::ServerOptions options;
    options.workspace = workspace;
    options.runs = runs;
    options.skills = fs::path(GMNEW_SOURCE_DIR) / "skills";
    options.run_body = [](gm::VerbTable& table, std::string_view body, const fs::path&, std::string_view) -> deoxidene::Result<Value, std::string> {
        Value args = Value(gm::json::Object{}).set("path", "a.txt").set("content", std::string(body));
        Value wrote = table.call("write_file", args);
        Value read = table.call("read_file", Value(gm::json::Object{}).set("path", "a.txt"));
        return Value(gm::json::Object{}).set("wrote", wrote).set("read", read);
    };

    std::vector<std::string> script = {
        rpc(1, "initialize", R"({"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"1"}})"),
        R"({"jsonrpc":"2.0","method":"notifications/initialized"})",
        rpc(2, "tools/list", "{}"),
        call(3, "next_context", "{}"),
        call(4, "run_code", R"({"body":"return 42"})"),
        call(5, "run_code", R"({"body":"x","bogus":1})"),
        call(4, "run_code", R"({"body":"return 42"})"),
        call(6, "finish", "{}"),
        call(7, "finish", R"({"witness":"run_code returned the stored body"})"),
        call(8, "run_code", R"({"body":"return 1"})"),
        call(9, "next_context", R"({"child":true})"),
        call(10, "next_context", "{}"),
        rpc(11, "resources/read", R"({"uri":"skill://gm/SKILL.md"})"),
        rpc(12, "prompts/list", "{}"),
        rpc(13, "no/such", "{}"),
        rpc(14, "ping", "{}"),
        call(15, "read_file", R"({"path":"a"})"),
        "{not json",
        rpc(16, "resources/templates/list", "{}"),
        rpc(17, "skills/list", "{}"),
        rpc(18, "completion/complete", R"({"ref":{"type":"ref/resource","uri":"skill://{name}/SKILL.md"},"argument":{"name":"name","value":"gm-"}})"),
        rpc(19, "logging/setLevel", R"({"level":"info"})"),
        call(20, "next_context", "{}"),
    };
    std::string input;
    for (const auto& line : script) input += line + "\n";
    std::istringstream in(input);
    std::ostringstream out;
    int code = gm::mcp::serve_stream(in, out, verbs, options);
    check(code == 0, "serve_stream exits 0");

    std::vector<Value> replies;
    std::istringstream lines(out.str());
    std::string line;
    std::cout << "--- transcript ---\n";
    for (std::size_t i = 0; i < script.size(); ++i) std::cout << "> " << script[i].substr(0, 160) << '\n';
    while (std::getline(lines, line)) {
        std::cout << "< " << line.substr(0, 220) << (line.size() > 220 ? " ..." : "") << '\n';
        auto parsed = gm::json::parse(line);
        check(static_cast<bool>(parsed), "reply line parses");
        if (parsed) replies.push_back(*parsed);
    }
    std::cout << "--- checks ---\n";

    const Value* init = reply_for(replies, 1);
    check(init && str(*init->find("result"), "protocolVersion") == "2025-06-18", "initialize negotiates 2025-06-18");
    check(init && str(*init->find("result")->find("serverInfo"), "name") == "gm", "serverInfo.name is gm");

    const Value* tools = reply_for(replies, 2);
    std::string names;
    if (tools) for (const Value& t : tools->find("result")->find("tools")->as_array()) names += str(t, "name") + ",";
    check(names == "next_context,finish,run_code,", "tools/list is next_context, finish, run_code: " + names);
    check(tools && str(tools->find("result")->find("tools")->as_array()[2], "description").find("The verbs are: read_file, write_file.") != std::string::npos,
          "run_code description names the verbs");

    Value step1 = structured(replies, 3);
    check(step1.find("ok") && step1.find("ok")->as_bool() && step1.find("step")->as_number() == 1, "next_context opens step 1");
    check(str(step1, "rules").rfind("# Rules\n\n1. Paths may point", 0) == 0, "next_context returns the rules");
    check(str(step1, "prefixSha").size() == 64, "prefixSha is a sha256");
    std::string first_run = run_of(replies, 3);

    Value code4 = structured(replies, 4);
    check(code4.find("ok") && code4.find("ok")->as_bool(), "run_code ok");
    check(str(code4, "output").find("\"read\":{\"ok\":true,\"output\":\"return 42\"}") != std::string::npos, "run_code output carries the verb results");
    check(code4.find("actionSeq") && code4.find("actionSeq")->is_number(), "run_code names its actionSeq");

    Value code5 = structured(replies, 5);
    check(str(code5, "error") == "refused: unknown argument bogus; run_code takes body, timeoutMs, format", "run_code refuses an unknown argument: " + str(code5, "error"));

    Value fin6 = structured(replies, 6);
    check(str(fin6, "error") == "refused: finish needs a non-empty witness string", "finish without a witness is refused");
    check(!str(fin6, "rulesNotice").empty(), "the refused finish carries a rules notice");

    Value fin7 = structured(replies, 7);
    check(fin7.find("finished") && fin7.find("finished")->as_bool(), "finish with a witness ends the run");

    Value after8 = structured(replies, 8);
    check(str(after8, "error") == "refused: run " + first_run + " has ended; call next_context to open a new run", "run_code after finish is refused: " + str(after8, "error"));
    Value child9 = structured(replies, 9);
    check(str(child9, "error") == "refused: run " + first_run + " has ended; the session that opened it calls next_context to open the next run",
          "child next_context after finish is refused");

    Value step10 = structured(replies, 10);
    std::string second_run = run_of(replies, 10);
    check(step10.find("ok") && step10.find("ok")->as_bool() && step10.find("step")->as_number() == 1 && second_run != first_run && !second_run.empty(),
          "next_context after finish opens a fresh run " + second_run);
    std::string successor;
    {
        std::ifstream f(runs / first_run / "successor");
        std::getline(f, successor);
    }
    check(successor == second_run, "the closed run names its successor");

    Value step20 = structured(replies, 20);
    {
        double before = step10.find("total")->as_number();
        bool full_only_new = true;
        bool first_new_full = false;
        for (const Value& e : step20.find("events")->as_array()) {
            bool full = e.find("t") != nullptr;
            double seq = e.find("seq") ? e.find("seq")->as_number() : 0;
            if (full && seq <= before) full_only_new = false;
            if (full && seq == before + 1) first_new_full = true;
        }
        check(step20.find("step") && step20.find("step")->as_number() == 2 && full_only_new && first_new_full &&
                  step20.find("older")->as_number() < before,
              "step 2 has the new events in full and the seen ones as compact records");
    }

    const Value* res = reply_for(replies, 11);
    check(res && res->find("result") && res->find("result")->find("contents")->as_array()[0].find("text")->as_string().find("## Rules") != std::string::npos,
          "resources/read serves skill://gm/SKILL.md");
    const Value* prompts = reply_for(replies, 12);
    check(prompts && prompts->find("result")->find("prompts")->as_array().size() == 2, "prompts/list lists gm and gm-continue");
    const Value* unknown = reply_for(replies, 13);
    check(unknown && unknown->find("error") && unknown->find("error")->find("code")->as_number() == -32601, "unknown method is -32601");
    const Value* ping = reply_for(replies, 14);
    check(ping && ping->find("result") && ping->find("result")->is_object(), "ping answers {}");
    const Value* tool15 = reply_for(replies, 15);
    check(tool15 && tool15->find("error") && tool15->find("error")->find("message")->as_string().rfind("Unknown tool: read_file; the code surface", 0) == 0,
          "a verb called as a tool is -32602 with guidance");
    bool parse_error = false;
    int duplicates = 0;
    for (const Value& r : replies) {
        if (r.find("error") && r.find("error")->find("code")->as_number() == -32700) parse_error = true;
        const Value* rid = r.find("id");
        if (rid && rid->is_number() && rid->as_number() == 4) ++duplicates;
    }
    check(parse_error, "a bad line is -32700 Parse error");
    check(duplicates == 2, "a repeated id is answered");
    const Value* templates = reply_for(replies, 16);
    check(templates && templates->find("result")->find("resourceTemplates")->as_array().size() == 4, "four resource templates");
    const Value* skills = reply_for(replies, 17);
    check(skills && skills->find("result")->find("skills")->as_array().size() == 2, "skills/list lists two skills");
    const Value* completion = reply_for(replies, 18);
    check(completion && gm::json::dump(*completion->find("result")) == R"({"completion":{"values":["gm-continue"],"total":1,"hasMore":false}})",
          "completion/complete suggests gm-continue");
    check(reply_for(replies, 19) != nullptr, "logging/setLevel answers");
    std::size_t answered = 0;
    for (const Value& r : replies) answered += r.find("id") != nullptr ? 1 : 0;
    check(answered == script.size() - 1, "every request is answered and the notification is not: " + std::to_string(answered));

    auto first_log = gm::RunLog::open(runs / first_run);
    std::string kinds;
    int code_calls_with_body = 0;
    std::string end_status;
    if (first_log) {
        auto events = first_log->read_all();
        if (events) {
            for (const Value& e : *events) {
                kinds += str(e, "kind") + " ";
                if (str(e, "kind") == "code-call" && e.find("body") && e.find("body")->as_number() == code4.find("actionSeq")->as_number()) {
                    ++code_calls_with_body;
                }
                if (str(e, "kind") == "end") end_status = str(e, "status") + " witness=" + str(e, "witness");
            }
        }
    }
    std::cout << "first run kinds: " << kinds << '\n';
    check(kinds.find("duplicate") != std::string::npos, "the repeated id is logged as duplicate, not run again");
    check(code_calls_with_body == 2, "both verb calls are logged as code-call with the body seq");
    check(end_status == "finished witness=run_code returned the stored body", "end event: " + end_status);
    check(fs::exists(runs / first_run / "rules.md") && fs::exists(runs / first_run / "task.json"), "run dir has rules.md and task.json");

#ifdef GMNEW_HAVE_RUNCODE
    {
        gm::mcp::ServerOptions real = options;
        real.run_body = [](gm::VerbTable& table, std::string_view body, const fs::path& rootp, std::string_view format) { return gm::run_body(table, body, rootp, format); };
        real.run_dir.reset();
        std::istringstream in2(call(1, "next_context", "{}") + "\n" +
                               call(2, "run_code", R"({"body":"const [w] = await Promise.all([gm.write_file({path:'b',content:'hi'})]); const r = await gm.read_file({path:'b'}); return {w: w.ok, r: r.output};"})") + "\n");
        std::ostringstream out2;
        gm::mcp::serve_stream(in2, out2, verbs, real);
        std::cout << "quickjs: " << out2.str();
        check(out2.str().find(R"(\"output\":\"{\\\"w\\\":true,\\\"r\\\":\\\"hi\\\"}\")") != std::string::npos, "run_code through QuickJS-NG");
    }
#endif

    std::cout << "--- item 1: finish rules ---\n";
    {
        RowVerbs rows;
        rows.rows = {"prd-abc open ship it", "unknown-q1 open what colour"};
        Harness h(rows, fresh_options(root, "rows"));
        h.call("next_context", "{}");
        h.call("run_code", R"({"body":"x"})");
        Value open = h.call("finish", R"({"witness":"w"})");
        check(str(open, "error") == "refused: 2 row(s) open: prd-abc ship it; unknown-q1 what colour. Resolve each with its witness, or "
                                    "delete a PRD you will not implement with prd_delete. A question for the owner stays open until the owner answers",
              "finish names the open rows: " + str(open, "error"));
        Value escape = h.call("finish", R"({"witness":"w","stopRows":true})");
        check(str(escape, "error") == str(open, "error"), "no argument ends a run with a row open");
        Value gap = h.call("finish", R"({"witness":"w","gaps":["left (prd-abc) for later"]})");
        check(str(gap, "error") == "refused: gap names open row prd-abc; a gap cannot stand in for an open row, so resolve it or, for a PRD, delete it",
              "a gap that names an open row is refused: " + str(gap, "error"));
        rows.rows = {"prd-abc resolved ship it", "unknown-q1 resolved what colour"};
        Value done = h.call("finish", R"({"witness":"w","gaps":["prd-abc was not load tested"]})");
        check(done.find("finished") && done.find("finished")->as_bool(), "finish ends the run once no row is open");
    }

    std::cout << "--- item 2: feed, pending, durMs ---\n";
    {
        auto options = fresh_options(root, "feed");
        Harness h(verbs, options);
        h.call("run_code", R"({"body":"early"})");
        fs::path dir = h.server->run_dir();
        bool queued = fs::exists(dir / "pending.jsonl");
        Value step1 = h.call("next_context", "{}");
        const Value* pending = step1.find("pending");
        check(queued && pending && pending->is_array() && pending->as_array().size() == 1 &&
                  str(pending->as_array()[0], "kind") == "rules-notice" &&
                  pending->as_array()[0].find("id")->as_number() == pending->as_array()[0].find("seq")->as_number(),
              "next_context delivers the queued rules-notice once, with id = seq");
        bool cleared = !fs::exists(dir / "pending.jsonl");
        for (const auto& entry : fs::directory_iterator(dir)) cleared = cleared && entry.path().extension() != ".reading";
        check(cleared, "delivery clears the queue file and its claimed copy after the reply is written");
        check(str(*step1.find("pendingCommands"), "wait") == "\"gm\" events --dir \"" + dir.string() + "\" --wait",
              "pendingCommands.wait names the run directory");
        Value step2 = h.call("next_context", "{}");
        check(step2.find("pending") == nullptr, "a delivered event is not listed again");
        auto started = std::chrono::steady_clock::now();
        h.call("next_context", R"({"waitMs":300})");
        auto held = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - started).count();
        check(held >= 280, "waitMs holds next_context when nothing is pending: " + std::to_string(held) + " ms");
        std::string sha;
        bool same_sha = true;
        Value last;
        for (int i = 0; i < 6; ++i) {
            last = h.call("next_context", "{}");
            h.call("run_code", R"({"body":"sleep:1:)" + std::to_string(i) + R"("})");
            if (!sha.empty() && str(last, "prefixSha") != sha) same_sha = false;
            sha = str(last, "prefixSha");
        }
        last = h.call("next_context", "{}");
        int compact = 0;
        int full_seen = 0;
        double total_before = last.find("older")->as_number();
        for (const Value& e : last.find("events")->as_array()) {
            if (e.find("t") == nullptr && str(e, "kind") != "range") compact += 1;
            if (e.find("t") == nullptr && e.find("tool") && e.find("full")) full_seen += 1;
        }
        std::cout << "feed events: " << gm::json::dump(*last.find("events")).substr(0, 600) << '\n';
        check(compact > 0 && full_seen > 0 && total_before > 0 && same_sha && str(last, "prefixSha") == sha,
              "seen events come back as compact records within the horizons, prefixSha unchanged");
        auto events = log_of(dir);
        bool timed = false;
        for (const Value& e : events) {
            if (str(e, "kind") == "result" && e.find("startMono") && e.find("durMs")) timed = true;
        }
        bool call_timed = false;
        for (const Value& e : events) {
            if (str(e, "kind") == "code-call" && e.find("startMono") && e.find("durMs")) call_timed = true;
        }
        check(timed && call_timed, "result and code-call events carry startMono and durMs");
    }

    std::cout << "--- items 3 and 4: background run_code and job notices ---\n";
    {
        auto options = fresh_options(root, "bg");
        options.stuck_ms = 60;
        options.monitor_ms = 20;
        options.notice_ms = 150;
        RowVerbs rows;
        rows.rows = {"prd-r1 resolved done thing"};
        Harness h(rows, options);
        h.call("next_context", "{}");
        Value bg = h.call("run_code", R"({"body":"sleep:600:seven","timeoutMs":50})");
        std::string job = str(bg, "background");
        check(bg.find("ok")->as_bool() && job == "body-" + gm::json::dump(*bg.find("actionSeq")) && str(bg, "state") == "running",
              "a body past timeoutMs becomes a background run: " + gm::json::dump(bg));
        auto early = log_of(h.server->run_dir());
        check(count_kind(early, "code-call") >= 1, "the body's verb calls are logged as they happen");
        Value refused = h.call("finish", R"({"witness":"w"})");
        check(str(refused, "error") == "refused: background run " + job +
                                          " is still running; job_status watches it, and finish with stopBackground: true kills it",
              "finish is refused while a background run is running: " + str(refused, "error"));
        std::this_thread::sleep_for(std::chrono::milliseconds(300));
        Value notices = h.call("next_context", "{}");
        std::cout << "notices: jobsOpen=" << (notices.find("jobsOpen") ? gm::json::dump(*notices.find("jobsOpen")) : "-")
                  << " jobsStuck=" << (notices.find("jobsStuck") ? gm::json::dump(*notices.find("jobsStuck")) : "-")
                  << " jobsRunning=" << (notices.find("jobsRunning") ? gm::json::dump(*notices.find("jobsRunning")) : "-") << '\n';
        check(notices.find("jobsOpen") && str(notices.find("jobsOpen")->as_array()[0], "job") == job &&
                  notices.find("jobsOpen")->as_array()[0].find("stuck")->as_bool(),
              "jobsOpen lists the open body as stuck");
        check(notices.find("jobsStuck") && str(notices.find("jobsStuck")->as_array()[0], "job") == job, "jobsStuck names the body");
        check(notices.find("jobsStarted") && str(notices.find("jobsStarted")->as_array()[0], "job") == job, "jobsStarted names the body");
        check(notices.find("jobsRunning") && notices.find("jobsRunning")->as_array()[0].find("prd") &&
                  notices.find("jobsRunning")->as_array()[0].find("prd")->find("total")->as_number() == 1,
              "jobsRunning carries the prd summary");
        Value status = h.call("run_code", R"({"body":"status:)" + job + R"("})");
        std::string output = str(status, "output");
        check(output.find("\"state\":\"exited\"") != std::string::npos && output.find("\"value\":\"{\\\"value\\\":\\\"seven\\\",\\\"afterOk\\\":true}\"") != std::string::npos,
              "job_status with waitMs returns the body's value: " + output.substr(0, 300));
        Value after = h.call("next_context", "{}");
        std::cout << "ended: " << (after.find("jobsEnded") ? gm::json::dump(*after.find("jobsEnded")) : "-") << std::endl;
        check(after.find("jobsEnded") &&
                  str(after.find("jobsEnded")->as_array()[0], "output") == "{\"value\":\"seven\",\"afterOk\":true}",
              "jobsEnded reports the body's end and value");
        Value bg2 = h.call("run_code", R"({"body":"sleep:2000:late","timeoutMs":30})");
        Value stopped = h.call("finish", R"({"witness":"stopped it","stopBackground":true})");
        auto events = log_of(h.server->run_dir());
        bool killed = false;
        for (const Value& e : events) {
            if (str(e, "kind") == "job-killed" && str(e, "job") == str(bg2, "background") && str(e, "reason") == "stopBackground") killed = true;
        }
        check(stopped.find("finished") && killed, "stopBackground kills the background run and finish ends the run");
    }

    std::cout << "--- item 5: resume ---\n";
    {
        auto options = fresh_options(root, "resume");
        options.supervised = true;
        fs::path dir;
        {
            Harness a(verbs, options);
            dir = a.server->run_dir();
            a.server->accept(rpc(1, "prompts/get", R"({"name":"gm","arguments":{"task":"resume this task"}})"));
            a.call("next_context", "{}");
            a.call("run_code", R"({"body":"first"})", 77);
            a.call("next_context", "{}");
            a.server->input_ended();
        }
        {
            auto log = gm::RunLog::open(dir);
            log->append("action", obj().set("step", 2).set("tool", "run_code").set("args", obj().set("body", "lost")).set("rpcId", 99));
        }
        options.run_dir = dir;
        options.restart_reason = "test restart";
        Harness b(verbs, options);
        b.next_id = 2000;
        Value repeat = b.call("run_code", R"({"body":"first"})", 77);
        Value lost = b.call("run_code", R"({"body":"lost"})", 99);
        Value step = b.call("next_context", "{}");
        std::cout << "resumed step: " << gm::json::dump(step).substr(0, 400) << std::endl;
        if (!step.find("step")) step.set("step", -1);
        check(b.server->run_id() == dir.filename().string() && step.find("step")->as_number() == 3 && str(step, "task") == "resume this task",
              "a resumed run keeps its steps and its task: step " + gm::json::dump(*step.find("step")));
        check(str(repeat, "output").find("first") != std::string::npos, "a repeated id is answered from the log");
        check(str(lost, "error") == "the call was interrupted by a restart; check its outside effects before repeating it",
              "an action with no end is answered as interrupted");
        check(step.find("recovery") && str(*step.find("recovery"), "note").find("seq ") != std::string::npos,
              "the first step after a resume carries the recovery note");
        auto events = log_of(dir);
        check(count_kind(events, "restart") == 1 && count_kind(events, "recovery") == 1 && count_kind(events, "paused") == 1,
              "the log has paused, restart and recovery");
        b.call("finish", R"({"witness":"done"})");
        b.call("next_context", "{}");
        std::string successor = b.server->run_id();
        options.run_dir = dir;
        Harness c(verbs, options);
        c.next_id = 3000;
        check(c.server->run_id() == successor && successor != dir.filename().string(), "opening an ended run follows its successor");
        c.call("run_code", R"({"body":"x"})");
        check(c.call("next_context", "{}").find("step")->as_number() == 2, "the successor resumes at its own step count");
    }

    std::cout << "--- item 5b: task argument and served skill text ---\n";
    {
        Harness h(verbs, fresh_options(root, "task-argument"));
        h.server->accept(rpc(1, "prompts/get", R"({"name":"gm","arguments":{"task":"we restarted, finish all remaining work"}})"));
        Value step = h.call("next_context", "{}");
        check(str(step, "task") == "we restarted, finish all remaining work", "prompts/get keeps the whole task argument, commas and spaces included");
        auto skill = gm::mcp::served_skill_text(fresh_options(root, "skill-text").skills, "skill://gm/SKILL.md");
        check(skill && skill->find("## Rules") != std::string::npos, "served_skill_text returns the gm skill file");
        check(!gm::mcp::served_skill_text(fresh_options(root, "skill-text").skills, "skill://gm/NOPE.md") &&
                  !gm::mcp::served_skill_text(fresh_options(root, "skill-text").skills, "skill://nope/SKILL.md"),
              "served_skill_text refuses unserved skill uris");
    }

    std::cout << "--- item 5c: a one-word task argument may have been cut ---\n";
    {
        Harness h(verbs, fresh_options(root, "task-word"));
        h.server->accept(rpc(1, "prompts/get", R"({"name":"gm","arguments":{"task":"resume"}})"));
        h.server->accept(rpc(2, "prompts/get", R"({"name":"gm","arguments":{"task":"resume this task"}})"));
        std::string warning = str(result_of(h, 1), "warning");
        check(warning.find("may have been cut") != std::string::npos && warning.find("length 6") != std::string::npos,
              "a one-word task argument gets a warning that the task may have been cut, naming its length");
        check(result_of(h, 2).find("warning") == nullptr, "a multi-word task argument gets no warning");
    }

    std::cout << "--- item 5d: subscriptions/listen ---\n";
    {
        fs::path skills = root / "skills-listen";
        fs::copy(fs::path(GMNEW_SOURCE_DIR) / "skills", skills, fs::copy_options::recursive);
        auto options = fresh_options(root, "listen");
        options.skills = skills;
        Harness h(verbs, options);
        const fs::path skill_file = skills / "gm" / "SKILL.md";
        h.server->accept(rpc(400, "subscriptions/listen",
                             R"({"notifications":{"toolsListChanged":true,"resourceSubscriptions":["skill://gm/SKILL.md"]}})"));
        Value ack = first_notice(h, "notifications/subscriptions/acknowledged");
        const Value* acked = field(&ack, {"params", "notifications", "resourceSubscriptions"});
        check(acked && acked->is_array() && acked->as_array().size() == 1 && acked->as_array()[0].as_string() == "skill://gm/SKILL.md",
              "the acknowledgement names the resource subscriptions the server honors");
        check(field(&ack, {"params", "notifications", "toolsListChanged"}) == nullptr,
              "the acknowledgement omits the filter types the server does not honor");
        check(number_at(field(&ack, {"params", "_meta", "io.modelcontextprotocol/subscriptionId"})) == 400,
              "the acknowledgement carries the listen request id as subscriptionId");
        check(h.raw(400).find("result") == nullptr && h.raw(400).find("error") == nullptr,
              "subscriptions/listen gets no reply while the stream is open");

        h.server->accept(rpc(401, "tools/list", "{}"));
        check(notice_count(h, "notifications/resources/updated") == 0, "an unchanged subscribed skill file sends no update");

        append_line(skill_file, "\nA change the subscription must see.\n");
        h.server->accept(rpc(402, "tools/list", "{}"));
        Value updated = first_notice(h, "notifications/resources/updated");
        const Value* updated_params = field(&updated, {"params"});
        check(notice_count(h, "notifications/resources/updated") == 1 && updated_params && str(*updated_params, "uri") == "skill://gm/SKILL.md",
              "a changed subscribed skill file sends notifications/resources/updated for its uri");
        check(number_at(field(&updated, {"params", "_meta", "io.modelcontextprotocol/subscriptionId"})) == 400,
              "the update carries the subscriptionId of its listen request");

        h.server->accept(rpc(403, "tools/list", "{}"));
        check(notice_count(h, "notifications/resources/updated") == 1, "the change is announced once");

        h.server->accept(R"({"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":400}})");
        Value closed = result_of(h, 400);
        check(str(closed, "resultType") == "complete" && number_at(field(&closed, {"_meta", "io.modelcontextprotocol/subscriptionId"})) == 400,
              "cancelling the stream answers subscriptions/listen with a complete result");

        append_line(skill_file, "\nA change after the cancel.\n");
        h.server->accept(rpc(404, "tools/list", "{}"));
        check(notice_count(h, "notifications/resources/updated") == 1, "a cancelled stream gets no further updates");

        h.server->accept(rpc(405, "resources/subscribe", R"({"uri":"skill://gm/SKILL.md"})"));
        check(h.raw(405).find("error") && h.raw(405).find("error")->find("code") &&
                  h.raw(405).find("error")->find("code")->as_number() == -32601,
              "resources/subscribe is replaced by subscriptions/listen, so it answers method not found");
        h.server->accept(rpc(406, "subscriptions/listen", R"({"notifications":{"resourceSubscriptions":["skill://gm/NOPE.md"]}})"));
        check(h.raw(406).find("error") && h.raw(406).find("error")->find("code") &&
                  h.raw(406).find("error")->find("code")->as_number() == -32602,
              "subscriptions/listen of a missing skill file is -32602");
    }

    std::cout << "--- item 6: rulesPending ---\n";
    {
        Harness h(verbs, fresh_options(root, "rules"));
        Value first = h.call("next_context", "{}");
        check(first.find("rulesPending") == nullptr, "no rulesPending while rules.md is as the run started");
        std::string changed = "# Rules\n\n1. A changed rule.\n";
        std::ofstream(h.server->run_dir() / "rules.md", std::ios::binary | std::ios::trunc) << changed;
        Value second = h.call("next_context", "{}");
        check(str(second, "rulesPending").find("rules.md changed since the run started") != std::string::npos &&
                  str(second, "rulesPending").find("1. A changed rule.") != std::string::npos && str(second, "rules") == changed,
              "a changed rules.md gives rulesPending with the new text");
        Value third = h.call("next_context", "{}");
        check(third.find("rulesPending") == nullptr, "the change is announced once");
    }

    {
        auto options = fresh_options(root, "abandoned");
        options.supervised = true;
        fs::path dir;
        {
            Harness a(verbs, options);
            dir = a.server->run_dir();
            a.server->accept(rpc(1, "prompts/get", R"({"name":"gm","arguments":{"task":"abandon open calls"}})"));
            a.call("next_context", "{}");
            a.server->input_ended();
        }
        {
            auto log = gm::RunLog::open(dir);
            log->append("action", obj().set("step", 1).set("tool", "run_shell").set("args", obj().set("command", "cmake --build build/mcp-surface")));
        }
        options.run_dir = dir;
        options.restart_reason = "test restart";
        {
            Harness b(verbs, options);
            b.next_id = 2000;
            Value first = b.call("next_context", "{}");
            check(first.find("recovery") && str(*first.find("recovery"), "note").find("seq ") != std::string::npos,
                  "the first start after a restart lists the open call");
            b.server->input_ended();
        }
        {
            Harness c(verbs, options);
            c.next_id = 3000;
            Value second = c.call("next_context", "{}");
            auto events = log_of(dir);
            check(count_kind(events, "recovery") == 1 && count_kind(events, "abandoned") == 1,
                  "the open call is closed once in the log, with its reason");
            check(second.find("recovery") == nullptr, "a later restart does not list the closed call again");
            c.server->input_ended();
        }
    }

    std::error_code ec;
    fs::remove_all(root, ec);
    std::cout << (failures == 0 ? "ALL PASSED" : "FAILURES: " + std::to_string(failures)) << '\n';
    return failures == 0 ? 0 : 1;
}
