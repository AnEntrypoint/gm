#include "gm/tool.hpp"

#include <chrono>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <system_error>

namespace gm::tool {
namespace {

const std::string kBody = R"js(
await gm.run_shell({ command: 'git init -q' });
await gm.write_file({ path: 'lib/util.js', content: 'export function helper(x) {\n  return x + 1;\n}\n' });
await gm.write_file({ path: 'app.js', content: "import { helper } from './lib/util.js';\nconst value = helper(2);\nconsole.log(value);\n" });
await gm.write_file({ path: 'util.ts', content: 'export function typed(x: number): number {\n  return x;\n}\nexport const twice: number = typed(2);\n' });
await gm.write_file({ path: 'broken.js', content: 'function broken( {\n  helper(1);\n' });
const calls = await gm.callers({ name: 'helper' });
const impact = await gm.impact({ name: 'helper', depth: 2 });
const typed = await gm.callers({ name: 'typed' });
const keyword = await gm.callers({ name: 'return' });
const badLimit = await gm.callers({ name: 'helper', limit: 0 });
const badDepth = await gm.impact({ name: 'helper', depth: 9 });
return JSON.stringify({ calls, impact, typed, keyword, badLimit, badDepth });
)js";

bool contains(const std::string& text, const std::string& word) { return text.find(word) != std::string::npos; }

}

CheckResult check_code_ast(const std::string& binary) {
    CheckResult result;
    const auto stamp = std::chrono::steady_clock::now().time_since_epoch().count();
    const auto sandbox = std::filesystem::temp_directory_path() / ("gm-code-ast-" + std::to_string(stamp));
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
        if (!condition) result.failures.push_back(what + ": " + text.substr(0, 600));
    };
    expect(contains(text, "app.js:2 [linked] const value = helper(2);"), "callers did not report the linked call in app.js");
    expect(contains(text, "broken.js:2 [direct, line scan] helper(1);"), "callers did not scan the file that does not parse by lines");
    expect(contains(text, "util.ts:4 [direct] export const twice: number = typed(2);"), "callers did not find the call in a TypeScript file");
    expect(contains(text, "defines: lib/util.js"), "impact did not list the defining file");
    expect(contains(text, "calls: app.js, broken.js"), "impact did not list the calling files");
    expect(contains(text, "keyword, so it has no callers to list"), "a keyword name was not refused");
    expect(contains(text, "limit must be an integer from 1 to 1000"), "a limit of 0 was not refused");
    expect(contains(text, "depth must be an integer from 0 to 5"), "a depth of 9 was not refused");
    std::error_code ignored;
    std::filesystem::remove_all(sandbox, ignored);
    result.summary = "callers and impact find a linked import call, a call in a file that does not parse, and a TypeScript call; keywords, a limit of 0 and a depth of 9 are refused";
    return result;
}

}
