#include <algorithm>
#include <cctype>
#include <filesystem>
#include <map>
#include <optional>
#include <string>
#include <system_error>
#include <vector>

#include "core_internal.hpp"
#include "gm/proc.hpp"

namespace gm::core {
namespace {

namespace fs = std::filesystem;

constexpr std::size_t kOutputPage = 20000;
constexpr std::uint64_t kGitShowTimeoutMs = 10000;
const std::vector<std::string> kVerdicts{"pass", "fail", "needs-changes"};

std::string normalize_absolute(const std::string& path) {
    std::string drive;
    std::string rest = path;
    if (path.size() >= 2 && path[1] == ':' && std::isalpha(static_cast<unsigned char>(path[0]))) {
        drive = path.substr(0, 2);
        rest = path.substr(2);
    }
    std::vector<std::string> parts;
    std::string piece;
    for (std::size_t i = 0; i <= rest.size(); ++i) {
        const char c = i < rest.size() ? rest[i] : '/';
        if (c == '/' || c == '\\') {
            if (piece == "..") {
                if (!parts.empty()) parts.pop_back();
            } else if (!piece.empty() && piece != ".") {
                parts.push_back(piece);
            }
            piece.clear();
        } else {
            piece += c;
        }
    }
    std::string out = drive + "/";
    for (std::size_t i = 0; i < parts.size(); ++i) out += (i ? "/" : "") + parts[i];
    return out;
}

std::optional<std::string> file_at(const std::string& root, const json::Value* rel) {
    if (rel == nullptr || !rel->is_string() || rel->as_string().empty()) return std::nullopt;
    const std::string& text = rel->as_string();
    const std::string at = normalize_absolute(is_absolute(text) ? text : root + "/" + text);
    std::error_code ec;
    if (!fs::is_regular_file(at, ec)) return std::nullopt;
    return at;
}

std::optional<std::string> file_at_path(const std::string& root, const std::string& rel) {
    json::Value value(rel);
    return file_at(root, &value);
}

std::string sha_of_file(const std::string& at) {
    const auto text = read_text(at, "open");
    return text.ok ? sha256_hex(text.text) : std::string();
}

json::Value fields_of(std::initializer_list<std::pair<std::string, json::Value>> items) {
    json::Value out{json::Object{}};
    for (const auto& [key, value] : items) out.set(key, value);
    return out;
}

json::Value text_or_null(const std::optional<std::string>& text) { return text ? json::Value(*text) : json::Value(nullptr); }

std::string text_or(const json::Value* value, const std::string& fallback) {
    if (value == nullptr || value->is_null()) return fallback;
    return value->is_string() ? value->as_string() : json::dump(*value);
}

json::Value events_of(LockedLog& log) {
    auto events = log.read_all();
    return json::Value(events ? *events : std::vector<json::Value>{});
}

json::Value review_refused(LockedLog& log, json::Value fields, const std::string& reason) {
    fields.set("reason", reason);
    log.append("review-refused", std::move(fields));
    json::Value reply;
    reply.set("ok", false);
    reply.set("error", "refused: " + reason);
    return reply;
}

json::Value review_packet(const json::Value& args, const std::string& root, LockedLog& log) {
    const json::Value* refs_value = args.find("refs");
    json::Array refs_in;
    if (refs_value != nullptr && refs_value->is_array()) refs_in = refs_value->as_array();
    if (refs_value != nullptr && !refs_value->is_null() && !refs_value->is_array()) return review_refused(log, fields_of({{"stage", json::Value("packet")}}), "refs must be a list of paths");
    for (const auto& ref : refs_in)
        if (!ref.is_string()) return review_refused(log, fields_of({{"stage", json::Value("packet")}}), "refs must be a list of paths");
    const json::Value* spec = args.find("spec");
    const auto spec_at = file_at(root, spec);
    const std::string spec_text = text_or(spec, "undefined");
    if (!spec_at) return review_refused(log, fields_of({{"stage", json::Value("packet")}}), "spec " + spec_text + " is not a file");
    std::vector<std::string> missing;
    std::vector<std::string> refs;
    for (const auto& ref : refs_in) {
        refs.push_back(ref.as_string());
        if (!file_at_path(root, ref.as_string())) missing.push_back(ref.as_string());
    }
    if (!missing.empty()) {
        std::string joined;
        for (const auto& m : missing) joined += (joined.empty() ? "" : ", ") + m;
        return review_refused(log, fields_of({{"stage", json::Value("packet")}}), "referenced paths do not exist: " + joined);
    }
    const std::string spec_sha = sha_of_file(*spec_at);
    std::sort(refs.begin(), refs.end());
    json::Array sorted_refs;
    for (const auto& ref : refs) sorted_refs.push_back(json::Value(ref));
    json::Value packet_source{json::Object{}};
    packet_source.set("refs", json::Value(sorted_refs));
    packet_source.set("spec", spec_text);
    packet_source.set("specSha", spec_sha.empty() ? json::Value(nullptr) : json::Value(spec_sha));
    const std::string packet = sha256_hex(json::dump(packet_source));
    log.append("review-packet", fields_of({{"packet", json::Value(packet)}, {"spec", json::Value(spec_text)}, {"specSha", spec_sha.empty() ? json::Value(nullptr) : json::Value(spec_sha)}, {"refs", json::Value(sorted_refs)}}));
    json::Value result{json::Object{}};
    result.set("ok", true);
    result.set("packet", packet);
    result.set("spec", spec_text);
    result.set("specSha", spec_sha.empty() ? json::Value(nullptr) : json::Value(spec_sha));
    result.set("refs", json::Value(sorted_refs));
    json::Value reply;
    reply.set("ok", true);
    reply.set("output", json::dump(result));
    return reply;
}

json::Value run_events(LockedLog& log) { return events_of(log); }

json::Value review_record(const json::Value& args, const std::string& root, LockedLog& log) {
    const std::string packet = text_or(args.find("packet"), "undefined");
    const json::Value events = run_events(log);
    const json::Value* made = nullptr;
    bool has_record = false;
    for (const auto& event : events.as_array()) {
        const json::Value* kind = event.find("kind");
        const json::Value* id = event.find("packet");
        if (kind == nullptr || !kind->is_string() || id == nullptr || !id->is_string() || id->as_string() != packet) continue;
        if (kind->as_string() == "review-packet") made = &event;
        if (kind->as_string() == "review") has_record = true;
    }
    if (made == nullptr) return review_refused(log, fields_of({{"packet", json::Value(packet)}, {"stage", json::Value("record")}}), "no review packet " + packet + " in this log");
    if (has_record) return review_refused(log, fields_of({{"packet", json::Value(packet)}, {"stage", json::Value("record")}}), "packet " + packet + " already has a record");
    const json::Value* verdict_value = args.find("verdict");
    const std::string verdict = verdict_value != nullptr && verdict_value->is_string() ? verdict_value->as_string() : std::string();
    const bool verdict_ok = std::find(kVerdicts.begin(), kVerdicts.end(), verdict) != kVerdicts.end();
    auto refuse = [&](const std::string& reason) { return review_refused(log, fields_of({{"packet", json::Value(packet)}, {"stage", json::Value("record")}}), reason); };
    if (!verdict_ok) {
        std::string list;
        for (const auto& v : kVerdicts) list += (list.empty() ? "" : ", ") + v;
        return refuse("verdict must be one of " + list);
    }
    const json::Value* reviewer = args.find("reviewer");
    if (reviewer == nullptr || !reviewer->is_string() || reviewer->as_string().find_first_not_of(" \t\r\n") == std::string::npos)
        return refuse("reviewer must name the fresh reviewer that the host spawned");
    const json::Value* notes_value = args.find("notes");
    const std::string notes = notes_value == nullptr || notes_value->is_null() ? std::string() : notes_value->as_string();
    if (notes_value != nullptr && !notes_value->is_null() && !notes_value->is_string()) return refuse("notes must be a string");
    const json::Value* made_spec = made->find("spec");
    const json::Value* made_sha = made->find("specSha");
    const auto spec_at = file_at(root, made_spec);
    const std::string now_sha = spec_at ? sha_of_file(*spec_at) : std::string();
    const std::string recorded = made_sha != nullptr && made_sha->is_string() ? made_sha->as_string() : std::string();
    if (now_sha != recorded) {
        return refuse("the spec changed since packet " + packet + ": packet sha " + (recorded.empty() ? std::string("null") : recorded) + ", now " + (now_sha.empty() ? std::string("missing") : now_sha));
    }
    log.append("review", fields_of({{"packet", json::Value(packet)}, {"verdict", json::Value(verdict)}, {"reviewer", json::Value(reviewer->as_string())}, {"notes", json::Value(notes)}, {"isolation", json::Value("host-attested")}, {"specSha", recorded.empty() ? json::Value(nullptr) : json::Value(recorded)}}));
    json::Value result{json::Object{}};
    result.set("ok", true);
    result.set("packet", packet);
    result.set("verdict", verdict);
    json::Value reply;
    reply.set("ok", true);
    reply.set("output", json::dump(result));
    return reply;
}

std::string indent_of(int depth) { return std::string(static_cast<std::size_t>(depth), ' '); }

std::string pretty(const json::Value& value, int depth) {
    if (value.is_array()) {
        const auto& items = value.as_array();
        if (items.empty()) return "[]";
        std::string out = "[\n";
        for (std::size_t i = 0; i < items.size(); ++i) out += indent_of(depth + 1) + pretty(items[i], depth + 1) + (i + 1 < items.size() ? ",\n" : "\n");
        return out + indent_of(depth) + "]";
    }
    if (value.is_object()) {
        const auto& members = value.as_object();
        if (members.empty()) return "{}";
        std::string out = "{\n";
        for (std::size_t i = 0; i < members.size(); ++i)
            out += indent_of(depth + 1) + json::dump(json::Value(members[i].first)) + ": " + pretty(members[i].second, depth + 1) + (i + 1 < members.size() ? ",\n" : "\n");
        return out + indent_of(depth) + "}";
    }
    return json::dump(value);
}

std::optional<std::string> spec_sha_at(const std::string& root, const json::Value* commit, const json::Value* spec) {
    if (commit == nullptr || !commit->is_string() || spec == nullptr || !spec->is_string()) return std::nullopt;
    const auto shown = proc::run({"git", "show", commit->as_string() + ":" + spec->as_string()}, root, {}, kGitShowTimeoutMs);
    if (!shown.started || shown.timed_out || shown.exit_code != 0) return std::nullopt;
    return sha256_hex(shown.out);
}

std::optional<std::string> current_spec_sha(const std::string& root, const json::Value* spec) {
    if (spec == nullptr || !spec->is_string()) return std::nullopt;
    const auto at = file_at(root, spec);
    if (!at) return std::nullopt;
    return sha_of_file(*at);
}

struct JoinRow {
    json::Value meta{json::Object{}};
    json::Array outcomes;
    json::Array unattributed;
};

json::Value joined_row(const JoinRow& row) {
    json::Value out = row.meta;
    out.set("outcomes", json::Value(row.outcomes));
    out.set("unattributed", json::Value(row.unattributed));
    return out;
}

json::Value review_join(LockedLog& log, const std::string& root) {
    const json::Value events = run_events(log);
    std::map<std::string, json::Value> packets;
    for (const auto& event : events.as_array()) {
        const json::Value* kind = event.find("kind");
        if (kind == nullptr || !kind->is_string() || kind->as_string() != "review-packet") continue;
        packets[text_or(event.find("packet"), "")] = event;
    }
    std::vector<JoinRow> rows;
    bool commit_covered = true;
    auto field = [](const json::Value& event, const char* key) { const json::Value* v = event.find(key); return v != nullptr ? *v : json::Value(nullptr); };
    auto place = [](JoinRow& row, bool covered, json::Value item, const std::string& reason) {
        if (covered) {
            row.outcomes.push_back(item);
            return;
        }
        item.set("reason", reason);
        row.unattributed.push_back(item);
    };
    for (const auto& event : events.as_array()) {
        const json::Value* kind_value = event.find("kind");
        const std::string kind = kind_value != nullptr && kind_value->is_string() ? kind_value->as_string() : std::string();
        if (kind == "review") {
            const std::string packet = text_or(event.find("packet"), "");
            const auto made = packets.find(packet);
            JoinRow row;
            row.meta.set("packet", packet);
            row.meta.set("verdict", field(event, "verdict"));
            row.meta.set("reviewer", field(event, "reviewer"));
            row.meta.set("isolation", field(event, "isolation"));
            row.meta.set("seq", field(event, "seq"));
            row.meta.set("spec", made == packets.end() ? json::Value(nullptr) : field(made->second, "spec"));
            row.meta.set("specSha", made == packets.end() ? json::Value(nullptr) : field(made->second, "specSha"));
            rows.push_back(std::move(row));
            continue;
        }
        if (rows.empty()) continue;
        JoinRow& row = rows.back();
        const json::Value spec = *row.meta.find("spec");
        const json::Value recorded = *row.meta.find("specSha");
        if (kind == "commit") {
            const auto spec_sha = spec_sha_at(root, field(event, "sha").is_string() ? &*event.find("sha") : nullptr, spec.is_string() ? &spec : nullptr);
            commit_covered = spec_sha && recorded.is_string() && *spec_sha == recorded.as_string();
            json::Value gate_ok = json::Value(nullptr);
            if (const json::Value* gate = event.find("gate"); gate != nullptr && gate->is_array()) {
                bool all = true;
                for (const auto& check : gate->as_array()) {
                    const json::Value* ok = check.find("ok");
                    if (ok == nullptr || !ok->is_bool() || !ok->as_bool()) all = false;
                }
                gate_ok = json::Value(all);
            }
            json::Value item{json::Object{}};
            item.set("seq", field(event, "seq"));
            item.set("kind", "commit");
            item.set("gateOk", gate_ok);
            item.set("sha", field(event, "sha"));
            item.set("specSha", text_or_null(spec_sha));
            place(row, commit_covered, item, spec_sha ? "after-edit" : "no spec at the commit");
        } else if (kind == "result" && text_or(event.find("tool"), "") == "git_commit") {
            const json::Value* ok = event.find("ok");
            const bool succeeded = ok != nullptr && ok->is_bool() && ok->as_bool();
            json::Value item{json::Object{}};
            item.set("seq", field(event, "seq"));
            item.set("kind", "git_commit");
            item.set("ok", succeeded);
            place(row, succeeded ? commit_covered : true, item, "its commit is after-edit");
        } else if (kind == "end") {
            const auto now = current_spec_sha(root, spec.is_string() ? &spec : nullptr);
            const bool covered = now && recorded.is_string() && *now == recorded.as_string();
            json::Value item{json::Object{}};
            item.set("seq", field(event, "seq"));
            item.set("kind", "end");
            item.set("status", field(event, "status"));
            item.set("witness", field(event, "witness"));
            item.set("specSha", text_or_null(now));
            place(row, covered, item, now ? "after-edit" : "no spec on disk");
        }
    }
    json::Array out;
    for (const auto& row : rows) out.push_back(joined_row(row));
    return json::Value(out);
}

}

bool is_review_verb(std::string_view name) { return name == "review_packet" || name == "review_record" || name == "review_join"; }

json::Value review_call(std::string_view name, const json::Value& args, const std::filesystem::path& workspace, LockedLog& log) {
    const std::string root = workspace.string();
    if (name == "review_packet") {
        return review_packet(args, root, log);
    }
    if (name == "review_record") return review_record(args, root, log);
    if (name == "review_join") {
        const std::string text = pretty(review_join(log, root), 0);
        json::Value reply;
        reply.set("ok", true);
        reply.set("output", text.size() > kOutputPage ? text.substr(0, kOutputPage) + "\n(truncated at " + std::to_string(kOutputPage) + " characters)" : text);
        return reply;
    }
    return failure("unknown review verb: " + std::string(name));
}

}
