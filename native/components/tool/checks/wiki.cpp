#include "gm/tool.hpp"

#include <chrono>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <system_error>

namespace gm::tool {
namespace {

const std::string kBody = R"js(
const source = 'abcdef012345';
const alpha = await gm.wiki_write({ page: 'alpha', title: 'Alpha', body: 'The quick brown fox is cited. Alpha links [[beta]].\n', summary: 'the alpha page', sources: [source], claims: [{ quote: 'quick brown fox', source }] });
const bad = await gm.wiki_write({ page: 'gamma', title: 'Gamma', body: 'x\n', summary: 'the gamma page', sources: [source], claims: [{ quote: 'not in source', source }] });
const beta = await gm.wiki_write({ page: 'beta', title: 'Beta', body: 'Beta links [[alpha]].\n', summary: 'the beta page', sources: [source] });
const hits = await gm.wiki_search({ query: 'brown fox', k: 3 });
const unknown = await gm.wiki_search({ query: 'fox', extra: 1 });
return JSON.stringify({ alpha, bad, beta, hits, unknown });
)js";

bool contains(const std::string& text, const std::string& word) { return text.find(word) != std::string::npos; }

}

CheckResult check_wiki(const std::string& binary) {
    CheckResult result;
    const auto stamp = std::chrono::steady_clock::now().time_since_epoch().count();
    const auto sandbox = std::filesystem::temp_directory_path() / ("gm-wiki-" + std::to_string(stamp));
    const auto workspace = sandbox / "ws";
    std::filesystem::create_directories(workspace / "sources");
    std::ofstream(workspace / "sources" / "abcdef012345.txt") << "the quick brown fox jumps over the lazy dog\n";
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
            session.rpc("tools/call", json::Object{{"name", "finish"}, {"arguments", json::Object{{"witness", "check-wiki"}}}});
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
    expect(contains(text, "wrote wiki/alpha.md, its index entry and its log line"), "a valid wiki_write was not written");
    expect(contains(text, "refused: claim 1: the quote is not in source abcdef012345"), "a claim whose quote is not in its source was not refused");
    expect(!std::filesystem::exists(workspace / "wiki" / "gamma.md"), "a refused page was written");
    expect(contains(text, "wiki/alpha.md:") && contains(text, "brown fox is cited"), "wiki_search did not find the cited line in its page");
    expect(contains(log, "\"kind\":\"lint\"") && contains(log, "\"problems\":[]") && contains(log, "\"pages\":2"), "finish logged a lint with problems or the wrong page count on a consistent wiki");
    expect(contains(text, "refused: unknown argument extra; wiki_search takes query, k, root"), "wiki_search did not refuse an unknown argument by name");
    std::error_code ignored;
    std::filesystem::remove_all(sandbox, ignored);
    result.summary = "a valid page is written with its index and log lines, a claim quote missing from its source is refused and writes nothing, search finds the cited line, and lint is clean on a linked pair";
    return result;
}

}
