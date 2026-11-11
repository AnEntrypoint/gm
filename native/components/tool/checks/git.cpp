#include "gm/tool.hpp"

#include <chrono>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <system_error>

namespace gm::tool {
namespace {

const std::string kBody = R"js(
const w = {};
await gm.write_file({ path: 'a.txt', content: 'one\n' });
w.add = await gm.git_add({ paths: ['a.txt'] });
w.commit = await gm.git_commit({ message: 'first commit', paths: ['a.txt'] });
w.log = await gm.git_log({ count: 5 });
w.show = await gm.git_show({});
w.state = await gm.git_state({});
w.dot = await gm.git_add({ paths: ['.'] });
w.outside = await gm.git_add({ paths: ['../escape.txt'] });
w.noMessage = await gm.git_commit({ message: '', paths: ['a.txt'] });
w.badCount = await gm.git_log({ count: 500 });
w.badRef = await gm.git_checkout({ ref: '-x' });
await gm.run_shell({ command: 'git checkout -q -b topic' });
w.branch = await gm.git_branch({});
w.push = await gm.git_push({});
w.cwdOutside = await gm.git_status({ cwd: '..' });
return JSON.stringify(w);
)js";

bool contains(const std::string& text, const std::string& word) { return text.find(word) != std::string::npos; }

}

CheckResult check_git(const std::string& binary) {
    CheckResult result;
    const auto stamp = std::chrono::steady_clock::now().time_since_epoch().count();
    const auto sandbox = std::filesystem::temp_directory_path() / ("gm-git-" + std::to_string(stamp));
    const auto workspace = sandbox / "ws";
    std::filesystem::create_directories(workspace);
    proc::run({"git", "init", "-q", "-b", "main"}, workspace);
    proc::run({"git", "config", "user.name", "lanmower"}, workspace);
    proc::run({"git", "config", "user.email", "lanmower@users.noreply.github.com"}, workspace);
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
    expect(contains(text, "\"add\":{\"ok\":true"), "git_add did not stage the path");
    expect(contains(text, "\"commit\":{\"ok\":true"), "git_commit did not commit the named path");
    expect(contains(log, "\"kind\":\"commit\""), "git_commit did not log its commit event");
    expect(contains(text, "first commit") && contains(text, "\"log\":{\"ok\":true"), "git_log did not list the commit");
    expect(contains(text, "a.txt"), "git_show did not list the committed file");
    expect(contains(text, "branch main") && contains(text, "staged 0 unstaged 0"), "git_state did not describe a tree with nothing staged or unstaged on main");
    expect(contains(text, "\"dot\":{\"ok\":false,\"error\":\"refused: \\\".\\\" names the whole workspace"), "git_add accepted \".\" as a path");
    expect(contains(text, "refused: path is outside the workspace: ../escape.txt"), "git_add accepted a path outside the workspace");
    expect(contains(text, "\"noMessage\":{\"ok\":false,\"error\":\"message must be a non-empty string\""), "git_commit accepted an empty message");
    expect(contains(text, "count must be an integer from 1 to 200"), "git_log accepted a count over 200");
    expect(contains(text, "ref must be a branch, tag or commit name"), "git_checkout accepted a ref that starts with a dash");
    expect(contains(text, "* topic"), "git_branch did not mark the topic branch as current");
    expect(contains(text, "refused: git_push sends only main, and the current branch is topic"), "git_push pushed a branch other than main");
    expect(contains(text, "is not inside a git repository"), "a cwd outside a repository was not refused");
    std::error_code ignored;
    std::filesystem::remove_all(sandbox, ignored);
    result.summary = "add, commit (with its log event), log, show, state, the path, message, count and ref refusals, the push branch guard and the cwd refusal answer as the leaf did";
    return result;
}

}
