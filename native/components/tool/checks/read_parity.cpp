#include "gm/tool.hpp"

#include <chrono>
#include <filesystem>
#include <fstream>
#include <string>
#include <system_error>
#include <utility>
#include <vector>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

constexpr std::chrono::milliseconds kReply{20000};
const std::string kEmoji = "\U0001F600";
const std::string kAccented = "caf\u00e9 na\u00efve \u00fcn\u00efc\u00f6d\u00e9 \u20ac ";
const std::string kReplacement = "\uFFFD";
constexpr int kEmojiAt = 21;
constexpr const char* kDigest = "a2b2b789cd278568";
constexpr int kTotalBytes = 20048;
constexpr int kTotalChars = 20036;

std::string xs(std::size_t count) {
    return std::string(count, 'x');
}

std::string fixture_bytes() {
    return kAccented + kEmoji + "\xff" + "\n" + xs(19999) + kEmoji + "y\ntail ok\n";
}

std::string hint_chars(int offset) {
    return "pass unit: \"chars\", offset: " + std::to_string(offset) + " and limit: 20000 to read the rest";
}

std::string hint_lines(int offset, int limit) {
    return "pass offset: " + std::to_string(offset) + " and limit: " + std::to_string(limit) + " to read the rest";
}

std::string notice(int at, const std::string& hint) {
    return "truncated at " + std::to_string(at) + " of " + std::to_string(kTotalBytes) + " bytes; " + hint;
}

struct Probe {
    std::string label;
    std::string args;
    json::Value expected;
};

json::Value expectation(json::Value unit, int total, int offset, json::Value next, bool truncated, json::Value cut_line, json::Value hint, json::Value note,
                        int out_len, std::string out_head, std::string out_tail) {
    return json::Object{{"ok", true},
                        {"unit", std::move(unit)},
                        {"total", total},
                        {"offset", offset},
                        {"next", next},
                        {"nextOffset", next},
                        {"truncated", truncated},
                        {"totalBytes", kTotalBytes},
                        {"digest", kDigest},
                        {"cutLine", std::move(cut_line)},
                        {"hint", std::move(hint)},
                        {"notice", std::move(note)},
                        {"outLen", out_len},
                        {"outHead", std::move(out_head)},
                        {"outTail", std::move(out_tail)}};
}

std::vector<Probe> probes() {
    const std::string whole_head = kAccented + kEmoji + kReplacement;
    const std::string whole_tail = xs(12) + kEmoji + "y\ntail ok\n";
    const std::string first_line_tail = kAccented.substr(1) + kEmoji + kReplacement + "\n";
    const std::string long_hint = "line 1 is longer than a page: pass unit: \"chars\", offset: 20025 and limit: 20000 to read the rest";
    const std::string inside = kEmoji + kReplacement + "\nxx";
    return {
        {"whole lines", "", expectation("lines", 3, 0, nullptr, false, nullptr, nullptr, nullptr, kTotalChars, whole_head, whole_tail)},
        {"whole chars", ", unit: 'chars'", expectation(nullptr, kTotalChars, 0, nullptr, false, nullptr, nullptr, nullptr, kTotalChars, whole_head, whole_tail)},
        {"chars cut inside an emoji", ", unit: 'chars', offset: 0, limit: " + std::to_string(kEmojiAt + 1),
         expectation(nullptr, kTotalChars, 0, 22, true, nullptr, hint_chars(22), notice(29, hint_chars(22)), 21, kAccented, kAccented)},
        {"chars from inside an emoji", ", unit: 'chars', offset: " + std::to_string(kEmojiAt + 1) + ", limit: 5",
         expectation(nullptr, kTotalChars, 22, 27, true, nullptr, hint_chars(27), notice(10, hint_chars(27)), 6, inside, inside)},
        {"chars page of 20000", ", unit: 'chars', offset: 0, limit: 20000",
         expectation(nullptr, kTotalChars, 0, 20000, true, nullptr, hint_chars(20000), notice(20012, hint_chars(20000)), 20000, whole_head, xs(24))},
        {"lines first page", ", offset: 0",
         expectation("lines", 3, 0, 1, true, nullptr, hint_lines(1, 2), notice(37, hint_lines(1, 2)), 25, whole_head, first_line_tail)},
        {"lines long line cut", ", offset: 1", expectation("lines", 3, 1, 2, true, true, long_hint, notice(19999, long_hint), 19999, xs(24), xs(24))},
        {"lines past the end", ", offset: 9", expectation("lines", 3, 9, nullptr, false, nullptr, nullptr, nullptr, 0, "", "")},
    };
}

std::string probe_body(const std::string& args) {
    return "const r = await gm.read_file({ path: 'fixed.txt'" + args +
           ", full: true, fresh: true }); const out = String(r.output ?? ''); return { ok: r.ok === true, unit: r.unit ?? null, total: r.total ?? null, offset: r.offset ?? null, next: r.next ?? null, nextOffset: r.nextOffset ?? null, truncated: r.truncated ?? null, totalBytes: r.totalBytes ?? null, digest: r.digest ?? null, cutLine: r.cutLine ?? null, hint: r.hint ?? null, notice: r.notice ?? null, outLen: out.length, outHead: out.slice(0, 24), outTail: out.slice(-24) };";
}

json::Value envelope_of(const json::Value& reply) {
    const json::Value* result = reply.find("result");
    const json::Value* content = result ? result->find("content") : nullptr;
    const json::Value* first = content && content->is_array() && !content->as_array().empty() ? content->as_array().front().find("text") : nullptr;
    const std::string text = first && first->is_string() ? first->as_string() : json::dump(reply);
    auto parsed = json::parse(text);
    if (!parsed) return json::Object{{"ok", false}, {"error", "run_code reply was not JSON: " + text.substr(0, 200)}};
    json::Value envelope = *parsed;
    const json::Value* output = envelope.find("output");
    const bool placeholder = output != nullptr && output->is_string() && output->as_string() == "[the output is the text block after this one]";
    if (placeholder && content->as_array().size() > 1) {
        const json::Value* second = content->as_array()[1].find("text");
        const std::string value = second != nullptr && second->is_string() ? second->as_string() : std::string();
        if (auto value_json = json::parse(value)) envelope.set("output", *value_json);
        else envelope.set("output", value);
    }
    return envelope;
}

}

CheckResult check_read_parity(const std::string& binary) {
    CheckResult result;
    const auto started = std::chrono::steady_clock::now();
    const auto stamp = started.time_since_epoch().count();
    const fs::path sandbox = fs::temp_directory_path() / ("gm-read-parity-" + std::to_string(stamp));
    const fs::path workspace = sandbox / "ws";
    fs::create_directories(workspace);
    std::ofstream(sandbox / "quiet.json") << R"({"mcpServers":{"playwriter":{"disabled":true}}})";
    std::ofstream(workspace / "fixed.txt", std::ios::binary) << fixture_bytes();
    const std::vector<Probe> all = probes();
    {
        Session session(binary, workspace, sandbox, 240000, true);
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + binary);
        } else {
            session.rpc("initialize", json::Object{{"protocolVersion", "2025-06-18"}, {"capabilities", json::Object{}},
                                                  {"clientInfo", json::Object{{"name", "gm-read-parity-check"}, {"version", "1"}}}});
            session.notify("notifications/initialized", json::Object{});
            session.rpc("resources/read", json::Object{{"uri", "skill://gm/SKILL.md"}});
            for (const Probe& probe : all) {
                const std::int64_t id = session.send("tools/call", json::Object{{"name", "run_code"},
                                                                                {"arguments", json::Object{{"format", "esm"}, {"timeoutMs", 60000}, {"body", probe_body(probe.args)}}}});
                const auto reply = id < 0 ? std::nullopt : session.await_reply(id, kReply);
                if (!reply) {
                    result.failures.push_back(probe.label + ": no reply within " + std::to_string(kReply.count()) + " ms");
                    continue;
                }
                const json::Value envelope = envelope_of(*reply);
                const json::Value observed = output_value(envelope);
                const json::Value* ok = envelope.find("ok");
                if (ok == nullptr || !ok->is_bool() || !ok->as_bool() || !observed.is_object()) {
                    result.failures.push_back(probe.label + ": the body did not run: " + json::dump(envelope).substr(0, 300));
                    continue;
                }
                for (const auto& [key, want] : probe.expected.as_object()) {
                    const json::Value* found = observed.find(key);
                    const std::string got = found == nullptr ? std::string("null") : json::dump(*found);
                    const std::string wanted = json::dump(want);
                    if (got != wanted) result.failures.push_back(probe.label + ": " + key + " expected " + wanted + ", got " + got);
                }
            }
        }
        session.stop();
    }
    std::error_code ignored;
    fs::remove_all(sandbox, ignored);
    const double wall = std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count();
    result.summary = std::to_string(all.size()) + " read_file probes match the native constants: digest, byte totals, bounded text and notices (wall " + std::to_string(wall) + " s)";
    return result;
}

}
