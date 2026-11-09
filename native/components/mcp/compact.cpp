#include <algorithm>
#include <initializer_list>
#include <regex>
#include <set>
#include <utility>

#include "internal.hpp"

namespace gm::mcp::detail {

namespace {

constexpr std::size_t kEventsCap = 20000;
constexpr std::size_t kArgCap = 200;
constexpr std::size_t kArgHead = 80;
constexpr std::size_t kListCap = 10;
constexpr std::size_t kDigestErrors = 10;
constexpr std::size_t kFailedHeadChars = 1000;
constexpr std::size_t kArrayOverhead = 2;
constexpr std::size_t kEventCap = 2000;
constexpr std::size_t kEventHead = 160;
constexpr std::size_t kEventTail = 80;
constexpr std::size_t kEventTextCap = 200;
constexpr std::size_t kEventArgsCap = 8;
constexpr std::size_t kDigestLines = 2;
constexpr std::size_t kDigestClip = 120;
constexpr const char* kFeedReach = "query_log reads any event (after: seq - 1 returns it first)";
constexpr std::size_t kCutRefsCap = 4;
constexpr const char* kCutRefQuery = "gm.query_log({ seq, field, offset, limit, unit: \"chars\" })";
constexpr const char* kChildReach = "gm.query_log({ after: seqs[0] - 1 }) reaches every event in this range";

const std::set<std::string> kSkip = {"t", "mono", "inFlight", "startMono", "durMs", "actionSeq", "step"};

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

std::string js_suffix(std::string_view text, std::size_t units) {
    std::size_t length = js_length(text);
    std::size_t skip = length > units ? length - units : 0;
    return std::string(text.substr(js_prefix(text, skip).size()));
}

std::string head_tail(const std::string& text, std::size_t head, std::size_t tail) {
    std::size_t length = js_length(text);
    if (length <= head + tail) return text;
    return js_prefix(text, head) + " ...[" + std::to_string(length - head - tail) + " chars cut; " + kFeedReach + "] ..." +
           js_suffix(text, tail);
}

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

Value clipped_lines(const Value* values, std::size_t take, bool tail) {
    Value out = array();
    if (values == nullptr || !values->is_array()) return out;
    const auto& items = values->as_array();
    std::size_t from = tail && items.size() > take ? items.size() - take : 0;
    std::size_t to = tail ? items.size() : std::min(take, items.size());
    for (std::size_t i = from; i < to; ++i) {
        std::string text = items[i].is_string() ? items[i].as_string() : json::dump(items[i]);
        out.push(Value(clip(text, kDigestClip)));
    }
    return out;
}

Value compact_digest(const Value* digest) {
    Value out = object().set("lines", number(0)).set("bytes", number(0)).set("head", array()).set("tail", array());
    if (digest == nullptr || !digest->is_object()) return out;
    copy_if(out, *digest, "lines");
    copy_if(out, *digest, "bytes");
    out.set("head", clipped_lines(digest->find("head"), kDigestLines, false));
    out.set("tail", clipped_lines(digest->find("tail"), kDigestLines, true));
    const Value* errors = digest->find("errors");
    if (errors && errors->is_array()) {
        out.set("errors", clipped_lines(errors, kDigestLines, false));
        std::size_t more = errors->as_array().size() > kDigestLines ? errors->as_array().size() - kDigestLines : 0;
        if (const Value* given = digest->find("moreErrors"); given && given->is_number()) more += static_cast<std::size_t>(given->as_number());
        if (more > 0) out.set("moreErrors", number_of(more));
    }
    const Value* all = digest->find("all");
    if (all && all->is_array()) {
        out.set("all", clipped_lines(all, kDigestLines, false));
        std::size_t more = all->as_array().size() > kDigestLines ? all->as_array().size() - kDigestLines : 0;
        if (const Value* given = digest->find("more"); given && given->is_number()) more += static_cast<std::size_t>(given->as_number());
        if (more > 0) out.set("more", number_of(more));
    }
    return out;
}

Value bounded_args(const Value* args) {
    Value compact = args_of(args);
    const auto& members = compact.as_object();
    if (members.size() <= kEventArgsCap) return compact;
    Value out = object();
    for (std::size_t i = 0; i < kEventArgsCap; ++i) out.set(members[i].first, members[i].second);
    out.set("more", number_of(members.size() - kEventArgsCap));
    return out;
}

void put_if_fits(Value& out, const char* key, Value value, std::size_t cap) {
    Value candidate = out;
    candidate.set(key, std::move(value));
    if (cost_of(candidate) <= cap) out = std::move(candidate);
}

Value cut_refs_of(const Value& item) {
    Value refs = array();
    std::size_t omitted = 0;
    std::uint64_t seq = item.find("seq") && item.find("seq")->is_number() ? static_cast<std::uint64_t>(item.find("seq")->as_number()) : 0;
    auto add = [&](const std::string& path, const std::string& text, std::size_t cap) {
        if (js_length(text) <= cap) return;
        if (refs.as_array().size() >= kCutRefsCap) { ++omitted; return; }
        refs.push(object().set("seq", number_of(seq)).set("path", path).set("chars", number_of(js_length(text)))
                      .set("cap", number_of(cap)).set("offset", number(0)).set("limit", number_of(js_length(text)))
                      .set("query", Value(kCutRefQuery)));
    };
    for (const char* key : {"output", "error", "witness", "reason", "body", "message", "task"}) {
        const Value* field = item.find(key);
        if (field != nullptr && field->is_string()) add(key, field->as_string(), kEventTextCap);
    }
    if (const Value* args = item.find("args"); args != nullptr && args->is_object()) {
        for (const json::Member& member : args->as_object()) {
            if (member.second.is_string()) add("args." + member.first, member.second.as_string(), kArgCap);
        }
    }
    Value out = object().set("cutRefs", refs);
    if (omitted > 0) out.set("cutRefsOmitted", number_of(omitted));
    return out;
}

Value bounded_item(const Value& item, std::size_t cap = kEventCap) {
    std::size_t original = cost_of(item);
    if (original <= cap) return item;
    Value out = object();
    auto put = [&](const char* key, Value value) { put_if_fits(out, key, std::move(value), cap); };
    for (const char* key : {"seq", "t", "kind", "tool", "ok", "exitCode", "exit", "signal", "actionSeq", "step", "full", "unanswered"}) {
        if (const Value* field = item.find(key)) put(key, *field);
    }
    Value cut = object()
                    .set("seq", item.find("seq") ? *item.find("seq") : Value(nullptr))
                    .set("chars", number_of(original))
                    .set("reach", Value(kFeedReach));
    put("feedCut", std::move(cut));
    const Value* output = item.find("output");
    if (output && output->is_string()) {
        put("output", Value(head_tail(output->as_string(), kEventHead, kEventTail)));
        double chars = 0;
        if (const Value* given = item.find("outputChars"); given && given->is_number()) chars = given->as_number();
        else if (auto digest = digest_of(item); digest && digest->is_object()) {
            const Value* bytes = digest->find("bytes");
            chars = bytes && bytes->is_number() ? bytes->as_number() : static_cast<double>(js_length(output->as_string()));
        } else chars = static_cast<double>(js_length(output->as_string()));
        put("outputChars", number(chars));
        if (auto digest = digest_of(item)) {
            Value compact = compact_digest(&*digest);
            put("outputDigest", std::move(compact));
        }
    } else {
        std::string text = json::dump(item);
        put("head", Value(js_prefix(text, kEventHead)));
        put("tail", Value(js_suffix(text, kEventTail)));
        put("textChars", number(static_cast<double>(js_length(text))));
        Value digest = output_digest(text, failed_of(item));
        Value compact = compact_digest(&digest);
        put("textDigest", std::move(compact));
    }
    if (const Value* digest = item.find("out")) {
        Value compact = compact_digest(digest);
        put("out", std::move(compact));
    }
    if (const Value* args = item.find("args")) {
        Value compact = bounded_args(args);
        put("args", std::move(compact));
    }
    for (const char* key : {"body", "error", "witness", "reason", "gate", "gaps", "paths", "task", "source", "sourceNew"}) {
        const Value* field = item.find(key);
        if (field == nullptr) continue;
        if (field->is_string()) put(key, Value(clip(field->as_string(), kEventTextCap)));
        else if (field->is_array()) put(key, object().set("items", number_of(field->as_array().size())));
        else if (field->is_number() || field->is_bool()) put(key, *field);
    }
    Value refs = cut_refs_of(item);
    if (const Value* values = refs.find("cutRefs"); values != nullptr && !values->as_array().empty()) put_if_fits(out, "cutRefs", *values, cap);
    if (const Value* omitted = refs.find("cutRefsOmitted")) put_if_fits(out, "cutRefsOmitted", *omitted, cap);
    return out;
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

Value result_record(const Value& event, const Value* action) {
    Value record = object().set("seq", *event.find("seq"));
    copy_if(record, event, "tool");
    copy_if(record, event, "ok");
    record.set("args", args_of(args_in(action)));
    copy_if(record, event, "exitCode", "exit");
    copy_if(record, event, "error");
    if (auto digest = digest_of(event)) record.set("out", *digest);
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

std::optional<Value> tool_record(const Value& event, const Value* action) {
    std::string tool = string_field(event, "tool");
    if (tool == "finish") return finish_record(event, action);
    Value record = result_record(event, action);
    if (tool == "write_file") record.set("args", path_and_sizes(action, {{"content", "bytes"}}));
    if (tool == "edit_file") record.set("args", path_and_sizes(action, {{"old", "oldBytes"}, {"new", "newBytes"}}));
    if (tool == "fetch") {
        copy_if(record, event, "source");
        copy_if(record, event, "sourceNew");
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

std::uint64_t seq_of(const Value& event) {
    const Value* seq = event.find("seq");
    return seq ? static_cast<std::uint64_t>(seq->as_number()) : 0;
}

std::optional<Value> record_of(const Value& event, const EventAt& at) {
    std::string kind = string_field(event, "kind");
    if (kind == "result" || kind == "code-call") {
        const Value* action = nullptr;
        if (kind == "code-call") action = &event;
        else if (const Value* seq = event.find("actionSeq")) action = at(static_cast<std::uint64_t>(seq->as_number()));
        return tool_record(event, action);
    }
    return short_kind(event);
}

Value fresh_record_of(const Value& event, const EventAt& at) {
    if (string_field(event, "kind") == "action") {
        return object()
            .set("seq", *event.find("seq"))
            .set("kind", "action")
            .set("tool", event.find("tool") ? *event.find("tool") : Value())
            .set("args", args_of(event.find("args")));
    }
    auto record = record_of(event, at);
    return record ? *record : short_kind(event);
}

struct ChildMark {
    std::uint64_t index;
    std::uint64_t seq;
    std::string kind;
    std::string tool;
};

std::optional<ChildMark> child_mark_of(const Value& event, std::uint64_t index) {
    std::string kind = string_field(event, "kind");
    std::string tool = string_field(event, "tool");
    const Value* body = event.find("body");
    bool child = kind == "code-call" || kind == "code-load" || kind == "generation" ||
                 (kind == "action" && (tool == "run_code" || (body && body->is_number()))) ||
                 (kind == "result" && tool == "run_code");
    if (!child) return std::nullopt;
    std::uint64_t seq = seq_of(event);
    return ChildMark{index, seq == 0 ? index + 1 : seq, std::move(kind), std::move(tool)};
}

Value child_summary(const std::vector<ChildMark>& marks) {
    Value counts = object();
    for (const ChildMark& mark : marks) {
        std::string key = mark.tool.empty() ? mark.kind : mark.kind + ":" + mark.tool;
        const Value* current = counts.find(key);
        counts.set(std::move(key), number(current && current->is_number() ? current->as_number() + 1 : 1));
    }
    Value seqs = array();
    seqs.push(number_of(marks.front().seq));
    seqs.push(number_of(marks.back().seq));
    return object()
        .set("kind", "child-range")
        .set("seqs", std::move(seqs))
        .set("count", number_of(marks.size()))
        .set("counts", std::move(counts))
        .set("query", object()
                          .set("after", number_of(marks.front().seq > 0 ? marks.front().seq - 1 : 0))
                          .set("note", Value(kChildReach)));
}

struct Fresh {
    std::uint64_t index;
    Value shown;
    std::size_t cost;
    Value record;
    std::size_t record_cost;
    std::optional<ChildMark> child;
};

std::vector<Fresh> collapse_fresh(const std::vector<Fresh>& fresh) {
    std::vector<Fresh> out;
    std::vector<ChildMark> group;
    auto flush = [&]() {
        if (group.empty()) return;
        Value item = bounded_item(child_summary(group));
        std::size_t cost = cost_of(item);
        out.push_back({group.back().index, item, cost, item, cost, std::nullopt});
        group.clear();
    };
    for (const Fresh& entry : fresh) {
        if (entry.child) {
            group.push_back(*entry.child);
            continue;
        }
        flush();
        out.push_back(entry);
    }
    flush();
    return out;
}

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
        while (plan.full < fresh.size()) {
            std::size_t delta = fresh[plan.full].cost > fresh[plan.full].record_cost ? fresh[plan.full].cost - fresh[plan.full].record_cost : 0;
            if (delta > spare) break;
            spare -= delta;
            plan.full += 1;
        }
        for (std::size_t i = 0; i < fresh.size(); ++i) plan.items.push_back(i < plan.full ? fresh[i].shown : fresh[i].record);
        plan.used = room - spare;
        return plan;
    }
    std::size_t used = 0;
    while (plan.full < fresh.size() && used + fresh[plan.full].cost + tail_cost(plan.full + 1) <= room) {
        used += fresh[plan.full].cost;
        plan.full += 1;
    }
    for (std::size_t i = 0; i < plan.full; ++i) plan.items.push_back(fresh[i].shown);
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
    static const std::regex kCommitStatus(R"(^\[[^\]]+ [0-9a-fA-F]{4,40}\]\s.*$)", std::regex::ECMAScript);
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
    if (failed) {
        std::vector<std::string> errors;
        for (const auto& line : lines) {
            if (std::regex_search(line, kError) && !std::regex_match(line, kCommitStatus)) errors.push_back(line);
        }
        if (!errors.empty()) {
            Value shown = array();
            for (std::size_t i = 0; i < std::min(errors.size(), kDigestErrors); ++i) shown.push(clip(errors[i]));
            digest.set("errors", std::move(shown));
            if (errors.size() > kDigestErrors) digest.set("moreErrors", number_of(errors.size() - kDigestErrors));
        }
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

Value feed_of(const EventAt& at, std::uint64_t count, std::uint64_t shown, bool compact_children) {
    std::uint64_t new_start = std::min(shown, count);
    std::vector<Fresh> fresh;
    for (std::uint64_t i = new_start; i < count; ++i) {
        const Value* event = at(i + 1);
        if (event == nullptr) continue;
        Value bounded = bounded_item(*event);
        std::size_t bounded_cost = cost_of(bounded);
        Value record = bounded_item(fresh_record_of(*event, at));
        std::size_t record_cost = cost_of(record);
        std::optional<ChildMark> child;
        if (compact_children) child = child_mark_of(*event, i);
        fresh.push_back({i, std::move(bounded), bounded_cost, std::move(record), record_cost, std::move(child)});
    }
    if (compact_children) fresh = collapse_fresh(fresh);
    std::size_t room = kEventsCap - kArrayOverhead;
    Plan plan = plan_fresh(fresh, count, room);
    Value items = array();
    for (auto& item : plan.items) items.push(std::move(item));
    std::size_t records = items.as_array().size();
    return object()
        .set("older", number_of(new_start))
        .set("records", number_of(records))
        .set("fullEvents", number_of(plan.full))
        .set("compactFrom", plan.full < fresh.size() ? number_of(fresh[plan.full].index + 1) : Value(nullptr))
        .set("events", std::move(items));
}

}
