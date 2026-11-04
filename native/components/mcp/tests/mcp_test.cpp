#include <cstdio>
#include <filesystem>
#include <fstream>
#include <random>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

#include "gmnew/json.hpp"
#include "gmnew/log.hpp"
#include "gmnew/mcp.hpp"
#include "gmnew/verbs.hpp"

#ifdef GMNEW_HAVE_RUNCODE
#include "gmnew/runcode.hpp"
#endif

namespace fs = std::filesystem;
using gmnew::json::Value;

namespace {

int failures = 0;

void check(bool ok, const std::string& what) {
    std::cout << (ok ? "ok   " : "FAIL ") << what << '\n';
    if (!ok) ++failures;
}

class FakeVerbs : public gmnew::VerbTable {
public:
    std::vector<gmnew::VerbInfo> list() const override {
        return {{"read_file", "Read a file.", R"({"type":"object","properties":{"path":{"type":"string"}},"required":["path"]})"},
                {"write_file", "Write a file.", R"({"type":"object","properties":{"path":{"type":"string"},"content":{"type":"string"}},"required":["path","content"]})"}};
    }
    Value call(std::string_view name, const Value& args) override {
        const Value* path = args.find("path");
        if (name == "write_file") {
            stored = args.find("content") ? args.find("content")->as_string() : "";
            return Value(gmnew::json::Object{}).set("ok", true).set("output", "wrote " + (path ? path->as_string() : ""));
        }
        if (name == "read_file") return Value(gmnew::json::Object{}).set("ok", true).set("output", stored);
        return Value(gmnew::json::Object{}).set("ok", false).set("error", "unknown verb");
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

}  // namespace

int main() {
    fs::path root = fs::temp_directory_path() / ("gmnew-mcp-test-" + std::to_string(std::random_device{}()));
    fs::path workspace = root / "ws";
    fs::path runs = root / "runs";
    fs::create_directories(workspace);
    fs::create_directories(runs);

    FakeVerbs verbs;
    gmnew::mcp::ServerOptions options;
    options.workspace = workspace;
    options.runs = runs;
    options.skills = fs::path(GMNEW_SOURCE_DIR) / "skills";
    options.run_body = [](gmnew::VerbTable& table, std::string_view body, const fs::path&) -> deoxidene::Result<Value, std::string> {
        Value args = Value(gmnew::json::Object{}).set("path", "a.txt").set("content", std::string(body));
        Value wrote = table.call("write_file", args);
        Value read = table.call("read_file", Value(gmnew::json::Object{}).set("path", "a.txt"));
        return Value(gmnew::json::Object{}).set("wrote", wrote).set("read", read);
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
    int code = gmnew::mcp::serve_stream(in, out, verbs, options);
    check(code == 0, "serve_stream exits 0");

    std::vector<Value> replies;
    std::istringstream lines(out.str());
    std::string line;
    std::cout << "--- transcript ---\n";
    for (std::size_t i = 0; i < script.size(); ++i) std::cout << "> " << script[i].substr(0, 160) << '\n';
    while (std::getline(lines, line)) {
        std::cout << "< " << line.substr(0, 220) << (line.size() > 220 ? " ..." : "") << '\n';
        auto parsed = gmnew::json::parse(line);
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
    check(step20.find("step") && step20.find("step")->as_number() == 2 && step20.find("older") &&
              step20.find("older")->as_number() == step10.find("total")->as_number() &&
              step20.find("events")->as_array().size() > 0 &&
              step20.find("events")->as_array()[0].find("seq")->as_number() == step10.find("total")->as_number() + 1,
          "step 2 reads only the events after step 1's total");

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
    check(completion && gmnew::json::dump(*completion->find("result")) == R"({"completion":{"values":["gm-continue"],"total":1,"hasMore":false}})",
          "completion/complete suggests gm-continue");
    check(reply_for(replies, 19) != nullptr, "logging/setLevel answers");
    std::size_t answered = 0;
    for (const Value& r : replies) answered += r.find("id") != nullptr ? 1 : 0;
    check(answered == script.size() - 1, "every request is answered and the notification is not: " + std::to_string(answered));

    auto first_log = gmnew::RunLog::open(runs / first_run);
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
        gmnew::mcp::ServerOptions real = options;
        real.run_body = [](gmnew::VerbTable& table, std::string_view body, const fs::path& rootp) { return gmnew::run_body(table, body, rootp); };
        real.run_dir.reset();
        std::istringstream in2(call(1, "next_context", "{}") + "\n" +
                               call(2, "run_code", R"({"body":"const [w] = await Promise.all([gm.write_file({path:'b',content:'hi'})]); const r = await gm.read_file({path:'b'}); return {w: w.ok, r: r.output};"})") + "\n");
        std::ostringstream out2;
        gmnew::mcp::serve_stream(in2, out2, verbs, real);
        std::cout << "quickjs: " << out2.str();
        check(out2.str().find(R"(\"output\":\"{\\\"w\\\":true,\\\"r\\\":\\\"hi\\\"}\")") != std::string::npos, "run_code through QuickJS-NG");
    }
#endif

    std::error_code ec;
    fs::remove_all(root, ec);
    std::cout << (failures == 0 ? "ALL PASSED" : "FAILURES: " + std::to_string(failures)) << '\n';
    return failures == 0 ? 0 : 1;
}
