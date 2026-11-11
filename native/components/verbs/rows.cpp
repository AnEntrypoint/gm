#include <algorithm>
#include <chrono>
#include <ctime>
#include <filesystem>
#include <fstream>
#include <random>
#include <regex>
#include <set>
#include <sstream>
#include <system_error>

#include "core_internal.hpp"
#include "gm/core_verbs.hpp"
#include "gm/proc.hpp"

namespace gm::core {
namespace {

namespace fs = std::filesystem;

const std::string kRowDir = "work/rows";
const std::string kLegacyRowDir = ".gm/prd";
const std::string kCloseDir = "closes";
const std::vector<std::string> kStatuses{"open", "parked", "refuted", "resolved", "all"};

std::string alias_of(const std::string& status) {
    if (status == "pending") return "open";
    if (status == "completed") return "resolved";
    return status;
}

std::string label_of(const std::string& kind) { return kind == "prd" ? "work item" : "open question"; }

std::string trim(const std::string& text) {
    const auto first = text.find_first_not_of(" \t\r\n");
    if (first == std::string::npos) return "";
    const auto last = text.find_last_not_of(" \t\r\n");
    return text.substr(first, last - first + 1);
}

std::string text_of(const json::Value& args, std::string_view key) {
    const json::Value* v = args.find(key);
    return v != nullptr && v->is_string() ? v->as_string() : std::string();
}

bool has_string(const json::Value& args, std::string_view key) {
    const json::Value* v = args.find(key);
    return v != nullptr && v->is_string();
}

bool has_integer(const json::Value& args, std::string_view key) {
    const json::Value* v = args.find(key);
    if (v == nullptr || !v->is_number()) return false;
    const double n = v->as_number();
    return n == static_cast<double>(static_cast<long long>(n));
}

std::string row_field(const json::Value& row, std::string_view key) {
    const json::Value* v = row.find(key);
    if (v == nullptr || v->is_null()) return "";
    return v->is_string() ? v->as_string() : json::dump(*v);
}

bool valid_id(const json::Value& args) {
    static const std::regex pattern("^[A-Za-z0-9][A-Za-z0-9._-]*$");
    return has_string(args, "id") && std::regex_match(args.find("id")->as_string(), pattern);
}

bool valid_sha(const std::string& text) {
    static const std::regex pattern("^[0-9a-f]{7,40}$");
    return std::regex_match(text, pattern);
}

std::string iso_now() {
    const auto now = std::chrono::system_clock::now();
    const auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(now.time_since_epoch()).count() % 1000;
    const std::time_t secs = std::chrono::system_clock::to_time_t(now);
    std::tm utc{};
#if defined(_WIN32)
    gmtime_s(&utc, &secs);
#else
    gmtime_r(&secs, &utc);
#endif
    char buf[32];
    std::snprintf(buf, sizeof(buf), "%04d-%02d-%02dT%02d:%02d:%02d.%03lldZ", utc.tm_year + 1900, utc.tm_mon + 1, utc.tm_mday, utc.tm_hour, utc.tm_min, utc.tm_sec, static_cast<long long>(ms));
    return buf;
}

std::string base36(std::uint64_t value) {
    static const char digits[] = "0123456789abcdefghijklmnopqrstuvwxyz";
    std::string out;
    do {
        out.insert(out.begin(), digits[value % 36]);
        value /= 36;
    } while (value > 0);
    return out;
}

std::string new_id(const std::string& kind) {
    static std::mt19937 engine{std::random_device{}()};
    const auto random = std::uniform_int_distribution<int>(0, 65535)(engine);
    char hex[8];
    std::snprintf(hex, sizeof(hex), "%04x", random);
    const auto now = static_cast<std::uint64_t>(std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count());
    return kind + "-" + base36(now) + hex;
}

json::Value parse_scalar(const std::string& raw) {
    auto parsed = json::parse(raw);
    return parsed ? *parsed : json::Value(raw);
}

json::Value parse_row(const std::string& source) {
    static const std::regex line_pattern(R"(^([A-Za-z_][A-Za-z0-9_.-]*): (.*)$)");
    json::Value row{json::Object{}};
    std::istringstream in(source);
    for (std::string line; std::getline(in, line);) {
        std::smatch match;
        if (std::regex_match(line, match, line_pattern)) row.set(match[1].str(), parse_scalar(match[2].str()));
    }
    return row;
}

std::string render_row(const json::Value& row) {
    static const std::regex key_pattern("^[A-Za-z_][A-Za-z0-9_.-]*$");
    std::string out;
    for (const auto& member : row.as_object()) {
        if (member.first == "file" || member.second.is_null() || !std::regex_match(member.first, key_pattern)) continue;
        out += member.first + ": " + json::dump(member.second) + "\n";
    }
    return out;
}

std::string put(const fs::path& path, const std::string& content) {
    std::error_code ec;
    fs::create_directories(path.parent_path(), ec);
    if (ec) return ec.message();
    return write_text(path, content);
}

json::Value without(const json::Value& row, std::string_view key) {
    json::Object kept;
    for (const auto& member : row.as_object())
        if (member.first != key) kept.push_back(member);
    return json::Value(std::move(kept));
}

struct Context {
    fs::path workspace;
    LockedLog& log;

    fs::path row_path(const std::string& id) const { return workspace / kRowDir / (id + ".yml"); }
    fs::path legacy_row_path(const std::string& id) const { return workspace / kLegacyRowDir / (id + ".yml"); }

    std::optional<fs::path> row_file(const std::string& id) const {
        std::error_code ec;
        for (const auto& path : {row_path(id), legacy_row_path(id)})
            if (fs::is_regular_file(path, ec)) return path;
        return std::nullopt;
    }

    std::optional<json::Value> read_row(const std::string& id) const {
        const auto path = row_file(id);
        if (!path) return std::nullopt;
        const auto text = read_text(*path, "open");
        if (!text.ok) throw std::runtime_error(text.error);
        json::Value row = parse_row(text.text);
        row.set("file", path->generic_string());
        return row;
    }

    void write_row(const json::Value& row) const {
        const std::string file = row_field(row, "file");
        const fs::path path = file.empty() ? row_path(row_field(row, "id")) : fs::path(file);
        const std::string error = put(path, render_row(row));
        if (!error.empty()) throw std::runtime_error(error);
    }

    std::vector<json::Value> read_rows() const {
        std::set<std::string> seen;
        std::vector<json::Value> rows;
        for (const auto& dir : {kRowDir, kLegacyRowDir}) {
            std::vector<std::string> names;
            std::error_code ec;
            for (const auto& entry : fs::directory_iterator(workspace / dir, ec))
                if (entry.path().extension() == ".yml") names.push_back(entry.path().filename().string());
            std::sort(names.begin(), names.end());
            for (const auto& name : names) {
                if (!seen.insert(name).second) continue;
                const auto text = read_text(workspace / dir / name, "open");
                if (!text.ok) throw std::runtime_error(text.error);
                rows.push_back(parse_row(text.text));
            }
        }
        return rows;
    }

    json::Value git(const std::vector<std::string>& argv, std::uint64_t timeout_ms) const {
        std::vector<std::string> full{"git"};
        full.insert(full.end(), argv.begin(), argv.end());
        const auto outcome = proc::run(full, workspace, {}, timeout_ms);
        json::Value reply;
        reply.set("started", outcome.started);
        reply.set("ok", outcome.started && !outcome.timed_out && outcome.exit_code == 0);
        reply.set("out", outcome.out);
        return reply;
    }

    bool git_ok(const std::vector<std::string>& argv, std::uint64_t timeout_ms = 15000) const { return git(argv, timeout_ms).find("ok")->as_bool(); }

    bool commit_exists(const std::string& commit) const { return git_ok({"cat-file", "-e", commit + "^{commit}"}); }

    bool event_in_log(std::uint64_t event) const {
        auto events = log.read_all();
        if (!events) return false;
        for (const auto& item : *events) {
            const json::Value* seq = item.find("seq");
            if (seq != nullptr && seq->is_number() && static_cast<std::uint64_t>(seq->as_number()) == event) return true;
        }
        return false;
    }

    void log_event(const std::string& kind, json::Value fields) const { log.append(kind, std::move(fields)); }
};

json::Value ok(std::string output) {
    json::Value reply;
    reply.set("ok", true);
    reply.set("output", std::move(output));
    return reply;
}

json::Value fail(std::string message) { return failure(std::move(message)); }

json::Value add_row(Context& c, const std::string& kind, const json::Value& args) {
    if (!has_string(args, "title") || trim(text_of(args, "title")).empty()) return fail("title must be a non-empty string");
    const json::Value* body = args.find("body");
    if (body != nullptr && !body->is_null() && !body->is_string()) return fail("body must be a string");
    json::Value row{json::Object{}};
    row.set("id", new_id(kind));
    row.set("kind", kind);
    row.set("title", trim(text_of(args, "title")));
    row.set("body", body != nullptr && body->is_string() ? body->as_string() : std::string());
    row.set("status", "open");
    row.set("createdAt", iso_now());
    c.write_row(row);
    c.log_event("row-added", json::Value(json::Object{}).set("row", row_field(row, "id")).set("rowKind", kind).set("title", row_field(row, "title")));
    return ok(row_field(row, "id"));
}

json::Value list_rows(Context& c, const std::string& kind, const json::Value& args) {
    const std::string requested = has_string(args, "status") ? args.find("status")->as_string() : "open";
    const std::string wanted = alias_of(requested);
    if (std::find(kStatuses.begin(), kStatuses.end(), wanted) == kStatuses.end()) {
        std::string list;
        for (const auto& s : kStatuses) list += (list.empty() ? "" : ", ") + s;
        return fail("status must be one of " + list + ", pending, completed");
    }
    std::vector<json::Value> rows;
    for (auto& row : c.read_rows()) {
        const std::string row_kind = row.find("kind") ? row_field(row, "kind") : "prd";
        if (row_kind != kind) continue;
        if (wanted != "all" && alias_of(row_field(row, "status")) != wanted) continue;
        rows.push_back(std::move(row));
    }
    std::sort(rows.begin(), rows.end(), [](const json::Value& a, const json::Value& b) {
        const auto x = row_field(a, "createdAt");
        const auto y = row_field(b, "createdAt");
        return x != y ? x < y : row_field(a, "id") < row_field(b, "id");
    });
    std::string output;
    for (const auto& row : rows) {
        if (!output.empty()) output += "\n";
        output += row_field(row, "id") + " " + row_field(row, "status") + " " + row_field(row, "title");
        if (row_field(row, "status") == "parked") output += " (parked: " + row_field(row, "parkReason") + ")";
        const json::Value* receipts = row.find("receipts");
        if (receipts != nullptr && receipts->is_array() && !receipts->as_array().empty()) output += " [receipts:" + std::to_string(receipts->as_array().size()) + "]";
    }
    return ok(output.empty() ? "(none)" : output);
}

std::string out_of(const json::Value& reply) { return row_field(reply, "out"); }

bool is_work_item(const json::Value& row) { return !row.find("kind") || row_field(row, "kind") == "prd"; }

json::Value park_row(Context& c, const json::Value& args) {
    if (!valid_id(args)) return fail("id must be a row id");
    const std::string id = text_of(args, "id");
    if (!has_string(args, "reason") || trim(text_of(args, "reason")).empty()) return fail("reason must be a non-empty string");
    auto row = c.read_row(id);
    if (!row) return fail("no row " + id);
    if (!is_work_item(*row)) return fail("row " + id + " is not a work item");
    if (row_field(*row, "status") != "open") return fail("row " + id + " is " + row_field(*row, "status") + "; only an open row is parked");
    row->set("status", "parked");
    row->set("parkReason", trim(text_of(args, "reason")));
    c.write_row(*row);
    return ok(id + " parked: " + row_field(*row, "parkReason"));
}

json::Value reopen_row(Context& c, const json::Value& args) {
    if (!valid_id(args)) return fail("id must be a row id");
    const std::string id = text_of(args, "id");
    const std::string from = has_string(args, "from") ? args.find("from")->as_string() : "parked";
    if (from != "parked" && from != "refuted") return fail("from must be parked or refuted");
    auto row = c.read_row(id);
    if (!row) return fail("no row " + id);
    if (!is_work_item(*row)) return fail("row " + id + " is not a work item");
    const std::string status = row_field(*row, "status");
    const std::string now = iso_now();
    std::string reason;
    if (from == "parked") {
        if (status != "parked") return fail("row " + id + " is " + status + "; only a parked row is reopened");
        *row = without(*row, "parkReason");
        row->set("status", "open");
        row->set("reopenedFrom", "parked");
        row->set("reopenedAt", now);
    } else {
        if (!has_string(args, "reason") || trim(text_of(args, "reason")).empty()) return fail("reason must be a non-empty string");
        static const std::regex verdict_pattern(R"(^(status|verdict):\s*(refuted|needs-design)\b)", std::regex::multiline);
        const std::string body = row_field(*row, "body");
        const std::string verdict = row_field(*row, "verdict");
        const bool refuted = status == "refuted" || (status == "resolved" && (std::regex_search(body, verdict_pattern) || verdict == "refuted" || verdict == "needs-design" || row_field(*row, "bodyStatus") == "refuted"));
        if (!refuted) return fail("row " + id + " is " + status + "; only a refuted row is reopened with from:refuted");
        row->set("status", "open");
        row->set("reopenedFrom", status);
        row->set("reopenReason", trim(text_of(args, "reason")));
        row->set("reopenedAt", now);
        reason = trim(text_of(args, "reason"));
    }
    c.write_row(*row);
    c.log_event("row-reopened", json::Value(json::Object{}).set("row", id).set("from", from).set("status", row_field(*row, "status")).set("reason", reason));
    return ok(id + " reopened from " + from);
}

json::Value receipt_row(Context& c, const json::Value& args) {
    if (!valid_id(args)) return fail("id must be a row id");
    const std::string id = text_of(args, "id");
    if (!has_string(args, "witness") || trim(text_of(args, "witness")).empty()) return fail("witness must be a non-empty string");
    const bool has_event = args.find("event") != nullptr && !args.find("event")->is_null();
    const bool has_commit = args.find("commit") != nullptr && !args.find("commit")->is_null();
    if (has_event) {
        if (!has_integer(args, "event") || args.find("event")->as_number() < 1) return fail("event must be a log seq number");
        if (!c.event_in_log(static_cast<std::uint64_t>(args.find("event")->as_number()))) return fail("event " + json::dump(*args.find("event")) + " is not in this run's log");
    }
    if (has_commit && (!has_string(args, "commit") || !valid_sha(text_of(args, "commit")))) return fail("commit must be 7 to 40 lowercase hex digits");
    auto row = c.read_row(id);
    if (!row) return fail("no row " + id);
    if (!is_work_item(*row)) return fail("row " + id + " is not a work item");
    json::Value receipt{json::Object{}};
    receipt.set("witness", trim(text_of(args, "witness")));
    if (has_event) receipt.set("event", args.find("event")->as_number());
    if (has_commit) receipt.set("commit", text_of(args, "commit"));
    json::Array receipts;
    if (const json::Value* existing = row->find("receipts"); existing != nullptr && existing->is_array()) receipts = existing->as_array();
    receipts.push_back(receipt);
    row->set("receipts", json::Value(receipts));
    if (has_event) row->set("witnessEvent", args.find("event")->as_number());
    if (has_commit) row->set("witnessCommit", text_of(args, "commit"));
    c.write_row(*row);
    c.log_event("row-receipt", json::Value(json::Object{}).set("row", id).set("receipts", static_cast<std::uint64_t>(receipts.size())).set("witness", trim(text_of(args, "witness"))).set("commit", has_commit ? json::Value(text_of(args, "commit")) : json::Value(nullptr)));
    return ok(id + " receipt " + std::to_string(receipts.size()) + " bound");
}

json::Value refute_row(Context& c, const json::Value& args) {
    if (!valid_id(args)) return fail("id must be a row id");
    const std::string id = text_of(args, "id");
    if (!has_string(args, "reason") || trim(text_of(args, "reason")).empty()) return fail("reason must be a non-empty string");
    auto row = c.read_row(id);
    if (!row) return fail("no row " + id);
    if (!is_work_item(*row)) return fail("row " + id + " is not a work item");
    if (row_field(*row, "status") != "open") return fail("row " + id + " is " + row_field(*row, "status") + "; only an open row is refuted");
    row->set("status", "refuted");
    row->set("refuteReason", trim(text_of(args, "reason")));
    row->set("refutedAt", iso_now());
    for (const char* key : {"verdict", "notes", "witness"})
        if (has_string(args, key)) row->set(key, text_of(args, key));
    c.write_row(*row);
    c.log_event("row-refuted", json::Value(json::Object{}).set("row", id).set("status", "refuted").set("reason", row_field(*row, "refuteReason")).set("verdict", row->find("verdict") ? row_field(*row, "verdict") : std::string()));
    return ok(id + " refuted: " + row_field(*row, "refuteReason"));
}

json::Value delete_row(Context& c, const json::Value& args) {
    if (!valid_id(args)) return fail("id must be a row id");
    const std::string id = text_of(args, "id");
    auto row = c.read_row(id);
    if (!row) return fail("no row " + id);
    if (row_field(*row, "kind") != "prd") return fail("row " + id + " is not a work item");
    if (row_field(*row, "status") == "resolved") return fail("row " + id + " is resolved; a resolved PRD is history and stays");
    std::error_code ec;
    fs::remove(fs::path(row_field(*row, "file")), ec);
    if (fs::exists(fs::path(row_field(*row, "file")), ec)) return fail("row " + id + " could not be removed");
    return ok(id + " deleted");
}

json::Value close_row(Context& c, const std::string& kind, const std::string& id, const std::string& witness, bool push) {
    auto row = c.read_row(id);
    if (!row) return fail("no row " + id);
    if (row->find("kind") && row_field(*row, "kind") != kind) return fail("row " + id + " is not a " + label_of(kind));
    if (row_field(*row, "status") == "resolved") return fail("row " + id + " is already resolved");
    const std::string close_rel = kCloseDir + "/" + id + ".txt";
    const std::string written = put(c.workspace / close_rel, id + " resolved " + witness + " " + iso_now() + "\n");
    if (!written.empty()) return fail("close record " + close_rel + " could not be written: " + written);
    const std::string row_rel = (fs::path(row_field(*row, "file")) == c.legacy_row_path(id) ? kLegacyRowDir : kRowDir) + "/" + id + ".yml";
    std::error_code ec;
    fs::remove(fs::path(row_field(*row, "file")), ec);
    if (fs::exists(fs::path(row_field(*row, "file")), ec)) return fail("row " + id + " could not be removed");
    std::vector<std::string> paths{close_rel};
    if (c.git_ok({"ls-files", "--error-unmatch", "--", row_rel})) paths.push_back(row_rel);
    const std::string message = "close " + id + "\n\nRow: " + id + "\nStatus: resolved\nWitness: " + witness;
    std::vector<std::string> add{"add", "-A", "--"};
    add.insert(add.end(), paths.begin(), paths.end());
    c.git_ok(add);
    std::vector<std::string> commit{"commit", "-m", message, "--"};
    commit.insert(commit.end(), paths.begin(), paths.end());
    if (!c.git_ok(commit)) return fail("close " + id + " has no commit; " + close_rel + " is written and the row file is removed");
    const std::string head = out_of(c.git({"rev-parse", "--short", "HEAD"}, 15000));
    const std::string output = id + " resolved by witness " + witness + " at commit " + (head.empty() ? "HEAD" : trim(head));
    if (!push) return ok(output);
    const auto full_sha = [&c]() -> std::optional<std::string> {
        const auto reply = c.git({"rev-parse", "HEAD"}, 15000);
        const std::string sha = trim(out_of(reply));
        const bool hex = sha.size() >= 40 && sha.size() <= 64 && sha.find_first_not_of("0123456789abcdef") == std::string::npos;
        return reply.find("ok")->as_bool() && hex ? std::optional<std::string>(sha) : std::nullopt;
    };
    const auto push_sha = [&c](const std::string& sha) { return c.git({"push", "origin", sha + ":refs/heads/main"}, 60000).find("ok")->as_bool(); };
    auto sha = full_sha();
    if (!sha) return fail("close " + id + " has no full commit sha to push");
    if (push_sha(*sha)) {
        auto reply = ok(output + " pushed " + *sha);
        reply.set("pushed", *sha);
        reply.set("recovery", "none");
        return reply;
    }
    if (!c.git_ok({"fetch", "-q", "origin", "main"}, 60000)) return fail("close " + id + " could not fetch origin/main after a rejected push");
    if (!c.git_ok({"rebase", "-q", "origin/main"}, 60000)) return fail("close " + id + " could not rebase onto origin/main after a rejected push");
    sha = full_sha();
    if (!sha) return fail("close " + id + " has no full commit sha after rebase");
    if (!push_sha(*sha)) return fail("close " + id + " could not push " + *sha + " after rebase");
    auto reply = ok(output + " pushed " + *sha + " after rebase");
    reply.set("pushed", *sha);
    reply.set("recovery", "fetch-rebase");
    return reply;
}

json::Value resolve_row(Context& c, const std::string& kind, const json::Value& args) {
    if (!valid_id(args)) return fail("id must be a row id");
    const std::string id = text_of(args, "id");
    const bool push = args.find("push") != nullptr && args.find("push")->is_bool() && args.find("push")->as_bool();
    if (has_string(args, "witness") || has_string(args, "event")) {
        std::string clean = std::regex_replace(has_string(args, "witness") ? text_of(args, "witness") : text_of(args, "event"), std::regex(R"(\s+)"), " ");
        clean = trim(clean);
        if (clean.empty()) return fail("witness must be a non-empty string");
        return close_row(c, kind, id, clean, push);
    }
    if (!has_integer(args, "event") || args.find("event")->as_number() < 1) return fail("event must be a log seq number");
    const auto event = static_cast<std::uint64_t>(args.find("event")->as_number());
    if (!c.event_in_log(event)) return fail("event " + std::to_string(event) + " is not in this run's log");
    if (!has_string(args, "commit") || !valid_sha(text_of(args, "commit"))) return fail("commit must be 7 to 40 lowercase hex digits");
    const std::string commit = text_of(args, "commit");
    if (!c.commit_exists(commit)) {
        return fail(c.git_ok({"rev-parse", "--is-inside-work-tree"}) ? "no commit " + commit + " in the repository at " + c.workspace.string()
                                                                       : "cannot check commit " + commit + ": " + c.workspace.string() + " is not a git repository");
    }
    auto row = c.read_row(id);
    if (!row) return fail("no row " + id);
    if (row->find("kind") && row_field(*row, "kind") != kind) return fail("row " + id + " is not a " + label_of(kind));
    if (row_field(*row, "status") == "resolved") return fail("row " + id + " is already resolved");
    row->set("status", "resolved");
    row->set("witnessEvent", static_cast<double>(event));
    row->set("witnessCommit", commit);
    row->set("resolvedAt", iso_now());
    c.write_row(*row);
    return ok(id + " resolved by event " + std::to_string(event) + " at commit " + commit);
}

}

bool is_row_verb(std::string_view name) {
    static const std::set<std::string_view> names{"prd_add", "prd_list", "prd_resolve", "unknown_add", "unknown_list", "unknown_resolve", "prd_delete", "prd_park", "prd_reopen", "prd_receipt", "prd_refute"};
    return names.contains(name);
}

const std::vector<VerbInfo>& row_verbs() {
    static const std::vector<VerbInfo> table = {
    {"prd_add", "Add a work item row, one file under work/rows/<id>.yml. Returns its id.", R"json({"type":"object","properties":{"title":{"type":"string"},"body":{"type":"string"}},"required":["title"]})json"},
    {"prd_list", "List work item rows, one line each: id, status, title. status is open (default), parked, refuted, resolved or all. A row with receipts carries [receipts:N]. Reads work/rows/ and the legacy .gm/prd/, and lists rows with kind: prd; a legacy row with no kind is treated as a prd work item, and status pending reads as open.", R"json({"type":"object","properties":{"status":{"type":"string"}},"required":[]})json"},
    {"prd_resolve", "Resolve a work item row in one call. Pass witness, the evidence string: the row file is removed, one line goes to closes/<id>.txt, and a commit records the row, status and witness. With push:true that commit is also pushed by full sha to origin/main in the same call, with fetch and rebase on rejection, so a shared tree closes in one call. A numeric event seq and an existing commit sha keep the older in-place resolution. Reads work/rows/ and the legacy .gm/prd/, so a legacy row without kind is closable here too.", R"json({"type":"object","properties":{"id":{"type":"string"},"event":{"type":"number"},"commit":{"type":"string"},"witness":{"type":"string"},"push":{"type":"boolean"}},"required":["id"]})json"},
    {"unknown_add", "Add a open question row, one file under work/rows/<id>.yml. Returns its id.", R"json({"type":"object","properties":{"title":{"type":"string"},"body":{"type":"string"}},"required":["title"]})json"},
    {"unknown_list", "List open question rows, one line each: id, status, title. status is open (default), parked, refuted, resolved or all. A row with receipts carries [receipts:N]. Reads work/rows/ and the legacy .gm/prd/, and lists rows with kind: unknown; a legacy row with no kind is treated as a prd work item, and status pending reads as open.", R"json({"type":"object","properties":{"status":{"type":"string"}},"required":[]})json"},
    {"unknown_resolve", "Resolve a open question row in one call. Pass witness, the evidence string: the row file is removed, one line goes to closes/<id>.txt, and a commit records the row, status and witness. With push:true that commit is also pushed by full sha to origin/main in the same call, with fetch and rebase on rejection, so a shared tree closes in one call. A numeric event seq and an existing commit sha keep the older in-place resolution. Reads work/rows/ and the legacy .gm/prd/, so a legacy row without kind is closable here too.", R"json({"type":"object","properties":{"id":{"type":"string"},"event":{"type":"number"},"commit":{"type":"string"},"witness":{"type":"string"},"push":{"type":"boolean"}},"required":["id"]})json"},
    {"prd_delete", "Delete a work item (PRD) row that is not resolved: the work is dropped and its file is removed, and git keeps it. An open question is resolved, not deleted.", R"json({"type":"object","properties":{"id":{"type":"string"}},"required":["id"]})json"},
    {"prd_park", "Park an open work item (PRD) row with a reason. A parked row is not open, and finish lists it with its reason in the witness.", R"json({"type":"object","properties":{"id":{"type":"string"},"reason":{"type":"string"}},"required":["id","reason"]})json"},
    {"prd_reopen", "Move a parked work item (PRD) row back to open, or reopen a refuted row with from:refuted and a reason.", R"json({"type":"object","properties":{"id":{"type":"string"},"from":{"type":"string"},"reason":{"type":"string"}},"required":["id"]})json"},
    {"prd_receipt", "gm.prd_receipt binds a witness receipt to a work item (PRD) row without resolving it or deleting the row file.", R"json({"type":"object","properties":{"id":{"type":"string"},"witness":{"type":"string"},"event":{"type":"number"},"commit":{"type":"string"}},"required":["id","witness"]})json"},
    {"prd_refute", "gm.prd_refute marks an open work item (PRD) row refuted with a reason, verdict, notes and witness receipt.", R"json({"type":"object","properties":{"id":{"type":"string"},"reason":{"type":"string"},"verdict":{"type":"string"},"notes":{"type":"string"},"witness":{"type":"string"}},"required":["id","reason"]})json"},
    };
    return table;
}

json::Value row_call(std::string_view name, const json::Value& args, const std::filesystem::path& workspace, LockedLog& log) {
    Context c{workspace, log};
    if (name == "prd_add") return add_row(c, "prd", args);
    if (name == "unknown_add") return add_row(c, "unknown", args);
    if (name == "prd_list") return list_rows(c, "prd", args);
    if (name == "unknown_list") return list_rows(c, "unknown", args);
    if (name == "prd_resolve") return resolve_row(c, "prd", args);
    if (name == "unknown_resolve") return resolve_row(c, "unknown", args);
    if (name == "prd_delete") return delete_row(c, args);
    if (name == "prd_park") return park_row(c, args);
    if (name == "prd_reopen") return reopen_row(c, args);
    if (name == "prd_receipt") return receipt_row(c, args);
    if (name == "prd_refute") return refute_row(c, args);
    return failure("unknown row verb: " + std::string(name));
}

}
