#include "gm/tool.hpp"
#include "support.hpp"

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
w.limit = await gm.git_log({ limit: 5 });
w.badLimit = await gm.git_log({ limit: 500 });
w.badRef = await gm.git_checkout({ ref: '-x' });
await gm.run_shell({ command: 'git checkout -q -b topic' });
w.branch = await gm.git_branch({});
w.push = await gm.git_push({});
await gm.run_shell({ command: 'git checkout -q main' });
w.gateRed = await gm.git_push({ gate: 'echo gate-says-no; exit 3' });
w.afterRed = await gm.run_shell({ command: 'test -z "$(git --git-dir=../remote.git rev-parse -q --verify main)" && echo REMOTE-EMPTY || echo REMOTE-HAS-MAIN' });
await gm.write_file({ path: 'a.txt', content: 'dirty\n' });
w.gateDirty = await gm.git_push({ gate: 'true' });
await gm.run_shell({ command: 'git checkout -q -- a.txt' });
w.gateMutates = await gm.git_push({ gate: 'echo x >> a.txt' });
await gm.run_shell({ command: 'git checkout -q -- a.txt' });
w.gateEmpty = await gm.git_push({ gate: '' });
w.gateGreen = await gm.git_push({ gate: 'echo checks-ok' });
w.afterGreen = await gm.run_shell({ command: 'test "$(git rev-parse HEAD)" = "$(git --git-dir=../remote.git rev-parse main)" && echo REMOTE-MATCHES || echo REMOTE-DIFFERS' });
w.cwdOutside = await gm.git_status({ cwd: '..' });
return JSON.stringify(w);
)js";

}

CheckResult check_git(const std::string& binary) {
    CheckResult result;
    const auto stamp = std::chrono::steady_clock::now().time_since_epoch().count();
    const auto sandbox = std::filesystem::temp_directory_path() / ("gm-git-" + std::to_string(stamp));
    const auto workspace = sandbox / "ws";
    std::filesystem::create_directories(workspace);
    proc::run({"git", "init", "-q", "-b", "main"}, workspace);
    proc::run({"git", "init", "-q", "--bare", "-b", "main", (sandbox / "remote.git").string()}, sandbox);
    proc::run({"git", "remote", "add", "origin", "../remote.git"}, workspace);
    proc::run({"git", "config", "user.name", "lanmower"}, workspace);
    proc::run({"git", "config", "user.email", "lanmower@users.noreply.github.com"}, workspace);
    std::string text;
    std::string log;
    {
        Session session(binary, workspace, sandbox);
        if (!session.started()) result.failures.push_back("gm serve did not start from " + binary);
        if (session.started()) {
            initialize_session(session, "gm-tool");
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
    expect(!contains(text, "count must be an integer from 1 to 200"), "git_log refused a count over 200 although the count cap was removed");
    expect(contains(text, "\"limit\":{\"ok\":true") && contains(text, "first commit"), "git_log did not accept limit as an alias for count");
    expect(!contains(text, "\"badLimit\":{\"ok\":false,\"error\":\"count must be an integer from 1 to 200\""), "git_log refused a limit over 200 although the count cap was removed");
    expect(contains(text, "ref must be a branch, tag or commit name"), "git_checkout accepted a ref that starts with a dash");
    expect(contains(text, "* topic"), "git_branch did not mark the topic branch as current");
    expect(contains(text, "refused: git_push sends only main, and the current branch is topic"), "git_push pushed a branch other than main");
    expect(contains(text, "is not inside a git repository"), "a cwd outside a repository was not refused");
    expect(contains(text, "refused: the gate exited 3 after") && contains(text, "gate-says-no") && contains(text, "REMOTE-EMPTY"), "a gate that exits 3 did not refuse the push with its output, or main reached the remote");
    expect(contains(text, "tracked changes are uncommitted, so the gate would not check what is pushed"), "a push with an uncommitted tracked change was not refused before the gate ran");
    expect(contains(text, "the gate changed HEAD or a tracked file"), "a gate that changes a tracked file did not refuse the push");
    expect(contains(text, "gate must be a non-empty command string"), "an empty gate was accepted");
    expect(contains(text, "the gate passed in") && contains(text, "REMOTE-MATCHES"), "a passing gate did not push main with its note");
    std::error_code ignored;
    std::filesystem::remove_all(sandbox, ignored);
    result.summary = "add, commit (with its log event), log, show, state, the limit alias for count, the path, message, count and ref refusals, the push branch guard, the cwd refusal and the push gate (a red gate, an uncommitted tracked change, a gate that edits a file and an empty gate refuse and a green gate pushes) answer as the leaf did";
    return result;
}

}
