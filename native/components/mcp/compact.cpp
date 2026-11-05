#include <regex>
#include <set>

#include "internal.hpp"

namespace gm::mcp::detail {

namespace {

constexpr std::size_t kEventsCap = 20000;
constexpr std::uint64_t kHorizon1 = 14;
constexpr std::uint64_t kHorizon2 = 12;
constexpr std::size_t kArgCap = 200;
constexpr std::size_t kArgHead = 80;
constexpr std::size_t kListCap = 10;
constexpr std::size_t kDigestErrors = 10;
constexpr std::size_t kFailedHeadChars = 1000;
constexpr std::size_t kArrayOverhead = 2;

const std::set<std::string> kSkip = {"t", "mono", "inFlight", "startMono", "durMs", "actionSeq", "step"};
const std::set<std::string> kKeepWhole = {"witness", "error", "reason", "gate", "gaps", "paths"};
const std::set<std::string> kKeepZone2 = {"end",  "commit", "refusal", "error",  "restart",     "job-killed", "review",
                                          "review-packet", "review-refused", "lint", "wiki", "recovery", "abandoned", "parse_error"};
const std::set<std::string> kCutInZone2 = {"list_dir", "query_log", "prd_list", "unknown_list", "callers", "impact", "git_log",
                                           "git_diff", "git_show", "review_join", "search",    "grep",    "wiki_search"};

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

std::size_t cost_of(const Value& v) { return js_length(json::dump(v)) + 1; }

std::string string_field(const Value& v, const char* key) {
    const Value* f = v.find(key);
    return f && f->is_string() ? f->as_string() : "";
}

void copy_if(Value& into, const Value& from, const char* key, const char* as = nullptr) {
    if (const Value* v = from.find(key)) into.set(as ? as : key, *v);
}

bool failed_of(const Value& event) {
    const Value* ok = event.find("ok");
    const Value* exit = event.find("exitCode");
    return (ok && ok->is_bool() && !ok->as_bool()) || (exit && exit->is_number() && exit->as_number() != 0);
}

std::optional<Value> digest_of(const Value& event) {
    if (const Value* digest = event.find("outputDigest")) return *digest;
    const Value* output = event.find("output");
    if (output && output->is_string()) return output_digest(output->as_string(), failed_of(event));
    return std::nullopt;
}

Value full_of(const Value& event) {
    double bytes = 0;
    const Value* digest = event.find("outputDigest");
    const Value* digest_bytes = digest ? digest->find("bytes") : nullptr;
    if (digest_bytes) bytes = digest_bytes->as_number();
    else if (const Value* output = event.find("output"); output && output->is_string()) bytes = static_cast<double>(output->as_string().size());
    return object().set("seq", *event.find("seq")).set("bytes", bytes);
}

const Value* args_in(const Value* action) { return action ? action->find("args") : nullptr; }

Value result_record(const Value& event, const Value* action, int zone) {
    Value record = object().set("seq", *event.find("seq"));
    copy_if(record, event, "tool");
    copy_if(record, event, "ok");
    record.set("args", args_of(args_in(action)));
    copy_if(record, event, "exitCode", "exit");
    copy_if(record, event, "error");
    if (zone == 1) {
        if (auto digest = digest_of(event)) record.set("out", *digest);
    }
    record.set("full", full_of(event));
    return record;
}

std::optional<double> bytes_of(const Value* text) {
    if (text == nullptr || !text->is_string()) return std::nullopt;
    return static_cast<double>(text->as_string().size());
}

Value path_and_sizes(const Value* action, std::initializer_list<std::pair<const char*, const char*>> sizes) {
    Value out = object();
    const Value* args = args_in(action);
    if (args) copy_if(out, *args, "path");
    for (const auto& [arg, name] : sizes) {
        if (auto bytes = bytes_of(args ? args->find(arg) : nullptr)) out.set(name, *bytes);
    }
    return out;
}

Value finish_record(const Value& event, const Value* action) {
    Value record = object().set("seq", *event.find("seq")).set("tool", "finish");
    copy_if(record, event, "ok");
    if (const Value* args = args_in(action)) {
        copy_if(record, *args, "witness");
        copy_if(record, *args, "gaps");
    }
    record.set("full", object().set("seq", *event.find("seq")).set("bytes", bytes_of(event.find("output")).value_or(0)));
    return record;
}

std::optional<Value> packet_of(const Value& event) {
    const Value* output = event.find("output");
    if (!output || !output->is_string()) return std::nullopt;
    auto parsed = json::parse(output->as_string());
    if (!parsed) return std::nullopt;
    const Value* packet = parsed->find("packet");
    return packet ? std::optional<Value>(*packet) : std::nullopt;
}

std::optional<Value> tool_record(const Value& event, const Value* action, int zone) {
    std::string tool = string_field(event, "tool");
    if (tool == "finish") return finish_record(event, action);
    if (zone == 2 && kCutInZone2.contains(tool)) return std::nullopt;
    if (zone == 2 && tool == "wiki_write") {
        Value record = object().set("seq", *event.find("seq")).set("tool", "wiki_write");
        copy_if(record, event, "ok");
        const Value* args = args_in(action);
        if (args) copy_if(record, *args, "page");
        const Value* claims = args ? args->find("claims") : nullptr;
        record.set("claims", claims && claims->is_array() ? number_of(claims->as_array().size()) : number(0));
        record.set("full", object().set("seq", *event.find("seq")).set("bytes", bytes_of(event.find("output")).value_or(0)));
        return record;
    }
    Value record = result_record(event, action, zone);
    if (tool == "write_file") record.set("args", path_and_sizes(action, {{"content", "bytes"}}));
    if (tool == "edit_file") record.set("args", path_and_sizes(action, {{"old", "oldBytes"}, {"new", "newBytes"}}));
    if (tool == "fetch") {
        copy_if(record, event, "source");
        copy_if(record, event, "sourceNew");
    }
    if (tool == "review_packet" && zone == 2) {
        if (auto packet = packet_of(event)) record.set("packet", *packet);
    }
    return record;
}

Value short_kind(const Value& event) {
    Value record = object().set("seq", *event.find("seq")).set("kind", *event.find("kind"));
    for (const json::Member& m : event.as_object()) {
        if (kSkip.contains(m.first) || m.first == "seq" || m.first == "kind") continue;
        record.set(m.first, m.second.is_string() ? Value(clip(m.second.as_string(), kArgCap)) : m.second);
    }
    return record;
}

std::optional<Value> kept_kind(const Value& event) {
    if (!kKeepZone2.contains(string_field(event, "kind"))) return std::nullopt;
    Value record = object().set("seq", *event.find("seq")).set("kind", *event.find("kind"));
    for (const json::Member& m : event.as_object()) {
        if (kSkip.contains(m.first) || m.first == "seq" || m.first == "kind") continue;
        bool whole = kKeepWhole.contains(m.first) || !m.second.is_string();
        record.set(m.first, whole ? m.second : Value(clip(m.second.as_string(), kArgCap)));
    }
    return record;
}

std::uint64_t seq_of(const Value& event) {
    const Value* seq = event.find("seq");
    return seq ? static_cast<std::uint64_t>(seq->as_number()) : 0;
}

std::optional<Value> record_of(const Value& event, int zone, const EventAt& at, const std::set<std::uint64_t>& answered) {
    std::string kind = string_field(event, "kind");
    if (kind == "action") {
        if (answered.contains(seq_of(event)) || zone != 1) return std::nullopt;
        return object()
            .set("seq", *event.find("seq"))
            .set("kind", "action")
            .set("tool", event.find("tool") ? *event.find("tool") : Value())
            .set("args", args_of(event.find("args")))
            .set("unanswered", true);
    }
    if (kind == "result" || kind == "code-call") {
        const Value* action = nullptr;
        if (kind == "code-call") action = &event;
        else if (const Value* seq = event.find("actionSeq")) action = at(static_cast<std::uint64_t>(seq->as_number()));
        return tool_record(event, action, zone);
    }
    if (kind == "code-load") {
        if (zone == 2) return std::nullopt;
        return short_kind(event);
    }
    if (zone == 1) return short_kind(event);
    return kept_kind(event);
}

Value fresh_record_of(const Value& event, const EventAt& at) {
    if (string_field(event, "kind") == "action") {
        return object()
            .set("seq", *event.find("seq"))
            .set("kind", "action")
            .set("tool", event.find("tool") ? *event.find("tool") : Value())
            .set("args", args_of(event.find("args")));
    }
    static const std::set<std::uint64_t> none;
    auto record = record_of(event, 1, at, none);
    return record ? *record : short_kind(event);
}

struct Fresh {
    std::uint64_t index;
    const Value* event;
    std::size_t cost;
    Value record;
    std::size_t record_cost;
};

struct Seen {
    std::uint64_t index;
    Value item;
    std::size_t cost;
};

struct Plan {
    std::size_t full = 0;
    std::vector<Value> items;
    std::size_t used = 0;
};

Value range_of(const std::vector<Fresh>& fresh, std::size_t k, std::uint64_t last_seq) {
    Value seqs = array();
    seqs.push(number_of(fresh[k].index + 1));
    seqs.push(number_of(last_seq));
    return object().set("kind", "range").set("seqs", std::move(seqs)).set("count", number_of(last_seq - fresh[k].index));
}

Plan plan_fresh(const std::vector<Fresh>& fresh, std::uint64_t last_seq, std::size_t room) {
    auto tail_cost = [&](std::size_t k) { return k == fresh.size() ? 0 : cost_of(range_of(fresh, k, last_seq)); };
    std::size_t record_total = 0;
    for (const auto& entry : fresh) record_total += entry.record_cost;
    Plan plan;
    if (record_total <= room) {
        std::size_t spare = room - record_total;
        while (plan.full < fresh.size() && fresh[plan.full].cost - fresh[plan.full].record_cost <= spare) {
            spare -= fresh[plan.full].cost - fresh[plan.full].record_cost;
            plan.full += 1;
        }
        for (std::size_t i = 0; i < fresh.size(); ++i) plan.items.push_back(i < plan.full ? *fresh[i].event : fresh[i].record);
        plan.used = room - spare;
        return plan;
    }
    std::size_t used = 0;
    while (plan.full < fresh.size() && used + fresh[plan.full].cost + tail_cost(plan.full + 1) <= room) {
        used += fresh[plan.full].cost;
        plan.full += 1;
    }
    for (std::size_t i = 0; i < plan.full; ++i) plan.items.push_back(*fresh[i].event);
    if (plan.full < fresh.size()) {
        Value tail = range_of(fresh, plan.full, last_seq);
        used += cost_of(tail);
        plan.items.push_back(std::move(tail));
    }
    plan.used = used;
    return plan;
}

}

std::string clip(const std::string& text, std::size_t cap) {
    std::size_t length = js_length(text);
    if (length <= cap) return text;
    return js_prefix(text, cap) + " ...[" + std::to_string(length) + " chars]";
}

Value output_digest(const std::string& text, bool failed) {
    if (text.empty()) return object().set("lines", 0).set("bytes", 0);
    static const std::regex kError(R"(\b(error|errors|fail|failed|failure|fatal|warn|warning|exception|traceback|denied|not ok)\b)",
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

Value args_of(const Value* args) {
    Value out = object();
    if (args == nullptr || !args->is_object()) return out;
    for (const json::Member& m : args->as_object()) {
        if (m.second.is_string()) {
            const std::string& text = m.second.as_string();
            std::size_t length = js_length(text);
            out.set(m.first, length <= kArgCap ? m.second : object().set("chars", number_of(length)).set("head", clip(text, kArgHead)));
        } else if (m.second.is_array()) {
            std::size_t items = m.second.as_array().size();
            out.set(m.first, items <= kListCap ? m.second : object().set("items", number_of(items)));
        } else {
            out.set(m.first, m.second);
        }
    }
    return out;
}

Value feed_of(const EventAt& at, std::uint64_t count, std::uint64_t shown) {
    std::uint64_t new_start = std::min(shown, count);
    std::uint64_t zone1_start = new_start > kHorizon1 ? new_start - kHorizon1 : 0;
    std::uint64_t zone2_start = zone1_start > kHorizon2 ? zone1_start - kHorizon2 : 0;
    std::set<std::uint64_t> answered;
    for (std::uint64_t seq = zone2_start + 1; seq <= count; ++seq) {
        const Value* event = at(seq);
        if (event == nullptr) continue;
        if (const Value* action = event->find("actionSeq")) answered.insert(static_cast<std::uint64_t>(action->as_number()));
    }
    std::vector<Seen> seen;
    for (std::uint64_t i = zone2_start; i < new_start; ++i) {
        const Value* event = at(i + 1);
        if (event == nullptr) continue;
        auto record = record_of(*event, i >= zone1_start ? 1 : 2, at, answered);
        if (record) {
            std::size_t cost = cost_of(*record);
            seen.push_back({i, std::move(*record), cost});
        }
    }
    std::vector<Fresh> fresh;
    for (std::uint64_t i = new_start; i < count; ++i) {
        const Value* event = at(i + 1);
        if (event == nullptr) continue;
        Value record = fresh_record_of(*event, at);
        std::size_t record_cost = cost_of(record);
        fresh.push_back({i, event, cost_of(*event), std::move(record), record_cost});
    }
    std::size_t room = kEventsCap - kArrayOverhead;
    Plan plan = plan_fresh(fresh, count, room);
    std::size_t spare = room - std::min(room, plan.used);
    std::size_t first_kept = seen.size();
    while (first_kept > 0 && seen[first_kept - 1].cost <= spare) {
        spare -= seen[first_kept - 1].cost;
        first_kept -= 1;
    }
    Value items = array();
    for (std::size_t j = first_kept; j < seen.size(); ++j) items.push(seen[j].item);
    for (auto& item : plan.items) items.push(std::move(item));
    std::size_t records = items.as_array().size();
    return object()
        .set("older", number_of(first_kept < seen.size() ? seen[first_kept].index : new_start))
        .set("records", number_of(records))
        .set("fullEvents", number_of(plan.full))
        .set("compactFrom", plan.full < fresh.size() ? number_of(fresh[plan.full].index + 1) : Value(nullptr))
        .set("events", std::move(items));
}

}
