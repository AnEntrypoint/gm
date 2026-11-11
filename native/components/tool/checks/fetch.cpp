#include "gm/tool.hpp"

#include <chrono>
#include <filesystem>
#include <system_error>

namespace gm::tool {
namespace {

const std::string kBody = R"js(
const out = {};
out.plain = await gm.fetch({ url: 'data:text/plain,hello%20world' });
out.cut = await gm.fetch({ url: 'data:text/plain,abcdefghij', maxBytes: 4 });
out.match = await gm.fetch({ url: 'data:text/plain,a%0Ab%0Aa2', match: '^a' });
out.base64 = await gm.fetch({ url: 'data:text/plain;base64,aGk=' });
out.invalid = await gm.fetch({ url: 'not a url' });
out.timeout = await gm.fetch({ url: 'data:text/plain,x', timeoutMs: 0 });
out.refused = await gm.fetch({ url: 'http://127.0.0.1:1/' });
return JSON.stringify(out);
)js";

bool contains(const std::string& text, const std::string& word) { return text.find(word) != std::string::npos; }

}

CheckResult check_fetch(const std::string& binary) {
    CheckResult result;
    const auto stamp = std::chrono::steady_clock::now().time_since_epoch().count();
    const auto sandbox = std::filesystem::temp_directory_path() / ("gm-fetch-" + std::to_string(stamp));
    const auto workspace = sandbox / "ws";
    std::filesystem::create_directories(workspace);
    std::string text;
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
    auto expect = [&](bool condition, const std::string& what) {
        if (!condition) result.failures.push_back(what + ": " + text.substr(0, 400));
    };
    expect(contains(text, "200 11 bytes data:text/plain,hello%20world\\nhello world"), "a data URL was not returned as its text body");
    expect(contains(text, "body truncated to 4 bytes of 10 bytes"), "maxBytes did not cut the body with its marker");
    expect(contains(text, "a\\na2"), "match did not keep only the lines that match, in order");
    expect(contains(text, "base64 data URLs are not supported"), "a base64 data URL was not refused");
    expect(contains(text, "url is not a valid URL"), "an invalid url was not refused");
    expect(contains(text, "timeoutMs must be an integer from 1 to 60000"), "timeoutMs 0 was not refused");
    expect(contains(text, "\"attempts\":4") && contains(text, "\"exhausted\":true"), "an unreachable host did not make 4 attempts (1 + 3 retries) and report exhaustion");
    expect(contains(text, "ECONNREFUSED"), "an unreachable host did not report ECONNREFUSED");
    std::error_code ignored;
    std::filesystem::remove_all(sandbox, ignored);
    result.summary = "data URLs return their text, cut and match, refuse base64 and bad input, and an unreachable host retries 3 times then reports exhaustion";
    return result;
}

}
