#include "gm/tool.hpp"

#include <chrono>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <system_error>

namespace gm::tool {
namespace {

const std::string kBody = R"js(
const spec = 'spec.md';
await gm.write_file({ path: spec, content: 'the spec v1\n' });
await gm.write_file({ path: 'ref.txt', content: 'reference\n' });
const first = await gm.review_packet({ spec, refs: ['ref.txt'] });
const packet = JSON.parse(first.output).packet;
const recorded = await gm.review_record({ packet, verdict: 'pass', reviewer: 'fresh-1', notes: 'looks right' });
const twice = await gm.review_record({ packet, verdict: 'pass', reviewer: 'fresh-1' });
const second = await gm.review_packet({ spec });
const badVerdict = await gm.review_record({ packet: JSON.parse(second.output).packet, verdict: 'maybe', reviewer: 'fresh-2' });
const third = await gm.review_packet({ spec });
await gm.write_file({ path: spec, content: 'the spec v2\n' });
const changed = await gm.review_record({ packet: JSON.parse(third.output).packet, verdict: 'pass', reviewer: 'fresh-3' });
const missing = await gm.review_packet({ spec, refs: ['nope.txt'] });
const join = await gm.review_join({});
return JSON.stringify({ first, recorded, twice, badVerdict, changed, missing, join });
)js";

bool contains(const std::string& text, const std::string& word) { return text.find(word) != std::string::npos; }

}

CheckResult check_review(const std::string& binary) {
    CheckResult result;
    const auto stamp = std::chrono::steady_clock::now().time_since_epoch().count();
    const auto sandbox = std::filesystem::temp_directory_path() / ("gm-review-" + std::to_string(stamp));
    const auto workspace = sandbox / "ws";
    std::filesystem::create_directories(workspace);
    std::string text;
    std::string log;
    {
        Session session(binary, workspace, sandbox);
        if (!session.started()) result.failures.push_back("gm serve did not start from " + binary);
        if (session.started()) {
            session.rpc("initialize", json::Object{{"protocolVersion", "2025-06-18"}, {"capabilities", json::Object{}},
                                                  {"clientInfo", json::Object{{"name", "gm-tool"}, {"version", "1"}}}});
            session.notify("notifications/initialized", json::Object{});
            session.rpc("resources/read", json::Object{{"uri", "skill://gm/SKILL.md"}});
            session.rpc("tools/call", json::Object{{"name", "next_context"}, {"arguments", json::Object{}}});
            text = session.body(kBody);
        }
        session.stop();
    }
    {
        std::ifstream in(workspace / "runs" / "check" / "log.jsonl");
        std::ostringstream all;
        all << in.rdbuf();
        log = all.str();
    }
    auto expect = [&](bool condition, const std::string& what) {
        if (!condition) result.failures.push_back(what + ": " + text.substr(0, 400));
    };
    expect(contains(text, "\"first\":{\"ok\":true"), "review_packet did not open a packet for an existing spec");
    expect(contains(text, "\"recorded\":{\"ok\":true"), "review_record did not record a pass on a fresh packet");
    expect(contains(log, "\"kind\":\"review\""), "review_record did not log its review");
    expect(contains(text, "refused: packet ") && contains(text, "already has a record"), "a second record on a packet was not refused");
    expect(contains(text, "refused: verdict must be one of pass, fail, needs-changes"), "an unknown verdict was not refused");
    expect(contains(text, "refused: the spec changed since packet"), "a record after the spec changed was not refused");
    expect(contains(text, "refused: referenced paths do not exist: nope.txt"), "a packet with a missing reference was not refused");
    expect(contains(text, "fresh-1"), "review_join did not show the recorded reviewer");
    std::error_code ignored;
    std::filesystem::remove_all(sandbox, ignored);
    result.summary = "a packet opens on an existing spec, a verdict is recorded and logged, and a second record, an unknown verdict, a changed spec and a missing reference are refused, with the join showing the reviewer";
    return result;
}

}
