#include <algorithm>
#include <deque>
#include <iostream>
#include <random>
#include <regex>
#include <set>

#include "gmnew/log.hpp"
#include "gmnew/mcp.hpp"
#include "internal.hpp"

namespace gmnew::mcp {

using namespace detail;

namespace {

namespace fs = std::filesystem;

const std::vector<std::string> kSupportedVersions = {"2025-11-25", "2025-06-18"};
constexpr const char* kRunMeta = "com.anentrypoint.gmnew/run";
constexpr const char* kRunSeq = "com.anentrypoint.gmnew/seq";
constexpr const char* kLogMeta = "com.anentrypoint.gmnew/log";
constexpr const char* kServerName = "gm";
constexpr const char* kServerTitle = "gm-new run worker";
constexpr const char* kGmSkillUri = "skill://gm/SKILL.md";
constexpr std::size_t kReplyMemory = 256;
constexpr std::size_t kEventsCap = 20000;
constexpr std::size_t kOutputCap = 20000;
constexpr std::size_t kLoggedReplyChars = 1000;
constexpr std::size_t kLineCap = 400;
constexpr std::size_t kDigestErrors = 10;
constexpr std::size_t kFailedHeadChars = 1000;
constexpr std::size_t kLogTailBytes = 65536;
constexpr std::size_t kCompletionCap = 100;
constexpr std::size_t kQueueMax = 64;
constexpr int kMaxTimeoutMs = 300000;

const std::string kMcpRules =
    "# Rules\n\n"
    "1. Paths may point inside or outside the workspace. An outside path should be absolute.\n"
    "2. Call next_context at the start of every step. Each call is one step; stepsLeft counts the steps the run has left.\n"
    "3. Verify before you finish: run what you built and read its output.\n"
    "4. finish needs a witness: one string that quotes the evidence you observed. Calls sent with finish may be refused.\n"
    "5. Events older than the window are not in next_context. Query them with query_log. Do not guess.\n"
    "6. Never print, store or request secrets, environment variables or API keys.\n"
    "7. If the task cannot be done, finish with a witness that states why, with the evidence.\n";

const std::string kDefaultWitness =
    "Finish only with a witness: one string that states the evidence (command output, file content or query result) "
    "showing the task is done.";

const std::string kReplyText =
    "## Reply\n\nOne JSON object {\"tool\": \"...\", \"args\": {...}}, or a JSON array of them when the actions are "
    "independent. Nothing else.";

const std::string kCodeInstructions =
    "One tool does the work: run_code. Its body is JavaScript in the project, and each verb is a function on gm, for "
    "example await gm.read_file({ path }). The verb list is in run_code's description, gm.verbs() returns each verb's "
    "details, and finish ends the run and is not a verb. Start each step with next_context.";
const std::string kResourcesPointer =
    "Resources: skill://<name>/<file> reads a served skill file. run://<run>/log reads a run's event log, and "
    "run://<run>/witness its witness; resources/templates/list names the templates. Subscribe to a skill file with "
    "resources/subscribe to be told when it changes on disk. Log messages follow logging/setLevel, and "
    "completion/complete suggests skill names and run ids.";
const std::string kSkillPointer =
    "The gm skill holds the rules of a run, the routes for pending events, and the way to hand work to a child "
    "session. Read it when a run starts, and read it again after a compaction. Read skill://gm/SKILL.md with "
    "ReadMcpResourceTool (server gm), or run the gm prompt (mcp__gm__gm). The host's Skill tool does not list it, so "
    "do not call it with the Skill tool. The gm-continue skill plans the open rows of gm-new and hands them to the gm "
    "skill. Read skill://gm-continue/SKILL.md with ReadMcpResourceTool (server gm), or run the gm-continue prompt "
    "(mcp__gm__gm-continue). The host's Skill tool does not list it, so do not call it with the Skill tool.";

const std::string kNextContextDescription =
    "Begin a step. Returns rules, task, witness requirement, the events new since the last step in full, the older "
    "ones in compact form within two horizons, and prefixSha. pending lists the events that need you since your last "
    "step, each once, with an id. Delivery clears an event, so no later step or wait lists it again. Call it at the "
    "start of each step. query_log reaches every event. waitMs, when set, holds this call until an event is pending "
    "or that many milliseconds pass, at most 300000. child: true makes the call a read by a subagent on this "
    "connection: it takes no step, claims no pending event, and its reply has role child and the owning run. run, "
    "with child, names that owning run, and another run is refused.";
const std::string kFinishDescription =
    "End the run. witness is one string that quotes the evidence you observed. gaps optionally lists, one string "
    "each, what the run did not check; the end event logs them. finish is refused while a background run is running, "
    "and stopBackground true kills it first. finish is refused while a PRD or question row is open, and names the "
    "rows; stopRows true ends the run anyway, with each open row listed as a gap in the end event.";

std::string run_code_description(const std::string& verb_names) {
    return "Run a JavaScript body in the project. The body is an ES module when format is esm and CommonJS when format "
           "is cjs. Left out, format follows the project's package.json type (type module is esm, anything else is "
           "cjs). A CommonJS body loads with require() and cannot use a static import. Static imports (single or "
           "multi-line) load ES modules, and require() loads CommonJS; each project file loads in its own format "
           "(.mjs is ES module, .cjs is CommonJS, .js follows the package.json type), and each file is read from disk "
           "when the call runs. Relative paths resolve against the project root. Paths may point inside or outside "
           "the workspace, for the body's own require and import and for the file verbs alike; an outside path should "
           "be absolute. A non-literal import() or require() is refused. The body receives gm, with one method per "
           "verb: await gm.<name>(args), and gm.project is the project root. The verbs are: " +
           verb_names +
           ". gm.verbs() returns each verb's description and input schema as data. A failed call returns "
           "{ok:false, error} and does not stop the body. The body's return value comes back as JSON. A body still "
           "running after timeoutMs (default 180000, at most 300000) becomes a background run: the call returns its "
           "job id at once, job_status with waitMs returns its value, and finish is refused while it runs unless "
           "stopBackground is true. One step is one body: read the inputs in one Promise.all, decide in code, act "
           "with the independent writes in one Promise.all, and verify in the same body. The ten most-used verbs: "
           "read_file({ path, offset?, limit? }), run_shell({ command, timeoutMs? }), write_file({ path, content }), "
           "query_log({ js?, kind?, fromMono?, toMono?, after?, last? }), search({ query, k? }), fetch({ url, "
           "timeoutMs? }), job_start({ job, command, timeoutMs? }), job_status({ job, waitMs?, offset? }), "
           "callers({ name, limit? }), grep({ pattern, root?, mode?, ignoreCase?, limit?, offset? }). finish is not a "
           "verb: end the run with the finish tool. The reply names its own action in actionSeq, the seq of the "
           "run_code action event in the log. A body's console output is not returned and is not logged. An argument "
           "this tool does not take is refused by name.";
}

const std::set<std::string> kReadOnlyTools = {
    "next_context", "read_file", "list_dir",  "stat_file", "search",     "wiki_search",  "grep",
    "callers",      "impact",    "query_log", "job_status", "git_status", "git_log",     "git_diff",
    "git_show",     "ci_status", "prd_list",  "unknown_list", "review_join"};
const std::set<std::string> kLoggedOutputTools = {"query_log", "job_status", "run_shell", "run_code"};
const std::vector<std::string> kLogLevels = {"debug", "info", "notice", "warning", "error", "critical", "alert", "emergency"};
const std::map<std::string, std::string> kNoticeLevels = {
    {"restart", "notice"},  {"reload", "notice"},     {"tools-changed", "notice"}, {"end", "notice"},
    {"paused", "info"},     {"cancel", "info"},       {"job-unstuck", "info"},     {"recovery", "warning"},
    {"job-stuck", "warning"}, {"job-killed", "warning"}, {"rules-notice", "warning"}, {"error", "error"}};
const std::vector<std::string> kDetailFields = {"job",    "tool",  "state",  "code",           "method", "message",
                                                "error",  "reason", "status", "rules", "sinceProgressMs", "lastSeq"};
const std::map<int, std::string> kRuleText = {{2, "call next_context at the start of every step"},
                                              {3, "verify before you finish"},
                                              {4, "finish needs a witness"}};

Value str_schema() { return object().set("type", "string"); }
Value num_schema() { return object().set("type", "number"); }
Value bool_schema() { return object().set("type", "boolean"); }

Value object_schema(Value properties, std::vector<std::string> required) {
    Value req = array();
    for (auto& name : required) req.push(name);
    return object().set("type", "object").set("properties", std::move(properties)).set("required", std::move(req));
}

Value string_array(const std::vector<std::string>& items) {
    Value out = array();
    for (const auto& item : items) out.push(item);
    return out;
}

std::string title_of(const std::string& name) {
    std::string words = name;
    std::replace(words.begin(), words.end(), '_', ' ');
    if (!words.empty() && words[0] >= 'a' && words[0] <= 'z') words[0] = static_cast<char>(words[0] - 'a' + 'A');
    return words;
}

Value annotated(Value tool, Value output_schema) {
    std::string name = tool.find("name")->as_string();
    bool read_only = kReadOnlyTools.contains(name) && name != "next_context";
    bool records_only = name == "next_context" || name == "finish";
    tool.set("title", title_of(name));
    tool.set("annotations", object()
                                .set("readOnlyHint", read_only)
                                .set("destructiveHint", !read_only && !records_only)
                                .set("openWorldHint", false));
    tool.set("outputSchema", std::move(output_schema));
    return tool;
}

Value code_tools(const VerbTable& verbs) {
    std::string names;
    for (const VerbInfo& verb : verbs.list()) {
        if (!names.empty()) names += ", ";
        names += verb.name;
    }
    Value next_context =
        object()
            .set("name", "next_context")
            .set("description", kNextContextDescription)
            .set("inputSchema", object_schema(object().set("waitMs", num_schema()).set("child", bool_schema()).set("run", str_schema()), {}));
    Value finish = object()
                       .set("name", "finish")
                       .set("description", kFinishDescription)
                       .set("inputSchema",
                            object_schema(object()
                                              .set("witness", str_schema())
                                              .set("gaps", object().set("type", "array").set("items", str_schema()))
                                              .set("stopBackground", bool_schema())
                                              .set("stopRows", bool_schema()),
                                          {"witness"}));
    Value format = object().set("type", "string").set("enum", string_array({"esm", "cjs"}));
    Value run_code = object()
                         .set("name", "run_code")
                         .set("description", run_code_description(names))
                         .set("inputSchema", object_schema(object().set("body", str_schema()).set("timeoutMs", num_schema()).set("format", format), {"body"}));
    Value next_out = object_schema(object()
                                       .set("ok", bool_schema())
                                       .set("refused", bool_schema())
                                       .set("error", str_schema())
                                       .set("step", num_schema())
                                       .set("run", str_schema())
                                       .set("stepsLeft", num_schema())
                                       .set("maxSteps", num_schema())
                                       .set("total", num_schema())
                                       .set("prefixSha", str_schema())
                                       .set("actionSeq", num_schema()),
                                   {"ok"});
    Value run_out = object_schema(object()
                                      .set("ok", bool_schema())
                                      .set("refused", bool_schema())
                                      .set("error", str_schema())
                                      .set("truncated", bool_schema())
                                      .set("background", str_schema())
                                      .set("state", str_schema())
                                      .set("actionSeq", num_schema()),
                                  {"ok"});
    Value finish_out = object_schema(object()
                                         .set("ok", bool_schema())
                                         .set("refused", bool_schema())
                                         .set("error", str_schema())
                                         .set("finished", bool_schema())
                                         .set("actionSeq", num_schema()),
                                     {"ok"});
    Value list = array();
    list.push(annotated(std::move(next_context), std::move(next_out)));
    list.push(annotated(std::move(finish), std::move(finish_out)));
    list.push(annotated(std::move(run_code), std::move(run_out)));
    return list;
}

std::string render_tools(const Value& tools) {
    std::string out;
    for (const Value& tool : tools.as_array()) {
        if (!out.empty()) out += "\n";
        out += tool.find("name")->as_string() + " " + json::dump(*tool.find("inputSchema")) + ": " +
               tool.find("description")->as_string();
    }
    return out;
}

std::string prefix_sha(const std::string& rules, const std::string& task, const Value& tools) {
    std::string prefix = trim(rules) + "\n\n## Task\n\n" + task + "\n\n## Witness requirement\n\n" + kDefaultWitness +
                         "\n\n## Tools\n\n" + render_tools(tools) + "\n\n" + kReplyText;
    return sha256_hex(prefix);
}

std::string new_run_id() {
    std::string stamp = iso_now().substr(0, 19);
    std::replace(stamp.begin(), stamp.end(), ':', '-');
    std::replace(stamp.begin(), stamp.end(), 'T', '-');
    static std::mt19937_64 rng{std::random_device{}()};
    static constexpr char kHex[] = "0123456789abcdef";
    std::string hex;
    for (int i = 0; i < 6; ++i) hex.push_back(kHex[rng() & 0xF]);
    return stamp + "-" + hex;
}

fs::path current_run_dir(fs::path dir) {
    std::set<fs::path> seen;
    while (!seen.contains(dir) && fs::exists(dir / "successor")) {
        seen.insert(dir);
        std::string name;
        read_file(dir / "successor", name);
        name = trim(name);
        if (name.empty()) break;
        dir = dir.parent_path() / name;
    }
    return dir;
}

void set_successor(const fs::path& run_dir, const fs::path& successor) {
    fs::path file = run_dir / "successor";
    fs::path tmp = run_dir / "successor.tmp";
    write_file(tmp, successor.filename().string());
    std::error_code ec;
    fs::rename(tmp, file, ec);
}

std::string pretty_flat(const Value& object_value) {
    std::string out = "{";
    bool first = true;
    for (const json::Member& m : object_value.as_object()) {
        out += first ? "\n  " : ",\n  ";
        first = false;
        out += json::quote(m.first) + ": " + json::dump(m.second);
    }
    out += first ? "}" : "\n}";
    return out;
}

Value trace_of(const Value* meta) {
    Value out = object();
    if (meta == nullptr) return out;
    for (const char* key : {"traceparent", "tracestate", "baggage"}) {
        const Value* v = meta->find(key);
        if (v != nullptr && v->is_string()) out.set(key, *v);
    }
    return out;
}

Value merge(Value into, const Value& from) {
    for (const json::Member& m : from.as_object()) into.set(m.first, m.second);
    return into;
}

std::string clip(const std::string& text, std::size_t cap = kLineCap) {
    std::size_t length = js_length(text);
    if (length <= cap) return text;
    return js_prefix(text, cap) + " ...[" + std::to_string(length) + " chars]";
}

std::vector<std::string> split_lines(const std::string& text) {
    std::vector<std::string> lines;
    std::size_t at = 0;
    while (true) {
        std::size_t nl = text.find('\n', at);
        lines.push_back(text.substr(at, nl == std::string::npos ? std::string::npos : nl - at));
        if (nl == std::string::npos) break;
        at = nl + 1;
    }
    return lines;
}

Value output_digest(const std::string& text, bool failed) {
    if (text.empty()) return object().set("lines", 0).set("bytes", 0);
    static const std::regex kError(
        R"(\b(error|errors|fail|failed|failure|fatal|warn|warning|exception|traceback|denied|not ok)\b)",
        std::regex::ECMAScript | std::regex::icase);
    auto lines = split_lines(text);
    Value head = array();
    for (std::size_t i = 0; i < std::min<std::size_t>(2, lines.size()); ++i) head.push(clip(lines[i]));
    Value tail = array();
    for (std::size_t i = lines.size() >= 2 ? lines.size() - 2 : 0; i < lines.size(); ++i) tail.push(clip(lines[i]));
    Value digest = object()
                       .set("lines", number_of(lines.size()))
                       .set("bytes", number_of(text.size()))
                       .set("head", std::move(head))
                       .set("tail", std::move(tail));
    std::vector<std::string> errors;
    for (const auto& line : lines) {
        if (std::regex_search(line, kError)) errors.push_back(line);
    }
    if (!errors.empty()) {
        Value shown = array();
        for (std::size_t i = 0; i < std::min(errors.size(), kDigestErrors); ++i) shown.push(clip(errors[i]));
        digest.set("errors", std::move(shown));
        if (errors.size() > kDigestErrors) digest.set("moreErrors", number_of(errors.size() - kDigestErrors));
    }
    if (failed) {
        std::size_t shown = 0;
        std::size_t chars = 0;
        while (shown < lines.size() && (shown == 0 || chars + js_length(lines[shown]) <= kFailedHeadChars)) {
            chars += js_length(lines[shown]);
            shown += 1;
        }
        Value all = array();
        for (std::size_t i = 0; i < shown; ++i) all.push(clip(lines[i]));
        digest.set("all", std::move(all));
        if (shown < lines.size()) digest.set("more", number_of(lines.size() - shown));
    }
    return digest;
}

bool failed_of(const Value& result) {
    const Value* ok = result.find("ok");
    const Value* exit = result.find("exitCode");
    return (ok != nullptr && ok->is_bool() && !ok->as_bool()) ||
           (exit != nullptr && exit->is_number() && exit->as_number() != 0);
}

Value logged_for(const std::string& tool, const Value& result) {
    const Value* output = result.find("output");
    if (!kLoggedOutputTools.contains(tool) || output == nullptr || !output->is_string()) return result;
    const std::string& text = output->as_string();
    std::size_t length = js_length(text);
    if (length <= kLoggedReplyChars) return result;
    Value shown = result;
    shown.set("output", js_prefix(text, kLoggedReplyChars));
    shown.set("outputChars", number_of(length));
    shown.set("outputDigest", output_digest(text, failed_of(result)));
    return shown;
}

std::string query_hint(std::uint64_t shown, std::uint64_t total) {
    std::string reach = "query_log reads any event (after: seq - 1 returns it first)";
    if (total > shown) {
        return reach + ". This step's new events are seqs " + std::to_string(shown + 1) + " to " + std::to_string(total) + ".";
    }
    return reach + ".";
}

bool is_ok(const Value& v) {
    const Value* ok = v.find("ok");
    return ok != nullptr && ok->is_bool() && ok->as_bool();
}

std::string id_key(const Value* id) { return id == nullptr ? "undefined" : json::dump(*id); }

std::string text_or_undefined(const Value* v) {
    if (v == nullptr) return "undefined";
    if (v->is_string()) return v->as_string();
    return json::dump(*v);
}

class LoggedVerbs;

}  // namespace

struct Server::State {
    VerbTable& verbs;
    ServerOptions options;
    LineWriter write;
    SkillCache skills;
    std::map<std::string, std::string> subscriptions;
    std::optional<std::string> log_level;
    std::vector<Value> queued_notices;

    struct Session {
        fs::path run_dir;
        std::string run_id;
        std::shared_ptr<RunLog> log;
        std::uint64_t count = 0;
        std::uint64_t shown = 0;
        std::string task;
        bool task_inherited = false;
        int steps = 0;
        std::optional<std::string> ended;
        bool step_limited = false;
        std::optional<std::string> ended_task;
        std::optional<std::string> start_override;
        bool end_logged = false;
        std::vector<std::pair<int, std::string>> rules_open;
        bool run_started = false;
        int step_calls = 0;
        std::deque<std::string> reply_order;
        std::map<std::string, Value> replies;
        std::optional<Value> rpc_id;
        Value trace;
        std::optional<std::uint64_t> call_action_seq;
    };
    std::unique_ptr<Session> session;

    State(VerbTable& v, ServerOptions o, LineWriter w)
        : verbs(v), options(std::move(o)), write(std::move(w)), skills(options.skills) {}

    Session& s() { return *session; }

    void notify(const Value& message) { write(json::dump(message)); }

    void send_notice(const Value& notice) {
        auto at = [](const std::string& level) {
            return std::find(kLogLevels.begin(), kLogLevels.end(), level) - kLogLevels.begin();
        };
        if (at(notice.find("level")->as_string()) >= at(*log_level)) {
            notify(object().set("jsonrpc", "2.0").set("method", "notifications/message").set("params", notice));
        }
    }

    std::uint64_t append(std::string_view kind, Value fields) { return append_to(s(), kind, std::move(fields)); }

    std::uint64_t append_to(Session& target, std::string_view kind, Value fields) {
        Value kept = fields;
        std::uint64_t seq = target.log->append(kind, std::move(fields));
        target.count = seq;
        std::string k(kind);
        note_shown(target, k, kept);
        if (k == "end") notify(object().set("jsonrpc", "2.0").set("method", "notifications/resources/list_changed"));
        auto level = kNoticeLevels.find(k);
        if (level != kNoticeLevels.end()) {
            Value data = object().set("kind", k).set("seq", number_of(seq));
            for (const auto& key : kDetailFields) {
                if (const Value* v = kept.find(key)) data.set(key, *v);
            }
            Value notice = object().set("level", level->second).set("logger", kServerName).set("data", std::move(data));
            if (log_level) send_notice(notice);
            else if (queued_notices.size() < kQueueMax) queued_notices.push_back(std::move(notice));
        }
        return seq;
    }

    static void note_shown(Session& target, const std::string& kind, const Value& event) {
        const Value* tool = event.find("tool");
        const Value* total = event.find("total");
        if (kind == "result" && tool && tool->as_string() == "next_context" && is_ok(event) && total && total->is_number()) {
            target.shown = static_cast<std::uint64_t>(total->as_number());
        }
    }

    std::vector<Value> events() {
        auto all = s().log->read_all();
        return all ? std::move(*all) : std::vector<Value>{};
    }

    Value served_tools() { return code_tools(verbs); }

    Value run_meta(const fs::path& dir, const std::string& task) {
        return object()
            .set("id", dir.filename().string())
            .set("mode", "mcp")
            .set("task", task)
            .set("witness", kDefaultWitness)
            .set("workspace", options.workspace.string())
            .set("maxSteps", options.max_steps)
            .set("maxInflight", options.max_inflight)
            .set("createdAt", iso_now());
    }

    deoxidene::Result<bool, std::string> open_run(Session& session_, const fs::path& dir, const std::string& task) {
        using Fail = deoxidene::Err<std::string>;
        fs::path file = dir / "log.jsonl";
        bool resumed = fs::exists(file);
        if (!resumed) {
            std::error_code ec;
            fs::create_directories(dir, ec);
            if (ec) return Fail{"cannot create " + dir.string() + ": " + ec.message()};
            if (!write_file(dir / "rules.md", kMcpRules)) return Fail{"cannot write " + (dir / "rules.md").string()};
            if (!write_file(dir / "task.json", pretty_flat(run_meta(dir, task)) + "\n")) {
                return Fail{"cannot write " + (dir / "task.json").string()};
            }
        }
        auto log = RunLog::open(dir);
        if (!log) return Fail{log.error()};
        session_.run_dir = dir;
        session_.run_id = dir.filename().string();
        session_.log = std::make_shared<RunLog>(std::move(*log));
        if (options.on_run_open) options.on_run_open(session_.log);
        if (resumed) {
            session_.count = session_.log->count();
            std::string before;
            bool had = read_file(dir / "rules.md", before);
            if (!had || before != kMcpRules) {
                write_file(dir / "rules.md", kMcpRules);
                append_to(session_, "rules-updated",
                          object()
                              .set("from", had ? Value(sha256_hex(before).substr(0, 12)) : Value(nullptr))
                              .set("to", sha256_hex(kMcpRules).substr(0, 12)));
            }
        }
        return resumed;
    }

    void log_tools() {
        Value served = served_tools();
        append("tools", object().set("sha", sha256_hex(json::dump(served))).set("count", number_of(served.as_array().size())));
    }

    deoxidene::Result<bool, std::string> boot() {
        using Fail = deoxidene::Err<std::string>;
        std::error_code ec;
        if (!fs::is_directory(options.workspace, ec)) return Fail{"workspace is not a directory: " + options.workspace.string()};
        fs::path dir = current_run_dir(options.run_dir ? *options.run_dir : options.runs / new_run_id());
        auto fresh = std::make_unique<Session>();
        fresh->task = trim(options.task);
        auto opened = open_run(*fresh, dir, fresh->task);
        if (!opened) return Fail{opened.error()};
        bool resumed = *opened;
        session = std::move(fresh);
        std::optional<std::string> closed_at_boot;
        if (resumed) {
            auto history = events();
            for (const Value& event : history) {
                std::string kind = event.find("kind") ? event.find("kind")->as_string() : "";
                note_shown(s(), kind, event);
                if (kind == "result" && event.find("tool") && event.find("tool")->as_string() == "next_context" && is_ok(event)) {
                    s().steps += 1;
                }
                if (kind == "end") closed_at_boot = event.find("status") ? event.find("status")->as_string() : "";
            }
            std::string logged_task;
            bool has_task_event = false;
            for (const Value& event : history) {
                if (event.find("kind") && event.find("kind")->as_string() == "task") {
                    logged_task = event.find("text") ? event.find("text")->as_string() : "";
                    has_task_event = true;
                }
            }
            if (closed_at_boot) {
                s().ended = closed_at_boot;
                s().end_logged = true;
                std::string closed_task = logged_task;
                if (!has_task_event) {
                    std::string meta;
                    if (read_file(dir / "task.json", meta)) {
                        if (auto parsed = json::parse(meta); parsed && parsed->find("task")) closed_task = parsed->find("task")->as_string();
                    }
                }
                if (!s().task.empty()) s().start_override = s().task;
                else s().task = closed_task;
            } else if (s().task.empty()) {
                s().task = logged_task;
            }
            s().run_started = s().steps > 0;
        }
        if (!closed_at_boot) {
            if (resumed) append("restart", object().set("reason", options.restart_reason));
            else append("start", object()
                                     .set("mode", "mcp")
                                     .set("maxSteps", options.max_steps)
                                     .set("maxInflight", options.max_inflight)
                                     .set("taskFrom", trim(options.task).empty() ? "session prompt" : "task file"));
            log_tools();
        }
        return true;
    }

    void reopen() {
        std::string task;
        std::string task_from;
        bool inherited = false;
        if (s().ended_task) {
            task = *s().ended_task;
            task_from = "session prompt";
        } else if (s().start_override) {
            task = *s().start_override;
            task_from = "task file";
        } else if (!s().task.empty()) {
            task = s().task;
            task_from = "closed run " + s().run_id;
            inherited = true;
        } else {
            task_from = "session prompt";
        }
        fs::path next_dir = s().run_dir.parent_path() / new_run_id();
        auto fresh = std::make_unique<Session>();
        auto opened = open_run(*fresh, next_dir, task);
        if (!opened) throw std::runtime_error(opened.error());
        set_successor(s().run_dir, next_dir);
        session = std::move(fresh);
        s().task = task;
        s().task_inherited = inherited;
        append("start", object()
                            .set("mode", "mcp")
                            .set("maxSteps", options.max_steps)
                            .set("maxInflight", options.max_inflight)
                            .set("taskFrom", task_from));
        if (!task.empty()) append("task", object().set("from", task_from).set("text", task));
        log_tools();
    }

    void note_rule(int rule, const std::string& evidence) {
        for (const auto& open : s().rules_open) {
            if (open.first == rule) return;
        }
        append("rules-notice", object().set("step", s().steps).set("rule", rule).set("evidence", evidence));
        s().rules_open.emplace_back(rule, evidence);
    }

    Value open_rule_numbers() {
        Value out = array();
        for (const auto& open : s().rules_open) out.push(open.first);
        return out;
    }

    void clear_rules() {
        if (s().rules_open.empty()) return;
        Value rules = open_rule_numbers();
        s().rules_open.clear();
        append("rules-cleared", object().set("step", s().steps).set("rules", std::move(rules)));
    }

    std::optional<std::string> rules_notice() {
        if (s().rules_open.empty()) return std::nullopt;
        std::string lines;
        for (const auto& [rule, evidence] : s().rules_open) {
            if (!lines.empty()) lines += "; ";
            lines += "rule " + std::to_string(rule) + " (" + kRuleText.at(rule) + "): " + evidence;
        }
        return "The rules check found: " + lines +
               ". Read the gm skill again with ReadMcpResourceTool (server gm, uri skill://gm/SKILL.md) and follow the "
               "rules it gives. That one read clears this notice. Do not repeat finished work.";
    }

    Value action_fields(const std::string& tool, const Value& args, bool with_rpc) {
        Value fields = object().set("step", s().steps).set("tool", tool).set("args", args);
        if (with_rpc && s().rpc_id) {
            fields.set("rpcId", *s().rpc_id);
            fields = merge(std::move(fields), s().trace);
        }
        return fields;
    }

    Value refuse(const std::string& tool, const Value& args, const std::string& reason, bool with_rpc = true) {
        std::uint64_t action = append("action", action_fields(tool, args, with_rpc));
        if (with_rpc && s().rpc_id) s().call_action_seq = action;
        std::string error = "refused: " + reason;
        append("refusal", object().set("step", s().steps).set("tool", tool).set("error", error).set("actionSeq", number_of(action)));
        return object().set("ok", false).set("refused", true).set("error", error).set("actionSeq", number_of(action));
    }

    template <typename Exec, typename Digest>
    Value act(const std::string& tool, const Value& args, Exec exec, Digest digest) {
        int step = s().steps;
        std::uint64_t action = append("action", action_fields(tool, args, true));
        if (s().rpc_id) s().call_action_seq = action;
        Value result;
        try {
            result = exec(action);
        } catch (const std::exception& err) {
            result = object().set("ok", false).set("error", err.what());
        }
        const Value* refused = result.find("refused");
        if (refused != nullptr && refused->as_bool()) {
            append("refusal", object()
                                  .set("step", step)
                                  .set("tool", tool)
                                  .set("error", *result.find("error"))
                                  .set("actionSeq", number_of(action)));
        } else {
            append("result", merge(object().set("step", step).set("tool", tool).set("actionSeq", number_of(action)), digest(result)));
        }
        return result;
    }

    std::string ended_reason(bool child) {
        if (s().step_limited) return step_limit_text();
        if (*s().ended == "closed") return "stdin closed before the call started";
        if (*s().ended == "restarting") return "the server is restarting; repeat the call";
        if (child) return "run " + s().run_id + " has ended; the session that opened it calls next_context to open the next run";
        return "run " + s().run_id + " has ended; call next_context to open a new run";
    }

    std::string step_limit_text() {
        return "step limit " + std::to_string(options.max_steps) + " reached; a restart of the server opens a new run";
    }

    std::string read_rules() {
        std::string rules;
        read_file(s().run_dir / "rules.md", rules);
        return rules;
    }

    Value task_value() { return s().task.empty() ? Value(nullptr) : Value(s().task); }

    void end_run(const std::string& status, const Value& witness, const std::optional<Value>& gaps) {
        s().end_logged = true;
        Value fields = object().set("status", status).set("steps", s().steps).set("witness", witness);
        if (gaps) fields.set("gaps", *gaps);
        append("end", std::move(fields));
        std::error_code ec;
        fs::remove_all(s().run_dir / "code", ec);
    }

    Value child_context(const Value& args) {
        if (!s().run_started) {
            return refuse("child_context", args,
                          "no step has started on this connection; the session that owns the run calls next_context first");
        }
        const Value* run = args.find("run");
        if (run != nullptr && !(run->is_string() && run->as_string() == s().run_id)) {
            return refuse("child_context", args, "this connection's run is " + s().run_id + ", not " + text_or_undefined(run));
        }
        return act(
            "child_context", args,
            [&](std::uint64_t) {
                std::string rules = read_rules();
                return object()
                    .set("ok", true)
                    .set("role", "child")
                    .set("run", s().run_id)
                    .set("note", "child of run " + s().run_id + ": the session that opened the run ends it, so a child does not send finish")
                    .set("stepsLeft", options.max_steps - s().steps)
                    .set("maxSteps", options.max_steps)
                    .set("rules", rules)
                    .set("task", task_value())
                    .set("prefixSha", prefix_sha(rules, s().task, served_tools()))
                    .set("total", number_of(s().count));
            },
            [](const Value& r) {
                Value d = object();
                for (const char* key : {"ok", "error", "role", "run"}) {
                    if (const Value* v = r.find(key)) d.set(key, *v);
                }
                return d;
            });
    }

    Value feed(std::uint64_t shown, std::uint64_t total, const std::vector<Value>& all) {
        Value items = array();
        std::size_t used = 0;
        std::size_t room = kEventsCap - 2;
        std::uint64_t full = 0;
        std::uint64_t first_compact = 0;
        for (const Value& event : all) {
            std::uint64_t seq = static_cast<std::uint64_t>(event.find("seq") ? event.find("seq")->as_number() : 0);
            if (seq <= shown || seq > total) continue;
            if (first_compact != 0) continue;
            std::size_t cost = js_length(json::dump(event)) + 1;
            if (used + cost <= room) {
                used += cost;
                items.push(event);
                full += 1;
            } else {
                first_compact = seq;
            }
        }
        if (first_compact != 0) {
            Value seqs = array();
            seqs.push(number_of(first_compact));
            seqs.push(number_of(total));
            items.push(object().set("kind", "range").set("seqs", std::move(seqs)).set("count", number_of(total - first_compact + 1)));
        }
        return object()
            .set("older", number_of(shown))
            .set("records", number_of(items.as_array().size()))
            .set("fullEvents", number_of(full))
            .set("compactFrom", first_compact == 0 ? Value(nullptr) : number_of(first_compact))
            .set("events", std::move(items));
    }

    Value next_context(const Value& args) {
        if (s().steps >= options.max_steps) {
            s().step_limited = true;
            s().ended = "max_steps";
            Value out = refuse("next_context", object(), step_limit_text());
            end_run("max_steps", Value(nullptr), std::nullopt);
            return out;
        }
        s().steps += 1;
        s().run_started = true;
        s().step_calls = 0;
        int step = s().steps;
        (void)args;
        return act(
            "next_context", object(),
            [&](std::uint64_t) {
                std::string rules = read_rules();
                std::uint64_t total = s().count;
                std::uint64_t shown = std::min(s().shown, total);
                auto fresh = s().log->read_from(shown);
                std::vector<Value> all = fresh ? std::move(*fresh) : std::vector<Value>{};
                Value reply = object()
                                  .set("ok", true)
                                  .set("step", step)
                                  .set("run", s().run_id)
                                  .set("stepsLeft", options.max_steps - step)
                                  .set("maxSteps", options.max_steps)
                                  .set("rules", rules)
                                  .set("task", task_value());
                if (s().task.empty()) {
                    reply.set("taskNotice", "No task yet. The gm skill prompt, with its task argument, gives the task of this run.");
                }
                reply.set("witness", kDefaultWitness)
                    .set("prefixSha", prefix_sha(rules, s().task, served_tools()))
                    .set("total", number_of(total));
                reply = merge(std::move(reply), feed(shown, total, all));
                reply.set("query", query_hint(shown, total));
                if (auto notice = rules_notice()) reply.set("rulesPending", *notice);
                return reply;
            },
            [](const Value& r) {
                Value d = object();
                for (const char* key : {"ok", "error", "prefixSha", "total"}) {
                    if (const Value* v = r.find(key)) d.set(key, *v);
                }
                return d;
            });
    }

    Value finish(const Value& args) {
        const Value* witness = args.find("witness");
        if (witness == nullptr || !witness->is_string() || trim(witness->as_string()).empty()) {
            return refuse("finish", args, "finish needs a non-empty witness string", false);
        }
        const Value* gaps = args.find("gaps");
        if (gaps != nullptr) {
            bool bad = !gaps->is_array();
            for (const Value& gap : gaps->as_array()) bad = bad || !gap.is_string() || trim(gap.as_string()).empty();
            if (bad) return refuse("finish", args, "gaps must be an array of non-empty strings", false);
        }
        s().ended = "finished";
        Value out = act(
            "finish", args,
            [&](std::uint64_t) { return object().set("ok", true).set("finished", true).set("output", *witness); },
            [](const Value& r) { return r; });
        end_run("finished", *out.find("output"), gaps ? std::optional<Value>(*gaps) : std::nullopt);
        return out;
    }

    Value run_code(const Value& args);

    Value invoke(const std::string& name, const Value& args) {
        bool child = name == "next_context" && args.find("child") && args.find("child")->is_bool() && args.find("child")->as_bool();
        if (s().ended) return refuse(name, args, ended_reason(child));
        if (name == "run_code") return run_code(args);
        if (name == "next_context") return child ? child_context(args) : next_context(args);
        return finish(args);
    }

    void watch_call(const std::string& name, const Value& out) {
        if (name == "next_context") return;
        if (name == "finish") {
            const Value* refused = out.find("refused");
            std::string error = out.find("error") ? text_or_undefined(out.find("error")) : "undefined";
            if (refused && refused->as_bool() && error.find("needs a non-empty witness") != std::string::npos) {
                note_rule(4, "finish was refused: " + error);
            } else if (is_ok(out) && s().step_calls == 0) {
                note_rule(3, "finish was called with no call in its step");
            }
            return;
        }
        s().step_calls += 1;
    }

    Value tool_result(const Value& out, std::optional<std::uint64_t> seq) {
        Value content = array();
        content.push(object().set("type", "text").set("text", json::dump(out)));
        Value meta = object().set(kRunMeta, s().run_id);
        if (seq) meta.set(kRunSeq, number_of(*seq));
        return object()
            .set("content", std::move(content))
            .set("structuredContent", out)
            .set("isError", !is_ok(out))
            .set("_meta", std::move(meta));
    }

    Value call_tool(const Value* params, const Value& rpc_id) {
        const Value* name_value = params ? params->find("name") : nullptr;
        const Value* args_value = params ? params->find("arguments") : nullptr;
        if (name_value == nullptr || !name_value->is_string()) throw RpcError(-32602, "tools/call needs a string name");
        Value args = args_value == nullptr ? object() : *args_value;
        if (!args.is_object()) throw RpcError(-32602, "tools/call arguments must be an object");
        std::string name = name_value->as_string();
        if (name != "next_context" && name != "run_code" && name != "finish") {
            throw RpcError(-32602, "Unknown tool: " + name +
                                       "; the code surface serves next_context, run_code and finish; call a verb as gm.<name>(args) inside run_code");
        }
        if (!s().run_started && !s().ended && name != "next_context" && name != "finish") {
            note_rule(2, name + " was called before the first next_context of the run");
        }
        s().rpc_id = rpc_id;
        s().trace = trace_of(params->find("_meta"));
        s().call_action_seq.reset();
        Value out = invoke(name, args);
        auto seq = s().call_action_seq;
        s().rpc_id.reset();
        watch_call(name, out);
        if (auto notice = rules_notice()) out.set("rulesNotice", *notice);
        return tool_result(out, seq);
    }

    void remember(const std::string& key, const Value& result) {
        if (!s().replies.contains(key)) s().reply_order.push_back(key);
        s().replies[key] = result;
        if (s().reply_order.size() > kReplyMemory) {
            s().replies.erase(s().reply_order.front());
            s().reply_order.pop_front();
        }
    }

    std::optional<std::pair<const Skill*, const SkillFile*>> skill_file_of(const std::string& uri) {
        static const std::regex kSkillUri(R"(^skill://([^/]+)/)");
        std::smatch match;
        if (!std::regex_search(uri, match, kSkillUri)) return std::nullopt;
        const auto& served = served_skills();
        if (std::find(served.begin(), served.end(), match[1].str()) == served.end()) return std::nullopt;
        const Skill& skill = skills.get(match[1].str());
        for (const SkillFile& file : skill.files) {
            if (file.uri == uri) return std::pair{&skill, &file};
        }
        return std::nullopt;
    }

    Value skill_entry(const Skill& skill) {
        Value resources = array();
        for (const SkillFile& file : skill.files) {
            resources.push(object().set("uri", file.uri).set("digest", file.digest).set("size", number_of(file.size)));
        }
        return object().set("uri", skill.uri).set("frontmatter", skill.frontmatter).set("resources", std::move(resources));
    }

    Value resource_of(const Skill& skill, const SkillFile& file) {
        bool is_md = file.path == "SKILL.md";
        Value annotations = object()
                                .set("audience", string_array({"assistant"}))
                                .set("priority", is_md ? 1.0 : 0.5)
                                .set("lastModified", file.last_modified);
        if (!is_md) {
            return object().set("uri", file.uri).set("name", file.path).set("mimeType", file.mime_type).set("annotations", std::move(annotations));
        }
        return object()
            .set("uri", file.uri)
            .set("name", *skill.frontmatter.find("name"))
            .set("description", *skill.frontmatter.find("description"))
            .set("mimeType", file.mime_type)
            .set("annotations", std::move(annotations));
    }

    std::optional<std::string> witness_of(const std::string& run_id) {
        fs::path file = s().run_dir.parent_path() / run_id / "log.jsonl";
        if (!fs::exists(file)) return std::nullopt;
        std::string text;
        read_file(file, text);
        std::optional<std::string> witness;
        for (const auto& line : split_lines(text)) {
            if (trim(line).empty()) continue;
            auto event = json::parse(line);
            if (!event) continue;
            const Value* kind = event->find("kind");
            if (kind && kind->as_string() == "end") {
                const Value* w = event->find("witness");
                witness = w && w->is_string() ? std::optional<std::string>(w->as_string()) : std::nullopt;
            }
        }
        return witness;
    }

    std::string mtime_of(const fs::path& file) {
        std::error_code ec;
        auto when = fs::last_write_time(file, ec);
        return ec ? std::string() : iso_time(when);
    }

    Value resources_list() {
        Value out = array();
        for (const auto& name : served_skills()) {
            const Skill& skill = skills.get(name);
            for (const SkillFile& file : skill.files) out.push(resource_of(skill, file));
        }
        std::string id = s().run_id;
        std::string modified = mtime_of(s().run_dir / "log.jsonl");
        Value log_annotations = object().set("audience", string_array({"assistant"})).set("priority", 0.5);
        if (!modified.empty()) log_annotations.set("lastModified", modified);
        out.push(object()
                     .set("uri", "run://" + id + "/log")
                     .set("name", id + " log")
                     .set("title", "Run event log")
                     .set("mimeType", "application/x-ndjson")
                     .set("annotations", std::move(log_annotations)));
        if (witness_of(id)) {
            Value annotations = object().set("audience", string_array({"user", "assistant"})).set("priority", 0.8);
            if (!modified.empty()) annotations.set("lastModified", modified);
            out.push(object()
                         .set("uri", "run://" + id + "/witness")
                         .set("name", id + " witness")
                         .set("title", "Run witness")
                         .set("mimeType", "text/plain")
                         .set("annotations", std::move(annotations)));
        }
        return object().set("resources", std::move(out));
    }

    std::optional<Value> read_run(const std::string& uri) {
        static const std::regex kRunUri(R"(^run://([A-Za-z0-9][A-Za-z0-9_-]*)/(log|witness)$)");
        std::smatch match;
        if (!std::regex_match(uri, match, kRunUri)) return std::nullopt;
        fs::path file = s().run_dir.parent_path() / match[1].str() / "log.jsonl";
        if (!fs::exists(file)) return std::nullopt;
        if (match[2].str() == "witness") {
            auto witness = witness_of(match[1].str());
            if (!witness) return std::nullopt;
            return object().set("uri", uri).set("mimeType", "text/plain").set("text", *witness);
        }
        std::string text;
        read_file(file, text);
        std::size_t size = text.size();
        std::size_t at = size > kLogTailBytes ? size - kLogTailBytes : 0;
        std::size_t start = at;
        if (at > 0) {
            std::size_t nl = text.find('\n', at);
            start = nl == std::string::npos ? size : nl + 1;
        }
        Value meta = object().set(kLogMeta, object()
                                                .set("totalBytes", number_of(size))
                                                .set("fromByte", number_of(start))
                                                .set("truncated", start > 0));
        return object().set("uri", uri).set("mimeType", "application/x-ndjson").set("text", text.substr(start)).set("_meta", std::move(meta));
    }

    std::optional<Value> serve_skill_file(const std::string& uri, const std::string& via) {
        auto found = skill_file_of(uri);
        if (!found) return std::nullopt;
        auto [skill, file] = *found;
        bool is_gm = file->uri == kGmSkillUri;
        append("skill-loaded", object()
                                   .set("via", via)
                                   .set("skill", skill->name)
                                   .set("uri", file->uri)
                                   .set("cleared", is_gm ? open_rule_numbers() : array()));
        if (is_gm) clear_rules();
        return object().set("uri", file->uri).set("mimeType", file->mime_type).set("text", file->bytes);
    }

    Value read_resource(const Value* params) {
        const Value* uri_value = params ? params->find("uri") : nullptr;
        std::string uri = uri_value && uri_value->is_string() ? uri_value->as_string() : "";
        if (uri_value && uri_value->is_string()) {
            if (auto run = read_run(uri)) {
                Value contents = array();
                contents.push(*run);
                return object().set("contents", std::move(contents));
            }
            if (auto served = serve_skill_file(uri, "resource")) {
                Value contents = array();
                contents.push(*served);
                return object().set("contents", std::move(contents));
            }
        }
        Value data = object();
        if (uri_value) data.set("uri", *uri_value);
        throw RpcError(-32002, "resource not found: " + text_or_undefined(uri_value), data);
    }

    Value skill_prompt(const std::string& name) {
        const Skill& skill = skills.get(name);
        Value prompt = object()
                           .set("name", name)
                           .set("title", name == "gm" ? "gm run" : "gm continue")
                           .set("description", *skill.frontmatter.find("description"));
        if (name == "gm") {
            Value argument = object()
                                 .set("name", "task")
                                 .set("description", "The task to run. The whole task text is this one argument. Some hosts pass only its first word.")
                                 .set("required", false);
            Value arguments = array();
            arguments.push(std::move(argument));
            prompt.set("arguments", std::move(arguments));
        }
        return prompt;
    }

    Value prompt_result(const Skill& skill, const std::string& text) {
        Value messages = array();
        messages.push(object().set("role", "user").set("content", object().set("type", "text").set("text", text)));
        return object().set("description", *skill.frontmatter.find("description")).set("messages", std::move(messages));
    }

    Value get_prompt(const Value* params) {
        const Value* name_value = params ? params->find("name") : nullptr;
        std::string name = name_value && name_value->is_string() ? name_value->as_string() : "";
        const auto& served = served_skills();
        if (!name_value || !name_value->is_string() || std::find(served.begin(), served.end(), name) == served.end()) {
            throw RpcError(-32602, "unknown prompt: " + text_or_undefined(name_value));
        }
        if (name != "gm") {
            const Skill& other = skills.get(name);
            append("skill-loaded", object().set("via", "prompt").set("skill", name).set("cleared", array()));
            return prompt_result(other, other.body);
        }
        const Skill& skill = skills.get("gm");
        append("skill-loaded", object().set("via", "prompt").set("skill", "gm").set("cleared", open_rule_numbers()));
        clear_rules();
        const Value* arguments = params->find("arguments");
        const Value* task = arguments ? arguments->find("task") : nullptr;
        std::string given = task && task->is_string() ? trim(task->as_string()) : "";
        if (!given.empty() && s().ended) {
            s().ended_task = given;
        } else if (!given.empty() && (s().task.empty() || s().task_inherited)) {
            s().task = given;
            s().task_inherited = false;
            append("task", object().set("from", "session prompt").set("text", given));
        }
        return prompt_result(skill, given.empty() ? skill.body : skill.body + "\n\nTask: " + given);
    }

    Value skills_get(const Value* params) {
        static const std::regex kSkillMd(R"(^skill://([^/]+)/SKILL\.md$)");
        const Value* uri_value = params ? params->find("uri") : nullptr;
        std::smatch match;
        std::string uri = uri_value && uri_value->is_string() ? uri_value->as_string() : "";
        const auto& served = served_skills();
        if (!uri_value || !uri_value->is_string() || !std::regex_match(uri, match, kSkillMd) ||
            std::find(served.begin(), served.end(), match[1].str()) == served.end()) {
            throw RpcError(-32602, "unknown skill: " + text_or_undefined(uri_value));
        }
        return object().set("resultType", "complete").set("skill", skill_entry(skills.get(match[1].str())));
    }

    std::vector<std::string> run_ids() {
        std::vector<std::string> ids;
        static const std::regex kRunId(R"(^[A-Za-z0-9][A-Za-z0-9_-]*$)");
        std::error_code ec;
        fs::path root = s().run_dir.parent_path();
        for (const auto& entry : fs::directory_iterator(root, ec)) {
            std::string name = entry.path().filename().string();
            if (entry.is_directory() && std::regex_match(name, kRunId) && fs::exists(entry.path() / "log.jsonl")) ids.push_back(name);
        }
        std::sort(ids.rbegin(), ids.rend());
        return ids;
    }

    Value completion(const Value* params) {
        const Value* ref = params ? params->find("ref") : nullptr;
        const Value* argument = params ? params->find("argument") : nullptr;
        const Value* context = params ? params->find("context") : nullptr;
        std::string uri = ref && ref->find("uri") ? ref->find("uri")->as_string() : "";
        std::string arg_name = argument && argument->find("name") ? argument->find("name")->as_string() : "";
        const Value* value = argument ? argument->find("value") : nullptr;
        std::string prefix = value == nullptr || value->is_null() ? "" : text_or_undefined(value);
        std::vector<std::string> candidates;
        const auto& served = served_skills();
        if (uri == "skill://{name}/SKILL.md" || uri == "skill://{name}/{path}") {
            if (arg_name == "name") candidates = served;
            else if (arg_name == "path") {
                const Value* args = context ? context->find("arguments") : nullptr;
                const Value* skill_name = args ? args->find("name") : nullptr;
                if (skill_name && skill_name->is_string() &&
                    std::find(served.begin(), served.end(), skill_name->as_string()) != served.end()) {
                    for (const SkillFile& file : skills.get(skill_name->as_string()).files) candidates.push_back(file.path);
                }
            }
        } else if ((uri == "run://{run}/log" || uri == "run://{run}/witness") && arg_name == "run") {
            candidates = run_ids();
        }
        std::vector<std::string> matching;
        for (const auto& c : candidates) {
            if (c.starts_with(prefix)) matching.push_back(c);
        }
        Value values = array();
        for (std::size_t i = 0; i < std::min(matching.size(), kCompletionCap); ++i) values.push(matching[i]);
        return object().set("completion", object()
                                              .set("values", std::move(values))
                                              .set("total", number_of(matching.size()))
                                              .set("hasMore", matching.size() > kCompletionCap));
    }

    Value resource_templates() {
        Value list = array();
        list.push(object()
                      .set("uriTemplate", "skill://{name}/SKILL.md")
                      .set("name", "skill-md")
                      .set("title", "Served skill")
                      .set("description", "The SKILL.md of a served skill: its frontmatter and its prompt text.")
                      .set("mimeType", "text/markdown"));
        list.push(object()
                      .set("uriTemplate", "skill://{name}/{path}")
                      .set("name", "skill-file")
                      .set("title", "Served skill file")
                      .set("description", "Any other file of a served skill, by its path under the skill directory."));
        list.push(object()
                      .set("uriTemplate", "run://{run}/log")
                      .set("name", "run-log")
                      .set("title", "Run event log")
                      .set("description", "A run's event log, one JSON event per line: its newest 64 KB, cut at a line boundary.")
                      .set("mimeType", "application/x-ndjson"));
        list.push(object()
                      .set("uriTemplate", "run://{run}/witness")
                      .set("name", "run-witness")
                      .set("title", "Run witness")
                      .set("description", "The witness a run finished with. It is listed once the run has ended.")
                      .set("mimeType", "text/plain"));
        return object().set("resourceTemplates", std::move(list));
    }

    std::optional<std::string> digest_of(const std::string& uri) {
        try {
            auto found = skill_file_of(uri);
            if (!found) return std::nullopt;
            return found->second->digest;
        } catch (const std::exception&) {
            return std::nullopt;
        }
    }

    void check_subscriptions() {
        for (auto& [uri, seen] : subscriptions) {
            std::string now = digest_of(uri).value_or("");
            if (now == seen) continue;
            seen = now;
            notify(object()
                       .set("jsonrpc", "2.0")
                       .set("method", "notifications/resources/updated")
                       .set("params", object().set("uri", uri)));
        }
    }

    Value initialize(const Value* params) {
        const Value* asked = params ? params->find("protocolVersion") : nullptr;
        std::string version = kSupportedVersions.front();
        if (asked && asked->is_string() &&
            std::find(kSupportedVersions.begin(), kSupportedVersions.end(), asked->as_string()) != kSupportedVersions.end()) {
            version = asked->as_string();
        }
        Value capabilities = object()
                                 .set("tools", object().set("listChanged", true))
                                 .set("prompts", object().set("listChanged", true))
                                 .set("resources", object().set("listChanged", true).set("subscribe", true))
                                 .set("logging", object())
                                 .set("completions", object())
                                 .set("extensions", object().set("io.modelcontextprotocol/skills", object()));
        return object()
            .set("protocolVersion", version)
            .set("capabilities", std::move(capabilities))
            .set("instructions", kCodeInstructions + "\n\n" + kResourcesPointer + "\n\n" + kSkillPointer)
            .set("serverInfo", object().set("name", kServerName).set("title", kServerTitle).set("version", options.version));
    }

    std::optional<Value> route(const std::string& method, const Value* params, const Value& rpc_id) {
        if (method == "initialize") return initialize(params);
        if (method == "ping") return object();
        if (method == "tools/list") return object().set("tools", served_tools());
        if (method == "tools/call") return call_tool(params, rpc_id);
        if (method == "prompts/list") {
            Value prompts = array();
            for (const auto& name : served_skills()) prompts.push(skill_prompt(name));
            return object().set("prompts", std::move(prompts));
        }
        if (method == "prompts/get") return get_prompt(params);
        if (method == "resources/list") return resources_list();
        if (method == "resources/read") return read_resource(params);
        if (method == "skills/list") {
            Value list = array();
            for (const auto& name : served_skills()) list.push(skill_entry(skills.get(name)));
            return object().set("resultType", "complete").set("skills", std::move(list));
        }
        if (method == "skills/get") return skills_get(params);
        if (method == "resources/templates/list") return resource_templates();
        if (method == "resources/subscribe") {
            const Value* uri = params ? params->find("uri") : nullptr;
            auto digest = uri && uri->is_string() ? digest_of(uri->as_string()) : std::nullopt;
            if (!digest) {
                Value data = object();
                if (uri) data.set("uri", *uri);
                throw RpcError(-32002, "resource not found: " + text_or_undefined(uri), data);
            }
            subscriptions[uri->as_string()] = *digest;
            return object();
        }
        if (method == "resources/unsubscribe") {
            const Value* uri = params ? params->find("uri") : nullptr;
            if (uri && uri->is_string()) subscriptions.erase(uri->as_string());
            return object();
        }
        if (method == "completion/complete") return completion(params);
        if (method == "logging/setLevel") {
            const Value* level = params ? params->find("level") : nullptr;
            if (!level || !level->is_string() ||
                std::find(kLogLevels.begin(), kLogLevels.end(), level->as_string()) == kLogLevels.end()) {
                throw RpcError(-32602, "unknown log level: " + text_or_undefined(level));
            }
            log_level = level->as_string();
            auto queued = std::move(queued_notices);
            queued_notices.clear();
            for (const Value& notice : queued) send_notice(notice);
            return object();
        }
        if (method == "notifications/cancelled") {
            const Value* request = params ? params->find("requestId") : nullptr;
            Value fields = object();
            if (request) fields.set("requestId", *request);
            fields.set("reason", "no call in flight with that id");
            append("cancel-ignored", std::move(fields));
            return std::nullopt;
        }
        if (method.starts_with("notifications/")) return std::nullopt;
        throw RpcError(-32601, "method not found: " + method);
    }

    Value error_reply(const Value& id, int code, const std::string& message, const std::optional<Value>& data = std::nullopt) {
        Value error = object().set("code", code).set("message", message);
        if (data) error.set("data", *data);
        return object().set("jsonrpc", "2.0").set("id", id).set("error", std::move(error));
    }

    std::optional<Value> handle_line(std::string_view line) {
        auto parsed = json::parse(line);
        if (!parsed) {
            append("parse_error", object().set("error", parsed.error()));
            return error_reply(Value(nullptr), -32700, "Parse error");
        }
        Value message = std::move(*parsed);
        const Value* method_value = message.find("method");
        if (!message.is_object() || method_value == nullptr || !method_value->is_string()) {
            append("error", object().set("code", -32600).set("message", "Invalid Request"));
            return error_reply(Value(nullptr), -32600, "Invalid Request");
        }
        std::string method = method_value->as_string();
        const Value* id = message.find("id");
        bool request = id != nullptr;
        Value rpc_id = request ? *id : Value(nullptr);
        const Value* params = message.find("params");
        std::optional<std::string> key;
        if (request && method == "tools/call") key = id_key(id);
        try {
            if (key && s().replies.contains(*key)) {
                const Value* name = params ? params->find("name") : nullptr;
                Value fields = object().set("rpcId", rpc_id);
                if (name) fields.set("tool", *name);
                append("duplicate", std::move(fields));
                return object().set("jsonrpc", "2.0").set("id", rpc_id).set("result", s().replies[*key]);
            }
            auto result = route(method, params, rpc_id);
            if (key && result) remember(*key, *result);
            if (!request) return std::nullopt;
            return object().set("jsonrpc", "2.0").set("id", rpc_id).set("result", result ? *result : object());
        } catch (const RpcError& err) {
            if (!request) return std::nullopt;
            append("error", object().set("method", method).set("code", err.code).set("message", err.what()));
            return error_reply(rpc_id, err.code, err.what(), err.data);
        } catch (const std::exception& err) {
            if (!request) return std::nullopt;
            append("error", object().set("method", method).set("code", -32603).set("message", err.what()));
            return error_reply(rpc_id, -32603, err.what());
        }
    }

    bool is_next_context_call(std::string_view line) {
        auto parsed = json::parse(line);
        if (!parsed) return false;
        const Value* method = parsed->find("method");
        const Value* params = parsed->find("params");
        if (!method || method->as_string() != "tools/call" || !params) return false;
        const Value* name = params->find("name");
        const Value* args = params->find("arguments");
        const Value* child = args ? args->find("child") : nullptr;
        return name && name->as_string() == "next_context" && !(child && child->is_bool() && child->as_bool());
    }

    void accept(std::string_view line) {
        if (trim(line).empty()) return;
        try {
            if (s().ended && !s().step_limited && is_next_context_call(line)) {
                reopen();
                notify(object().set("jsonrpc", "2.0").set("method", "notifications/resources/list_changed"));
            }
            auto reply = handle_line(line);
            if (reply) write(json::dump(*reply));
        } catch (const std::exception& err) {
            auto parsed = json::parse(line);
            if (parsed && parsed->find("id")) write(json::dump(error_reply(*parsed->find("id"), -32603, err.what())));
        }
        check_subscriptions();
    }

    void input_ended() {
        if (s().end_logged) return;
        if (options.supervised) {
            s().ended = "restarting";
            append("paused", object().set("reason", "the supervisor ended stdin"));
            return;
        }
        if (!s().ended) s().ended = "closed";
        end_run(*s().ended, Value(nullptr), std::nullopt);
    }
};

namespace {

class LoggedVerbs : public VerbTable {
public:
    LoggedVerbs(Server::State& state, std::uint64_t body) : state_(state), body_(body) {}

    std::vector<VerbInfo> list() const override { return state_.verbs.list(); }

    json::Value call(std::string_view name_view, const json::Value& args) override {
        std::string name(name_view);
        std::optional<std::uint64_t> action;
        if (!kReadOnlyTools.contains(name)) {
            action = state_.append("action", object()
                                                 .set("step", state_.s().steps)
                                                 .set("tool", name)
                                                 .set("args", args)
                                                 .set("body", number_of(body_)));
        }
        Value result;
        try {
            result = state_.verbs.call(name, args);
        } catch (const std::exception& err) {
            result = object().set("ok", false).set("error", err.what());
        }
        Value shown = logged_for(name, result);
        Value fields = object().set("step", state_.s().steps).set("tool", name).set("ok", is_ok(shown)).set("args", args);
        for (const char* key : {"exitCode", "signal", "output", "outputChars", "outputDigest", "error"}) {
            if (const Value* v = shown.find(key)) fields.set(key, *v);
        }
        fields.set("body", number_of(body_));
        if (action) fields.set("actionSeq", number_of(*action));
        state_.append("code-call", std::move(fields));
        return result;
    }

private:
    Server::State& state_;
    std::uint64_t body_;
};

}  // namespace

Value Server::State::run_code(const Value& args) {
    static const std::vector<std::string> kProperties = {"body", "timeoutMs", "format"};
    std::string unknown;
    for (const json::Member& m : args.as_object()) {
        if (std::find(kProperties.begin(), kProperties.end(), m.first) == kProperties.end()) {
            unknown += unknown.empty() ? m.first : ", " + m.first;
        }
    }
    if (!unknown.empty()) return refuse("run_code", args, "unknown argument " + unknown + "; run_code takes body, timeoutMs, format");
    return act(
        "run_code", args,
        [&](std::uint64_t action) {
            auto with_seq = [&](Value reply) { return reply.set("actionSeq", number_of(action)); };
            const Value* body = args.find("body");
            if (body == nullptr || !body->is_string() || trim(body->as_string()).empty()) {
                return with_seq(object().set("ok", false).set("error", "body must be a non-empty string"));
            }
            const Value* timeout = args.find("timeoutMs");
            if (timeout != nullptr) {
                double ms = timeout->as_number(-1);
                if (!timeout->is_number() || ms != static_cast<double>(static_cast<long long>(ms)) || ms < 1 || ms > kMaxTimeoutMs) {
                    return with_seq(object().set("ok", false).set("error", "timeoutMs must be an integer from 1 to " + std::to_string(kMaxTimeoutMs)));
                }
            }
            const Value* format = args.find("format");
            if (format != nullptr && !(format->is_string() && (format->as_string() == "esm" || format->as_string() == "cjs"))) {
                return with_seq(object().set("ok", false).set("error", "format must be esm or cjs"));
            }
            if (!options.run_body) return with_seq(object().set("ok", false).set("error", "no body runner is configured"));
            LoggedVerbs logged(*this, action);
            auto outcome = options.run_body(logged, body->as_string(), options.workspace);
            if (!outcome) return with_seq(object().set("ok", false).set("error", outcome.error()).set("loads", array()));
            std::string text = json::dump(*outcome);
            std::size_t length = js_length(text);
            return with_seq(object()
                                .set("ok", true)
                                .set("output", length > kOutputCap ? js_prefix(text, kOutputCap) : text)
                                .set("truncated", length > kOutputCap)
                                .set("loads", array()));
        },
        [](const Value& r) { return logged_for("run_code", r); });
}

Server::Server(std::unique_ptr<State> state) : state_(std::move(state)) {}
Server::~Server() = default;

deoxidene::Result<std::unique_ptr<Server>, std::string> Server::open(VerbTable& verbs, ServerOptions options, LineWriter write) {
    auto state = std::make_unique<State>(verbs, std::move(options), std::move(write));
    auto booted = state->boot();
    if (!booted) return deoxidene::Err<std::string>{booted.error()};
    return std::unique_ptr<Server>(new Server(std::move(state)));
}

void Server::accept(std::string_view line) { state_->accept(line); }
void Server::input_ended() { state_->input_ended(); }
std::string Server::run_id() const { return state_->session->run_id; }
std::filesystem::path Server::run_dir() const { return state_->session->run_dir; }

int serve_stream(std::istream& in, std::ostream& out, VerbTable& verbs, ServerOptions options) {
    auto server = Server::open(verbs, std::move(options), [&out](std::string_view line) {
        out << line << '\n';
        out.flush();
    });
    if (!server) {
        std::cerr << "gm mcp: " << server.error() << '\n';
        return 1;
    }
    std::string line;
    while (std::getline(in, line)) {
        if (!line.empty() && line.back() == '\r') line.pop_back();
        (*server)->accept(line);
    }
    (*server)->input_ended();
    return 0;
}

}  // namespace gmnew::mcp
