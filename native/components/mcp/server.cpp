#include <algorithm>
#include <atomic>
#include <condition_variable>
#include <deque>
#include <mutex>
#include <thread>
#include <iostream>
#include <random>
#include <regex>
#include <set>
#include <shared_mutex>

#include "gmnew/log.hpp"
#include "gmnew/mcp.hpp"
#include "gmnew/proc.hpp"
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
constexpr std::size_t kOutputCap = 20000;
constexpr std::size_t kOutputPage = 20000;
constexpr std::size_t kTailCap = 2000;
constexpr std::size_t kLoggedReplyChars = 1000;
constexpr std::size_t kLogTailBytes = 65536;
constexpr std::size_t kOpenList = 20;
constexpr std::size_t kNoticePrdWindow = 5;
constexpr std::size_t kRowsNamed = 5;
constexpr double kDefaultBodyTimeoutMs = 180000;
constexpr double kMaxWaitMs = 300000;
constexpr double kMaxJobWaitMs = 30000;
constexpr long long kStartedJobGraceMs = 100;
constexpr std::size_t kCompletionCap = 100;
constexpr std::size_t kQueueMax = 64;
constexpr int kMaxTimeoutMs = 300000;
constexpr double kListTtlMs = 3600000;
constexpr double kVolatileTtlMs = 0;
constexpr const char* kCachePublic = "public";

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
    "rows. A gap that names an open row is refused too.";

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

Value tool_annotations(const std::string& name) {
    if (name == "next_context") return object().set("readOnlyHint", true).set("destructiveHint", false).set("openWorldHint", false);
    if (name == "finish") return object().set("readOnlyHint", false).set("destructiveHint", false).set("openWorldHint", false);
    return object().set("readOnlyHint", false).set("destructiveHint", true).set("openWorldHint", true);
}

Value annotated(Value tool, Value output_schema) {
    std::string name = tool.find("name")->as_string();
    tool.set("title", title_of(name));
    tool.set("annotations", tool_annotations(name));
    tool.set("outputSchema", std::move(output_schema));
    return tool;
}

Value cacheable(Value result, double ttl_ms) {
    result.set("ttlMs", number(ttl_ms));
    result.set("cacheScope", kCachePublic);
    return result;
}

const std::vector<std::string>& node_verb_order() {
    static const std::vector<std::string> order = {
        "read_file",   "write_file",    "edit_file",   "stat_file",    "list_dir",       "run_shell",   "job_start",
        "job_status",  "job_stop",      "query_log",   "search",       "wiki_search",    "grep",        "wiki_write",
        "review_packet", "review_record", "review_join", "fetch",      "callers",        "impact",      "git_status",
        "git_add",     "git_rm",        "git_commit",  "git_push",     "git_log",        "git_diff",    "git_show",
        "git_fetch",   "git_pull",      "git_checkout", "git_branch",  "ci_status",      "prd_add",     "prd_list",
        "prd_resolve", "unknown_add",   "unknown_list", "unknown_resolve", "prd_delete"};
    return order;
}

const std::set<std::string> kInternalVerbs = {"wiki_lint"};

std::vector<VerbInfo> served_verbs(const VerbTable& verbs) {
    std::vector<VerbInfo> all = verbs.list();
    std::erase_if(all, [](const VerbInfo& verb) { return kInternalVerbs.contains(verb.name); });
    const auto& order = node_verb_order();
    auto rank = [&](const VerbInfo& verb) {
        auto at = std::find(order.begin(), order.end(), verb.name);
        return static_cast<std::size_t>(at - order.begin());
    };
    std::stable_sort(all.begin(), all.end(), [&](const VerbInfo& a, const VerbInfo& b) { return rank(a) < rank(b); });
    return all;
}

Value code_tools(const VerbTable& verbs) {
    std::string names;
    for (const VerbInfo& verb : served_verbs(verbs)) {
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
                                              .set("stopBackground", bool_schema()),
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

}

struct Server::State {
    VerbTable& verbs;
    ServerOptions options;
    LineWriter write;
    SkillCache skills;
    std::map<std::string, std::string> subscriptions;
    std::optional<std::string> log_level;
    std::vector<Value> queued_notices;
    std::string announced_tools;
    std::string announced_prompts;

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
        std::uint64_t notice_seq = 0;
        std::optional<Value> recovery;
        std::string rules_baseline;
    };
    std::unique_ptr<Session> session;
    std::vector<std::unique_ptr<Session>> retired;

    struct Gate {
        std::shared_mutex lock;
        bool alive = true;
    };

    struct BodyJob {
        std::uint64_t body = 0;
        int step = 0;
        Session* owner = nullptr;
        std::string name;
        double start_mono = 0;
        std::chrono::steady_clock::time_point start_wall = std::chrono::steady_clock::now();
        std::atomic<bool> stopped{false};
        std::atomic<bool> exited{false};
        std::atomic<int> in_flight{0};
        std::atomic<long long> last_call_ms{0};
        std::mutex lock;
        std::condition_variable changed;
        bool finished = false;
        bool adopted = false;
        bool settled = false;
        bool stuck = false;
        std::uint64_t reminders = 0;
        std::vector<std::string> started_jobs;
        std::optional<Value> value;
        std::string error;
        std::thread thread;
    };

    std::recursive_mutex mu;
    std::atomic<int> in_flight{0};
    std::uint64_t generation = 0;
    std::optional<std::string> fingerprint;
    std::shared_ptr<Gate> gate = std::make_shared<Gate>();
    std::vector<std::shared_ptr<BodyJob>> bodies;
    std::map<std::string, std::function<void()>> after_reply;
    std::thread monitor;
    bool monitor_running = false;
    std::mutex monitor_mutex;
    std::condition_variable monitor_wake;
    bool shutting_down = false;

    State(VerbTable& v, ServerOptions o, LineWriter w)
        : verbs(v), options(std::move(o)), write(std::move(w)), skills(options.skills) {}

    ~State();

    Session& s() { return *session; }

    void emit(const std::string& line) {
        std::lock_guard guard(mu);
        write(line);
    }

    void notify(const Value& message) { emit(json::dump(message)); }

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
        std::lock_guard guard(mu);
        if (fields.is_object() && fields.find("inFlight") == nullptr) fields.set("inFlight", in_flight.load());
        Value kept = fields;
        std::uint64_t seq = target.log->append(kind, std::move(fields));
        target.count = seq;
        std::string k(kind);
        note_shown(target, k, kept);
        if (is_pending_kind(k)) {
            auto written = target.log->read_from(seq - 1);
            if (written && !written->empty()) {
                try {
                    append_pending(target.run_dir, written->front());
                } catch (const std::exception& err) {
                    std::cerr << "gm mcp: " << err.what() << '\n';
                }
            }
        }
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
        session_.rules_baseline = kMcpRules;
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

    void log_tools(const std::vector<Value>& history = {}) {
        Value served = served_tools();
        std::string sha = sha256_hex(json::dump(served));
        const Value* last = nullptr;
        for (const Value& event : history) {
            if (string_of(event, "kind") == "tools") last = &event;
        }
        if (last && string_of(*last, "sha") != sha) {
            append("tools-changed", object().set("old", *last->find("sha")).set("new", sha));
        }
        append("tools", object().set("sha", sha).set("count", number_of(served.as_array().size())));
    }

    static std::string string_of(const Value& v, const char* key) {
        const Value* f = v.find(key);
        return f && f->is_string() ? f->as_string() : "";
    }

    static std::optional<std::uint64_t> seq_field(const Value& v, const char* key) {
        const Value* f = v.find(key);
        if (f == nullptr || !f->is_number()) return std::nullopt;
        return static_cast<std::uint64_t>(f->as_number());
    }

    void prefill_answers(const std::vector<Value>& history) {
        std::map<std::uint64_t, const Value*> ends;
        for (const Value& event : history) {
            std::string kind = string_of(event, "kind");
            auto action = seq_field(event, "actionSeq");
            if ((kind == "result" || kind == "refusal") && action) ends[*action] = &event;
        }
        static const std::set<std::string> kLogFields = {"seq",       "t",     "mono",      "inFlight", "kind", "step",
                                                         "tool",      "startMono", "durMs", "actionSeq", "rpcId"};
        for (const Value& action : history) {
            const Value* rpc = action.find("rpcId");
            if (string_of(action, "kind") != "action" || rpc == nullptr) continue;
            std::uint64_t seq = seq_field(action, "seq").value_or(0);
            auto end = ends.find(seq);
            Value out = object();
            if (end == ends.end()) {
                out.set("ok", false).set("error", "the call was interrupted by a restart; check its outside effects before repeating it");
            } else if (string_of(*end->second, "kind") == "refusal") {
                out.set("ok", false).set("refused", true).set("error", end->second->find("error") ? *end->second->find("error") : Value());
            } else {
                for (const json::Member& m : end->second->as_object()) {
                    if (!kLogFields.contains(m.first)) out.set(m.first, m.second);
                }
            }
            remember(id_key(rpc), tool_result(string_of(action, "tool"), out, seq));
        }
    }

    static std::optional<Value> recovery_of(const std::vector<Value>& history) {
        std::size_t first = history.size();
        for (std::size_t i = 0; i < history.size(); ++i) {
            if (history[i].find("actionSeq") || history[i].find("rpcId")) {
                first = i;
                break;
            }
        }
        if (first == history.size()) return std::nullopt;
        std::set<std::uint64_t> ended;
        for (const Value& event : history) {
            std::string kind = string_of(event, "kind");
            auto action = seq_field(event, "actionSeq");
            if ((kind == "result" || kind == "refusal" || kind == "code-call") && action) ended.insert(*action);
        }
        Value open = array();
        for (std::size_t i = first; i < history.size(); ++i) {
            const Value& event = history[i];
            std::uint64_t seq = seq_field(event, "seq").value_or(0);
            if (string_of(event, "kind") != "action" || ended.contains(seq)) continue;
            Value entry = object().set("seq", number_of(seq));
            if (const Value* tool = event.find("tool")) entry.set("tool", *tool);
            if (const Value* args = event.find("args")) entry.set("args", *args);
            open.push(std::move(entry));
        }
        if (open.as_array().empty()) return std::nullopt;
        std::uint64_t last = history.empty() ? 0 : seq_field(history.back(), "seq").value_or(0);
        return object().set("lastSeq", number_of(last)).set("open", std::move(open));
    }

    static Value recovery_note(const Value& recovery) {
        std::string list;
        for (const Value& action : recovery.find("open")->as_array()) {
            if (!list.empty()) list += "; ";
            list += "seq " + json::dump(*action.find("seq")) + " " + text_or_undefined(action.find("tool")) + " " +
                    (action.find("args") ? json::dump(*action.find("args")) : std::string("undefined"));
        }
        std::string last = json::dump(*recovery.find("lastSeq"));
        return object()
            .set("lastSeq", *recovery.find("lastSeq"))
            .set("open", *recovery.find("open"))
            .set("note", "This run resumed after a restart, at last seq " + last +
                             ". These actions started and have no end event: " + list +
                             ". Before you repeat any of them, check the outside effects: git log and git status, the remote, "
                             "and the row files under work/rows. Do not repeat a push, a commit, a fetch that posted, or a row "
                             "resolve unless those checks show that it did not happen.");
    }

    static std::uint64_t last_context_seq(const std::vector<Value>& history) {
        std::uint64_t seq = 0;
        for (const Value& event : history) {
            if (string_of(event, "kind") == "action" && string_of(event, "tool") == "next_context") seq = seq_field(event, "seq").value_or(0);
        }
        return seq;
    }

    void stop_orphans() {
        fs::path dir = s().run_dir / "jobs";
        std::error_code ec;
        if (!fs::is_directory(dir, ec)) return;
        for (const auto& entry : fs::directory_iterator(dir, ec)) {
            if (entry.path().extension() != ".json") continue;
            std::string text;
            if (!read_file(entry.path(), text)) continue;
            auto status = json::parse(text);
            if (!status || !status->is_object()) continue;
            std::string state = string_of(*status, "state");
            if (state != "running" && state != "queued") continue;
            if (!status->find("body")) continue;
            std::string job = string_of(*status, "job");
            auto body = seq_field(*status, "body").value_or(0);
            std::string tail = body_text(s(), body, kTailCap);
            Value killed = *status;
            killed.set("state", "killed").set("reason", "restart");
            write_status(s(), job, killed);
            Value fields = object().set("job", job).set("body", number_of(body)).set("state", "killed");
            if (const Value* start = status->find("startMono")) fields.set("startMono", *start);
            append("job", fields.set("reason", "restart"));
            append("job-killed", object().set("job", job).set("reason", "restart").set("tail", tail));
        }
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
        std::vector<Value> history;
        if (resumed) {
            history = events();
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
            s().notice_seq = last_context_seq(history);
            prefill_answers(history);
        }
        if (!closed_at_boot) {
            auto recovery = resumed ? recovery_of(history) : std::nullopt;
            if (resumed) append("restart", object().set("reason", options.restart_reason));
            else append("start", object()
                                     .set("mode", "mcp")
                                     .set("maxSteps", options.max_steps)
                                     .set("maxInflight", options.max_inflight)
                                     .set("taskFrom", trim(options.task).empty() ? "session prompt" : "task file"));
            if (recovery) {
                append("recovery", *recovery);
                s().recovery = recovery;
            }
            log_tools(history);
            stop_orphans();
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
        {
            std::lock_guard guard(mu);
            retired.push_back(std::move(session));
            session = std::move(fresh);
        }
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
        double start = s().log->now_ms();
        std::uint64_t action = append("action", action_fields(tool, args, with_rpc));
        if (with_rpc && s().rpc_id) s().call_action_seq = action;
        std::string error = "refused: " + reason;
        append("refusal", object()
                              .set("step", s().steps)
                              .set("tool", tool)
                              .set("error", error)
                              .set("startMono", start)
                              .set("actionSeq", number_of(action)));
        return object().set("ok", false).set("refused", true).set("error", error).set("actionSeq", number_of(action));
    }

    template <typename Exec, typename Digest>
    Value act(const std::string& tool, const Value& args, Exec exec, Digest digest) {
        int step = s().steps;
        double start = s().log->now_ms();
        in_flight += 1;
        struct Leave {
            std::atomic<int>& count;
            ~Leave() { count -= 1; }
        } leave{in_flight};
        std::uint64_t action = append("action", action_fields(tool, args, true));
        if (s().rpc_id) s().call_action_seq = action;
        Value result;
        try {
            result = exec(action);
        } catch (const std::exception& err) {
            result = object().set("ok", false).set("error", err.what());
        }
        if (tool == "run_code" && options.flush_job_events) options.flush_job_events();
        const Value* refused = result.find("refused");
        if (refused != nullptr && refused->as_bool()) {
            append("refusal", object()
                                  .set("step", step)
                                  .set("tool", tool)
                                  .set("error", *result.find("error"))
                                  .set("startMono", start)
                                  .set("actionSeq", number_of(action)));
        } else {
            append("result", merge(object().set("step", step).set("tool", tool).set("startMono", start).set("actionSeq", number_of(action)),
                                   digest(result)));
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
        stop_bodies("run-ended");
        write_summary();
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
                    .set("total", number_of(s().log->count()));
            },
            [](const Value& r) {
                Value d = object();
                for (const char* key : {"ok", "error", "role", "run"}) {
                    if (const Value* v = r.find(key)) d.set(key, *v);
                }
                return d;
            });
    }

    static void fingerprint_into(const fs::path& dir, const std::string& rel, std::vector<std::string>& parts) {
        static const std::set<std::string> kSkipDirs = {"node_modules", "runs", ".gm-new", ".git", "sources", "vendor"};
        std::error_code ec;
        for (const auto& entry : fs::directory_iterator(dir, ec)) {
            std::string name = entry.path().filename().string();
            if (kSkipDirs.contains(name)) continue;
            std::string path = rel.empty() ? name : rel + "/" + name;
            auto status = entry.symlink_status(ec);
            if (fs::is_directory(status)) {
                fingerprint_into(entry.path(), path, parts);
            } else if (fs::is_regular_file(status)) {
                auto when = fs::last_write_time(entry.path(), ec).time_since_epoch().count();
                parts.push_back(path + ":" + std::to_string(when) + ":" + std::to_string(entry.file_size(ec)));
            }
        }
    }

    void next_generation() {
        std::vector<std::string> parts;
        fingerprint_into(options.workspace, "", parts);
        std::sort(parts.begin(), parts.end());
        std::string joined;
        for (const auto& part : parts) joined += joined.empty() ? part : "\n" + part;
        std::string now = sha256_hex(joined);
        if (fingerprint && *fingerprint == now) return;
        fingerprint = now;
        generation += 1;
        append("generation", object().set("step", s().steps).set("generation", number_of(generation)));
    }

    void settle_started_jobs(const std::vector<std::string>& names) {
        if (names.empty() || !options.job_snapshot) return;
        using namespace std::chrono;
        auto deadline = steady_clock::now() + milliseconds(kStartedJobGraceMs);
        while (steady_clock::now() < deadline) {
            Value open = options.job_snapshot();
            bool running = false;
            if (open.is_array()) {
                for (const Value& entry : open.as_array()) {
                    running = running || std::find(names.begin(), names.end(), string_of(entry, "job")) != names.end();
                }
            }
            if (!running) return;
            std::this_thread::sleep_for(milliseconds(5));
        }
    }

    static long long steady_ms() {
        using namespace std::chrono;
        return duration_cast<milliseconds>(steady_clock::now().time_since_epoch()).count();
    }

    static long long wall_ms_of(const BodyJob& job) {
        using namespace std::chrono;
        return duration_cast<milliseconds>(job.start_wall.time_since_epoch()).count();
    }

    static std::string js_suffix(const std::string& text, std::size_t units) {
        std::size_t length = js_length(text);
        if (length <= units) return text;
        return text.substr(js_prefix(text, length - units).size());
    }

    static std::string js_slice(const std::string& text, std::size_t from, std::size_t to) {
        std::string head = js_prefix(text, to);
        return head.substr(js_prefix(head, from).size());
    }

    std::string body_text(Session& owner, std::uint64_t body, std::size_t cap) {
        auto events = owner.log->read_from(body);
        std::vector<std::string> lines;
        if (events) {
            for (const Value& event : *events) {
                if (string_of(event, "kind") != "code-call" || seq_field(event, "body") != body) continue;
                Value line = object();
                for (const char* key : {"seq", "tool", "ok", "output", "error"}) {
                    if (const Value* v = event.find(key)) line.set(key, *v);
                }
                lines.push_back(json::dump(line));
            }
        }
        std::string text;
        for (const auto& line : lines) text += text.empty() ? line : "\n" + line;
        return js_suffix(text, cap);
    }

    void write_status(Session& owner, const std::string& name, const Value& status) {
        fs::path dir = owner.run_dir / "jobs";
        std::error_code ec;
        fs::create_directories(dir, ec);
        fs::path file = dir / (name + ".json");
        fs::path temp = dir / (name + ".json.tmp");
        write_file(temp, json::dump(status) + "\n");
        fs::rename(temp, file, ec);
    }

    std::optional<Value> read_status(Session& owner, const std::string& name) {
        std::string text;
        if (!read_file(owner.run_dir / "jobs" / (name + ".json"), text)) return std::nullopt;
        auto parsed = json::parse(text);
        if (!parsed || !parsed->is_object()) return std::nullopt;
        return *parsed;
    }

    Value status_of(const BodyJob& job, const std::string& state) {
        return object().set("job", job.name).set("body", number_of(job.body)).set("state", state).set("startMono", job.start_mono);
    }

    void settle_locked(BodyJob& job, const std::string& state, const Value& fields) {
        if (job.settled) return;
        job.settled = true;
        Value status = status_of(job, state);
        Value event = status;
        for (const json::Member& m : fields.as_object()) {
            status.set(m.first, m.second);
            if (m.first != "value" && m.first != "error") event.set(m.first, m.second);
        }
        write_status(*job.owner, job.name, status);
        append_to(*job.owner, "job", std::move(event));
        job.changed.notify_all();
    }

    void stop_locked(BodyJob& job, const std::string& reason) {
        if (job.settled || !job.adopted) return;
        job.stopped = true;
        proc::kill_owned(job.body);
        std::string tail = body_text(*job.owner, job.body, kTailCap);
        settle_locked(job, "killed", object().set("reason", reason));
        Value killed = object().set("job", job.name).set("reason", reason).set("tail", tail);
        if (reason == "lifetime") killed.set("lifetimeMs", number_of(options.job_lifetime_ms));
        append_to(*job.owner, "job-killed", std::move(killed));
    }

    std::vector<std::shared_ptr<BodyJob>> body_list() {
        std::lock_guard guard(mu);
        return bodies;
    }

    std::vector<std::string> running_bodies() {
        std::vector<std::string> names;
        for (const auto& job : body_list()) {
            std::lock_guard guard(job->lock);
            if (job->adopted && !job->settled) names.push_back(job->name);
        }
        return names;
    }

    void stop_bodies(const std::string& reason) {
        for (const auto& job : body_list()) {
            std::lock_guard guard(job->lock);
            stop_locked(*job, reason);
        }
    }

    std::shared_ptr<BodyJob> body_named(const std::string& name) {
        for (const auto& job : body_list()) {
            if (job->name == name && job->owner == session.get()) return job;
        }
        return nullptr;
    }

    static std::string lost_output(const BodyJob& job) {
        std::size_t calls = 0;
        if (auto after = job.owner->log->read_from(job.body)) {
            for (const Value& event : *after) calls += string_of(event, "kind") == "code-call" ? 1 : 0;
        }
        return "the body stopped before it returned: its return value and console output are lost; " + std::to_string(calls) +
               " verb calls completed before the stop, each in query_log as a code-call after seq " + std::to_string(job.body);
    }

    void body_finished(const std::shared_ptr<BodyJob>& job, const deoxidene::Result<Value, std::string>& outcome) {
        std::lock_guard guard(job->lock);
        job->finished = true;
        if (outcome) job->value = *outcome;
        else job->error = outcome.error();
        if (job->stopped) {
            job->value.reset();
            job->error = lost_output(*job);
        }
        if (job->adopted && !job->settled) {
            if (job->value) {
                std::string text = json::dump(*job->value);
                std::size_t length = js_length(text);
                settle_locked(*job, "exited",
                              object()
                                  .set("value", length > kOutputCap ? js_prefix(text, kOutputCap) : text)
                                  .set("truncated", length > kOutputCap));
            } else {
                settle_locked(*job, "failed", object().set("error", job->error));
            }
        }
        job->changed.notify_all();
    }

    Value body_job_status(const Value& args) {
        static const std::regex kJobName(R"(^[A-Za-z0-9_-]{1,64}$)");
        std::string name = string_of(args, "job");
        if (!std::regex_match(name, kJobName)) return object().set("ok", false).set("error", "job must be a job name");
        double wait = std::clamp(args.find("waitMs") ? args.find("waitMs")->as_number(0) : 0.0, 0.0, kMaxJobWaitMs);
        if (auto job = body_named(name); job && wait > 0) {
            std::unique_lock guard(job->lock);
            job->changed.wait_for(guard, std::chrono::milliseconds(static_cast<long long>(wait)), [&] { return job->settled; });
        }
        auto status = read_status(s(), name);
        if (!status) return object().set("ok", false).set("error", "no job named " + name);
        const Value* offset_arg = args.find("offset");
        if (offset_arg && (!offset_arg->is_number() || offset_arg->as_number() < 0 ||
                           offset_arg->as_number() != static_cast<double>(static_cast<long long>(offset_arg->as_number())))) {
            return object().set("ok", false).set("error", "offset must be a whole number of characters, zero or more");
        }
        std::string text = body_text(s(), seq_field(*status, "body").value_or(0), std::numeric_limits<std::size_t>::max());
        std::size_t total = js_length(text);
        std::size_t from = offset_arg ? static_cast<std::size_t>(offset_arg->as_number()) : (total > kOutputPage ? total - kOutputPage : 0);
        std::size_t end = std::min(from + kOutputPage, total);
        if (from > end) from = end;
        Value reply = object().set("ok", true);
        for (const json::Member& m : status->as_object()) {
            if (m.first != "output") reply.set(m.first, m.second);
        }
        reply.set("exitCode", status->find("exitCode") ? *status->find("exitCode") : Value(nullptr));
        reply.set("signal", status->find("signal") ? *status->find("signal") : Value(nullptr));
        return reply.set("output", js_slice(text, from, end))
            .set("total", number_of(total))
            .set("truncated", from > 0 || end < total)
            .set("offset", number_of(from))
            .set("next", end < total ? number_of(end) : Value(nullptr))
            .set("logPath", nullptr);
    }

    bool is_body_job(const Value& args) {
        std::string name = string_of(args, "job");
        if (name.empty()) return false;
        if (body_named(name)) return true;
        auto status = read_status(s(), name);
        return status && status->find("body") != nullptr;
    }

    Value prd_summary() {
        bool served = false;
        for (const VerbInfo& verb : verbs.list()) served = served || verb.name == "prd_list";
        if (!served) return object().set("error", "no prd_list verb is served");
        Value reply = verbs.call("prd_list", object().set("status", "all"));
        if (!is_ok(reply)) return object().set("error", text_or_undefined(reply.find("error")));
        std::size_t total = 0;
        std::size_t open = 0;
        Value window = array();
        for (const Row& row : rows_of(string_of(reply, "output"), true, total)) {
            open += 1;
            if (window.as_array().size() < kNoticePrdWindow) window.push(object().set("id", row.id).set("title", row.title));
        }
        std::size_t shown = window.as_array().size();
        return object().set("total", number_of(total)).set("open", number_of(open)).set("window", std::move(window)).set("more", number_of(open - shown));
    }

    struct Row {
        std::string id;
        std::string title;
    };

    static std::vector<Row> rows_of(const std::string& listing, bool open_only, std::size_t& total) {
        std::vector<Row> rows;
        if (trim(listing) == "(none)") return rows;
        for (const auto& line : split_lines(listing)) {
            if (trim(line).empty()) continue;
            total += 1;
            std::size_t first = line.find(' ');
            if (first == std::string::npos) continue;
            std::size_t second = line.find(' ', first + 1);
            std::string status = line.substr(first + 1, second == std::string::npos ? std::string::npos : second - first - 1);
            if (open_only && status != "open") continue;
            rows.push_back({line.substr(0, first), second == std::string::npos ? std::string() : line.substr(second + 1)});
        }
        return rows;
    }

    std::vector<Row> open_rows() {
        std::set<std::string> served;
        for (const VerbInfo& verb : verbs.list()) served.insert(verb.name);
        std::vector<Row> rows;
        for (const char* verb : {"prd_list", "unknown_list"}) {
            if (!served.contains(verb)) continue;
            Value reply = verbs.call(verb, object());
            if (!is_ok(reply)) throw std::runtime_error(std::string(verb) + " failed: " + text_or_undefined(reply.find("error")));
            std::size_t total = 0;
            for (Row& row : rows_of(string_of(reply, "output"), true, total)) rows.push_back(std::move(row));
        }
        return rows;
    }

    Value active_jobs() {
        Value open = array();
        long long now = steady_ms();
        for (const auto& job : body_list()) {
            std::lock_guard guard(job->lock);
            if (!job->adopted || job->settled || job->owner != session.get()) continue;
            long long progress = job->in_flight > 0 ? now : std::max(wall_ms_of(*job), job->last_call_ms.load());
            open.push(object()
                          .set("job", job->name)
                          .set("body", number_of(job->body))
                          .set("state", "running")
                          .set("runningMs", static_cast<double>(now - wall_ms_of(*job)))
                          .set("sinceProgressMs", static_cast<double>(now - progress))
                          .set("stuck", job->stuck));
        }
        if (options.job_snapshot) {
            Value shells = options.job_snapshot();
            if (shells.is_array()) {
                for (const Value& entry : shells.as_array()) open.push(entry);
            }
        }
        return open;
    }

    void ensure_monitor() {
        std::lock_guard guard(mu);
        if (monitor_running) return;
        if (monitor.joinable()) monitor.join();
        monitor_running = true;
        monitor = std::thread([this] { monitor_loop(); });
    }

    void monitor_loop() {
        while (true) {
            {
                std::unique_lock guard(monitor_mutex);
                monitor_wake.wait_for(guard, std::chrono::milliseconds(options.monitor_ms), [&] { return shutting_down; });
                if (shutting_down) break;
            }
            if (!check_bodies()) {
                std::lock_guard guard(mu);
                bool open = false;
                for (const auto& job : bodies) open = open || (job->adopted && !job->exited && !job->settled);
                if (!open) {
                    monitor_running = false;
                    return;
                }
            }
        }
        std::lock_guard guard(mu);
        monitor_running = false;
    }

    bool check_bodies() {
        bool any = false;
        for (const auto& job : body_list()) {
            bool remind = false;
            double running_ms = 0;
            {
                std::lock_guard guard(job->lock);
                if (!job->adopted || job->settled) continue;
                any = true;
                long long now = steady_ms();
                if (static_cast<std::uint64_t>(now - wall_ms_of(*job)) >= options.job_lifetime_ms) {
                    stop_locked(*job, "lifetime");
                    continue;
                }
                long long progress = job->in_flight > 0 ? now : std::max(wall_ms_of(*job), job->last_call_ms.load());
                double since = static_cast<double>(now - progress);
                if (!job->stuck && since > static_cast<double>(options.stuck_ms)) {
                    job->stuck = true;
                    append_to(*job->owner, "job-stuck", object().set("job", job->name).set("body", number_of(job->body)).set("sinceProgressMs", since));
                } else if (job->stuck && since <= static_cast<double>(options.stuck_ms)) {
                    job->stuck = false;
                    append_to(*job->owner, "job-unstuck", object().set("job", job->name).set("body", number_of(job->body)).set("sinceProgressMs", since));
                }
                std::uint64_t due = static_cast<std::uint64_t>(now - wall_ms_of(*job)) / std::max<std::uint64_t>(1, options.notice_ms);
                if (due > job->reminders) {
                    job->reminders = due;
                    remind = true;
                    running_ms = std::round(job->owner->log->now_ms() - job->start_mono);
                }
            }
            if (!remind) continue;
            Value prd = prd_summary();
            std::lock_guard guard(job->lock);
            if (!job->settled) {
                append_to(*job->owner, "job-running",
                          object().set("job", job->name).set("body", number_of(job->body)).set("runningMs", running_ms).set("prd", std::move(prd)));
            }
        }
        return any;
    }

    Value job_notices(const std::vector<Value>& since) {
        Value notices = object();
        std::set<std::string> killed_names;
        Value killed = array();
        Value started = array();
        Value running = array();
        Value ended = array();
        Value stuck = array();
        Value unstuck = array();
        for (const Value& event : since) {
            if (string_of(event, "kind") == "job-killed") killed_names.insert(string_of(event, "job"));
        }
        auto pick = [](const Value& event, std::initializer_list<const char*> keys) {
            Value out = object();
            for (const char* key : keys) {
                if (const Value* v = event.find(key)) out.set(key, *v);
            }
            return out;
        };
        for (const Value& event : since) {
            std::string kind = string_of(event, "kind");
            std::string state = string_of(event, "state");
            if (kind == "job-killed") killed.push(pick(event, {"seq", "job", "reason", "lifetimeMs", "tail"}));
            if (kind == "job" && state == "running" && event.find("body")) started.push(pick(event, {"seq", "job"}));
            if (kind == "job-running") running.push(pick(event, {"seq", "job", "runningMs", "prd"}));
            if (kind == "job" && state != "running" && !(state == "killed" && killed_names.contains(string_of(event, "job")))) {
                ended.push(ended_job(event));
            }
            if (kind == "job-stuck") stuck.push(pick(event, {"seq", "job", "body", "sinceProgressMs"}));
            if (kind == "job-unstuck") unstuck.push(pick(event, {"seq", "job"}));
        }
        Value open = active_jobs();
        if (!killed.as_array().empty()) notices.set("jobsKilled", std::move(killed));
        if (!started.as_array().empty()) notices.set("jobsStarted", std::move(started));
        if (!running.as_array().empty()) notices.set("jobsRunning", std::move(running));
        if (!ended.as_array().empty()) notices.set("jobsEnded", std::move(ended));
        if (!stuck.as_array().empty()) notices.set("jobsStuck", std::move(stuck));
        if (!unstuck.as_array().empty()) notices.set("jobsUnstuck", std::move(unstuck));
        std::size_t open_count = open.as_array().size();
        if (open_count > 0) {
            Value shown = array();
            for (std::size_t i = 0; i < std::min(open_count, kOpenList); ++i) shown.push(open.as_array()[i]);
            notices.set("jobsOpen", std::move(shown));
            if (open_count > kOpenList) notices.set("jobsOpenMore", number_of(open_count - kOpenList));
        }
        return notices;
    }

    Value ended_job(const Value& event) {
        std::string job = string_of(event, "job");
        std::string text;
        if (event.find("body")) {
            if (auto status = read_status(s(), job)) {
                const Value* value = status->find("value");
                const Value* error = status->find("error");
                const Value* chosen = value && !value->is_null() ? value : error;
                if (chosen && !chosen->is_null()) text = chosen->is_string() ? chosen->as_string() : json::dump(*chosen);
            }
        } else if (!read_file(s().run_dir / "jobs" / (job + ".out"), text)) {
            read_file(s().run_dir / "jobs" / (job + ".log"), text);
        }
        std::size_t length = js_length(text);
        Value out = object().set("seq", *event.find("seq")).set("job", job);
        for (const char* key : {"state", "exitCode", "signal"}) {
            if (const Value* v = event.find(key)) out.set(key, *v);
        }
        return out.set("output", js_prefix(text, kOutputPage)).set("next", length > kOutputPage ? number_of(kOutputPage) : Value(nullptr));
    }

    std::optional<std::string> rules_change(const std::string& rules) {
        if (rules == s().rules_baseline) return std::nullopt;
        append("rules-changed", object().set("from", sha256_hex(s().rules_baseline).substr(0, 12)).set("to", sha256_hex(rules).substr(0, 12)));
        s().rules_baseline = rules;
        return "rules.md changed since the run started. The rules that hold from this step on are:\n\n" + rules;
    }

    void wait_for_pending(double wait_ms) {
        if (wait_ms <= 0) return;
        using namespace std::chrono;
        auto deadline = steady_clock::now() + milliseconds(static_cast<long long>(wait_ms));
        while (true) {
            std::uint64_t seen = pending_generation();
            if (has_pending(s().run_dir) || steady_clock::now() >= deadline) return;
            wait_pending_change(seen, std::min(deadline, steady_clock::now() + milliseconds(250)));
        }
    }

    Value context(int step) {
        std::string rules = read_rules();
        std::optional<Value> recovery_now;
        if (s().recovery) recovery_now = recovery_note(*s().recovery);
        s().recovery.reset();
        auto since_events = s().log->read_from(s().notice_seq);
        std::vector<Value> since = since_events ? std::move(*since_events) : std::vector<Value>{};
        s().notice_seq = s().log->count();
        Value notices = job_notices(since);
        std::uint64_t total = s().log->count();
        std::uint64_t shown = std::min(s().shown, total);
        std::uint64_t reach = shown > 26 ? shown - 26 : 0;
        std::map<std::uint64_t, Value> cache;
        if (auto window = s().log->read_from(reach)) {
            for (Value& event : *window) {
                auto seq = seq_field(event, "seq");
                if (seq) cache.emplace(*seq, std::move(event));
            }
        }
        EventAt at = [&](std::uint64_t seq) -> const Value* {
            auto found = cache.find(seq);
            if (found != cache.end()) return &found->second;
            if (seq == 0 || seq > total) return nullptr;
            auto one = s().log->read_from(seq - 1);
            if (!one || one->empty()) return nullptr;
            return &cache.emplace(seq, std::move(one->front())).first->second;
        };
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
            .set("total", number_of(total))
            .set("pendingCommands", object().set("wait", "\"" + options.wait_program + "\" events --dir \"" + s().run_dir.string() + "\" --wait"));
        reply = merge(std::move(reply), feed_of(at, total, shown));
        reply.set("query", query_hint(shown, total));
        if (recovery_now) reply.set("recovery", *recovery_now);
        auto notice = rules_notice();
        auto changed = rules_change(rules);
        if (notice || changed) {
            std::string text = notice.value_or("");
            if (changed) text += (text.empty() ? "" : " ") + *changed;
            reply.set("rulesPending", text);
        }
        reply = merge(std::move(reply), notices);
        PendingTake taken = take_pending(s().run_dir);
        if (!taken.records.empty()) {
            Value records = array();
            for (Value& record : taken.records) records.push(std::move(record));
            reply.set("pending", std::move(records));
        }
        if (!taken.files.empty()) {
            auto files = taken.files;
            after_reply[id_key(s().rpc_id ? &*s().rpc_id : nullptr)] = [files] { clear_pending(files); };
        }
        return reply;
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
        const Value* wait_arg = args.find("waitMs");
        double wait_ms = wait_arg && wait_arg->is_number() && wait_arg->as_number() > 0 ? std::min(wait_arg->as_number(), kMaxWaitMs) : 0;
        return act(
            "next_context", object(),
            [&](std::uint64_t) {
                wait_for_pending(wait_ms);
                return context(step);
            },
            [](const Value& r) {
                Value d = object();
                for (const char* key : {"ok", "error", "prefixSha", "total"}) {
                    if (const Value* v = r.find(key)) d.set(key, *v);
                }
                return d;
            });
    }

    void log_lint() {
        bool served = false;
        for (const VerbInfo& verb : verbs.list()) served = served || verb.name == "wiki_lint";
        Value problems = array();
        Value pages = number(0);
        if (served) {
            Value lint = verbs.call("wiki_lint", object());
            if (const Value* found = lint.find("problems")) problems = *found;
            if (const Value* found = lint.find("pages")) pages = *found;
            if (lint.find("problems") == nullptr && lint.find("error")) problems.push(text_or_undefined(lint.find("error")));
        } else if (std::error_code ec; fs::is_directory(options.workspace / "wiki", ec)) {
            problems.push("wiki_lint is not served");
        }
        append("lint", object().set("problems", std::move(problems)).set("pages", std::move(pages)));
    }

    static double round_ms(double value) { return std::round(value * 1000) / 1000; }

    void write_summary() {
        auto all = events();
        for (const Value& event : all) {
            if (string_of(event, "kind") == "summary") return;
        }
        double end = s().log->now_ms();
        using Span = std::pair<double, double>;
        auto spans = [&](auto picks) {
            std::vector<Span> out;
            for (const Value& event : all) {
                const Value* start = event.find("startMono");
                const Value* mono = event.find("mono");
                if (picks(string_of(event, "kind")) && start && start->is_number() && mono) out.emplace_back(start->as_number(), mono->as_number());
            }
            return out;
        };
        auto merged = [](std::vector<Span> intervals) {
            std::sort(intervals.begin(), intervals.end(), [](const Span& a, const Span& b) { return a.first < b.first; });
            std::vector<Span> out;
            for (const auto& [from, to] : intervals) {
                if (!out.empty() && from <= out.back().second) out.back().second = std::max(out.back().second, to);
                else out.emplace_back(from, to);
            }
            return out;
        };
        auto total = [](const std::vector<Span>& intervals) {
            double sum = 0;
            for (const auto& [from, to] : intervals) sum += to - from;
            return sum;
        };
        auto tool = spans([](const std::string& k) { return k == "result" || k == "refusal"; });
        auto model = spans([](const std::string& k) { return k == "reply" || k == "retry" || k == "error"; });
        double wall = all.empty() ? 0 : end - (all.front().find("mono") ? all.front().find("mono")->as_number() : 0);
        double max_in_flight = 0;
        bool mcp_mode = false;
        double context_calls = 0;
        double replies = 0;
        bool start_seen = false;
        for (const Value& event : all) {
            if (const Value* flight = event.find("inFlight"); flight && flight->is_number()) max_in_flight = std::max(max_in_flight, flight->as_number());
            std::string kind = string_of(event, "kind");
            if (kind == "start" && !start_seen) {
                start_seen = true;
                mcp_mode = string_of(event, "mode") == "mcp";
            }
            if (kind == "result" && string_of(event, "tool") == "next_context") context_calls += 1;
            if (kind == "reply") replies += 1;
        }
        auto both = tool;
        both.insert(both.end(), model.begin(), model.end());
        append("summary", object()
                              .set("maxInFlight", max_in_flight)
                              .set("meanInFlight", wall > 0 ? round_ms(total(tool) / wall) : 0.0)
                              .set("modelMs", round_ms(total(merged(model))))
                              .set("toolMs", round_ms(total(merged(tool))))
                              .set("idleMs", round_ms(std::max(0.0, wall - total(merged(both)))))
                              .set("contextCalls", mcp_mode ? context_calls : replies));
    }

    static bool gap_names(const std::string& gap, const std::string& id) {
        std::string word;
        auto is_word = [](char c) { return std::isalnum(static_cast<unsigned char>(c)) || c == '-'; };
        for (std::size_t i = 0; i <= gap.size(); ++i) {
            if (i < gap.size() && is_word(gap[i])) {
                word.push_back(gap[i]);
                continue;
            }
            if (word == id) return true;
            word.clear();
        }
        return false;
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
        const Value* stop_background = args.find("stopBackground");
        bool stopping = stop_background && stop_background->is_bool() && stop_background->as_bool();
        auto running = running_bodies();
        if (!running.empty() && !stopping) {
            std::string names;
            for (const auto& name : running) names += names.empty() ? name : ", " + name;
            return refuse("finish", args,
                          "background run " + names + " is still running; job_status watches it, and finish with stopBackground: true kills it",
                          false);
        }
        auto open = open_rows();
        if (gaps != nullptr) {
            for (const Row& row : open) {
                bool named = false;
                for (const Value& gap : gaps->as_array()) named = named || gap_names(gap.as_string(), row.id);
                if (named) {
                    return refuse("finish", args,
                                  "gap names open row " + row.id +
                                      "; a gap cannot stand in for an open row, so resolve it or, for a PRD, delete it");
                }
            }
        }
        if (!open.empty()) {
            std::string names;
            for (std::size_t i = 0; i < std::min(open.size(), kRowsNamed); ++i) {
                names += (i == 0 ? "" : "; ") + open[i].id + " " + open[i].title;
            }
            return refuse("finish", args,
                          std::to_string(open.size()) + " row(s) open: " + names + (open.size() > kRowsNamed ? "; ..." : "") +
                              ". Resolve each with its witness, or delete a PRD you will not implement with prd_delete. A "
                              "question for the owner stays open until the owner answers");
        }
        if (stopping) stop_bodies("stopBackground");
        s().ended = "finished";
        Value out = act(
            "finish", args,
            [&](std::uint64_t) { return object().set("ok", true).set("finished", true).set("output", *witness); },
            [](const Value& r) { return r; });
        log_lint();
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

    Value tool_result(const std::string& name, const Value& out, std::optional<std::uint64_t> seq) {
        Value content = array();
        content.push(object().set("type", "text").set("text", json::dump(out)));
        Value meta = object().set(kRunMeta, s().run_id);
        if (seq) meta.set(kRunSeq, number_of(*seq));
        Value result = object().set("content", std::move(content));
        if (name == "next_context" || name == "run_code" || name == "finish") result.set("structuredContent", out);
        return result.set("isError", !is_ok(out)).set("_meta", std::move(meta));
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
        return tool_result(name, out, seq);
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
        if (!uri_value || !uri_value->is_string()) throw RpcError(-32602, "resources/read needs a uri string");
        const std::string& uri = uri_value->as_string();
        if (auto run = read_run(uri)) {
            Value contents = array();
            contents.push(*run);
            return cacheable(object().set("contents", std::move(contents)), kVolatileTtlMs);
        }
        if (auto served = serve_skill_file(uri, "resource")) {
            Value contents = array();
            contents.push(*served);
            return cacheable(object().set("contents", std::move(contents)), kListTtlMs);
        }
        throw RpcError(-32602, "resource not found: " + uri, object().set("uri", uri));
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

    void announce_list_changes() {
        std::string tools_sha;
        std::string prompts_sha;
        try {
            tools_sha = sha256_hex(json::dump(served_tools()));
            prompts_sha = sha256_hex(json::dump(prompts_list()));
        } catch (const std::exception&) {
            return;
        }
        if (!announced_tools.empty() && tools_sha != announced_tools) {
            notify(object().set("jsonrpc", "2.0").set("method", "notifications/tools/list_changed"));
        }
        if (!announced_prompts.empty() && prompts_sha != announced_prompts) {
            notify(object().set("jsonrpc", "2.0").set("method", "notifications/prompts/list_changed"));
        }
        announced_tools = tools_sha;
        announced_prompts = prompts_sha;
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

    static Value capabilities() {
        return object()
            .set("tools", object().set("listChanged", true))
            .set("prompts", object().set("listChanged", true))
            .set("resources", object().set("listChanged", true))
            .set("logging", object())
            .set("completions", object())
            .set("extensions", object().set("io.modelcontextprotocol/skills", object()));
    }

    static std::string instructions() { return kCodeInstructions + "\n\n" + kResourcesPointer + "\n\n" + kSkillPointer; }

    Value initialize(const Value* params) {
        const Value* asked = params ? params->find("protocolVersion") : nullptr;
        std::string version = kSupportedVersions.front();
        if (asked && asked->is_string() &&
            std::find(kSupportedVersions.begin(), kSupportedVersions.end(), asked->as_string()) != kSupportedVersions.end()) {
            version = asked->as_string();
        }
        return object()
            .set("protocolVersion", version)
            .set("capabilities", capabilities())
            .set("instructions", instructions())
            .set("serverInfo", object().set("name", kServerName).set("title", kServerTitle).set("version", options.version));
    }

    Value discover() {
        Value versions = array();
        for (const auto& version : kSupportedVersions) versions.push(version);
        return cacheable(object()
                             .set("resultType", "complete")
                             .set("supportedVersions", std::move(versions))
                             .set("capabilities", capabilities())
                             .set("_meta", object().set("io.modelcontextprotocol/serverInfo", object().set("name", kServerName).set("version", options.version)))
                             .set("instructions", instructions()),
                         kListTtlMs);
    }

    Value tools_list() { return cacheable(object().set("tools", served_tools()), kListTtlMs); }

    Value prompts_list() {
        Value prompts = array();
        for (const auto& name : served_skills()) prompts.push(skill_prompt(name));
        return cacheable(object().set("prompts", std::move(prompts)), kListTtlMs);
    }

    std::optional<Value> route(const std::string& method, const Value* params, const Value& rpc_id) {
        if (method == "initialize") return initialize(params);
        if (method == "ping") return object();
        if (method == "server/discover") return discover();
        if (method == "tools/list") return tools_list();
        if (method == "tools/call") return call_tool(params, rpc_id);
        if (method == "prompts/list") return prompts_list();
        if (method == "prompts/get") return get_prompt(params);
        if (method == "resources/list") return cacheable(resources_list(), kVolatileTtlMs);
        if (method == "resources/read") return read_resource(params);
        if (method == "skills/list") {
            Value list = array();
            for (const auto& name : served_skills()) list.push(skill_entry(skills.get(name)));
            return object().set("resultType", "complete").set("skills", std::move(list));
        }
        if (method == "skills/get") return skills_get(params);
        if (method == "resources/templates/list") return cacheable(resource_templates(), kListTtlMs);
        if (method == "resources/subscribe") {
            const Value* uri = params ? params->find("uri") : nullptr;
            auto digest = uri && uri->is_string() ? digest_of(uri->as_string()) : std::nullopt;
            if (!digest) {
                Value data = object();
                if (uri) data.set("uri", *uri);
                throw RpcError(-32602, "resource not found: " + text_or_undefined(uri), data);
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
            if (reply) {
                emit(json::dump(*reply));
                auto done = after_reply.find(id_key(reply->find("id")));
                if (done != after_reply.end()) {
                    auto action = std::move(done->second);
                    after_reply.erase(done);
                    action();
                }
            }
        } catch (const std::exception& err) {
            auto parsed = json::parse(line);
            if (parsed && parsed->find("id")) emit(json::dump(error_reply(*parsed->find("id"), -32603, err.what())));
        }
        announce_list_changes();
        check_subscriptions();
    }

    void input_ended() {
        if (s().end_logged) return;
        if (options.supervised) {
            s().ended = "restarting";
            stop_bodies("restart");
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
    LoggedVerbs(Server::State& state, std::shared_ptr<Server::State::BodyJob> job, std::shared_ptr<Server::State::Gate> gate)
        : state_(state), job_(std::move(job)), gate_(std::move(gate)) {}

    std::vector<VerbInfo> list() const override {
        std::shared_lock guard(gate_->lock);
        if (!gate_->alive) return {};
        return served_verbs(state_.verbs);
    }

    json::Value call(std::string_view name_view, const json::Value& args) override {
        std::string name(name_view);
        std::shared_lock guard(gate_->lock);
        if (!gate_->alive || job_->stopped) {
            return object().set("ok", false).set("error", "background run " + job_->name + " was stopped; its verb calls are refused");
        }
        Server::State::Session& owner = *job_->owner;
        double start = owner.log->now_ms();
        std::optional<std::uint64_t> action;
        if (!kReadOnlyTools.contains(name)) {
            action = state_.append_to(owner, "action", object()
                                                           .set("step", job_->step)
                                                           .set("tool", name)
                                                           .set("args", args)
                                                           .set("body", number_of(job_->body)));
        }
        job_->in_flight += 1;
        Value result;
        try {
            bool body_job = (name == "job_status" || name == "job_stop") && state_.is_body_job(args);
            if (body_job && name == "job_status") result = state_.body_job_status(args);
            else if (body_job) {
                result = object().set("ok", false).set("error", Server::State::string_of(args, "job") +
                                                                     " is a background run, not a shell job; finish with stopBackground: true stops it");
            } else {
                result = state_.verbs.call(name, args);
                if (name == "job_start" && is_ok(result)) {
                    std::lock_guard job_guard(job_->lock);
                    job_->started_jobs.push_back(Server::State::string_of(args, "job"));
                }
            }
        } catch (const std::exception& err) {
            result = object().set("ok", false).set("error", err.what());
        }
        job_->in_flight -= 1;
        job_->last_call_ms = Server::State::steady_ms();
        Value shown = logged_for(name, result);
        Value fields = object().set("step", job_->step).set("tool", name).set("startMono", start).set("ok", is_ok(shown)).set("args", args);
        for (const char* key : {"exitCode", "signal", "output", "outputChars", "outputDigest", "error"}) {
            if (const Value* v = shown.find(key)) fields.set(key, *v);
        }
        fields.set("body", number_of(job_->body));
        if (action) fields.set("actionSeq", number_of(*action));
        state_.append_to(owner, "code-call", std::move(fields));
        return result;
    }

private:
    Server::State& state_;
    std::shared_ptr<Server::State::BodyJob> job_;
    std::shared_ptr<Server::State::Gate> gate_;
};

}

Server::State::~State() {
    {
        std::lock_guard guard(monitor_mutex);
        shutting_down = true;
    }
    monitor_wake.notify_all();
    if (monitor.joinable()) monitor.join();
    auto jobs = body_list();
    for (const auto& job : jobs) job->stopped = true;
    {
        std::unique_lock guard(gate->lock);
        gate->alive = false;
    }
    for (const auto& job : jobs) {
        if (!job->thread.joinable()) continue;
        if (job->exited) job->thread.join();
        else job->thread.detach();
    }
}

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
            double budget = kDefaultBodyTimeoutMs;
            if (timeout != nullptr) {
                double ms = timeout->as_number(-1);
                if (!timeout->is_number() || ms != static_cast<double>(static_cast<long long>(ms)) || ms < 1 || ms > kMaxTimeoutMs) {
                    return with_seq(object().set("ok", false).set("error", "timeoutMs must be an integer from 1 to " + std::to_string(kMaxTimeoutMs)));
                }
                budget = ms;
            }
            const Value* format = args.find("format");
            if (format != nullptr && !(format->is_string() && (format->as_string() == "esm" || format->as_string() == "cjs"))) {
                return with_seq(object().set("ok", false).set("error", "format must be esm or cjs"));
            }
            if (!options.run_body) return with_seq(object().set("ok", false).set("error", "no body runner is configured"));
            next_generation();
            auto job = std::make_shared<BodyJob>();
            job->body = action;
            job->step = s().steps;
            job->owner = &s();
            job->start_mono = s().log->now_ms();
            job->name = "body-" + std::to_string(action);
            for (int n = 2; body_named(job->name); ++n) job->name = "body-" + std::to_string(action) + "-" + std::to_string(n);
            {
                std::lock_guard guard(mu);
                bodies.push_back(job);
            }
            auto logged = std::make_shared<LoggedVerbs>(*this, job, gate);
            job->thread = std::thread([this, job, logged, runner = options.run_body, source = body->as_string(), root = options.workspace,
                                       shared_gate = gate] {
                proc::OwnerScope owner(job->body);
                auto outcome = runner(*logged, source, root);
                {
                    std::shared_lock guard(shared_gate->lock);
                    if (shared_gate->alive) body_finished(job, outcome);
                }
                job->exited = true;
            });
            std::unique_lock guard(job->lock);
            bool done = job->changed.wait_for(guard, std::chrono::milliseconds(static_cast<long long>(budget)), [&] { return job->finished; });
            if (done) {
                auto started_jobs = job->started_jobs;
                guard.unlock();
                job->thread.join();
                settle_started_jobs(started_jobs);
                {
                    std::lock_guard list_guard(mu);
                    std::erase(bodies, job);
                }
                if (!job->value) return with_seq(object().set("ok", false).set("error", job->error).set("loads", array()));
                std::string text = json::dump(*job->value);
                std::size_t length = js_length(text);
                return with_seq(object()
                                    .set("ok", true)
                                    .set("output", length > kOutputCap ? js_prefix(text, kOutputCap) : text)
                                    .set("truncated", length > kOutputCap)
                                    .set("loads", array()));
            }
            job->adopted = true;
            job->start_wall = std::chrono::steady_clock::now();
            write_status(*job->owner, job->name, status_of(*job, "running"));
            append("job", object().set("job", job->name).set("body", number_of(job->body)).set("state", "running"));
            guard.unlock();
            ensure_monitor();
            Value logged_calls = array();
            if (auto after = s().log->read_from(action)) {
                for (const Value& event : *after) {
                    if (string_of(event, "kind") != "code-call") continue;
                    Value entry = object().set("seq", *event.find("seq"));
                    if (const Value* tool = event.find("tool")) entry.set("tool", *tool);
                    if (const Value* ok = event.find("ok")) entry.set("ok", *ok);
                    logged_calls.push(std::move(entry));
                }
            }
            return with_seq(object()
                                .set("ok", true)
                                .set("background", job->name)
                                .set("state", "running")
                                .set("logged", std::move(logged_calls))
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

}
