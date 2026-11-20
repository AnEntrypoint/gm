#include "gm/tool.hpp"
#include "support.hpp"

#include <system_error>

namespace gm::tool {

CheckResult check_txiki_spawn_stdio(const std::string& binary) {
    CheckResult result;
    const std::filesystem::path sandbox = support::fresh_sandbox("txiki-spawn-stdio");
    std::string answer;
    bool started = false;
    {
        Session session(binary, sandbox / "ws", sandbox, 300000, true);
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + binary);
        } else {
            started = true;
            support::start_session(session, "check-txiki-spawn-stdio");
            const std::string body = R"JS(await gm.read_file({ path: 'skill://gm/SKILL.md' }); const core = (await import('tjs:internal/core')).default; let exitRes; const exited = new Promise((r) => { exitRes = r; }); const proc = core.spawn(['/bin/sh', '-c', 'printf hello >&3'], { stdio: [null, null, null, 'pipe'], onexit: () => exitRes() }); const pipe = proc.stdio[3]; const bytes = []; let eofRes; const eof = new Promise((r) => { eofRes = r; }); pipe.onread = (data) => { if (data === null) { eofRes(); } else if (data) { for (const b of data) bytes.push(b); } }; pipe.startRead(); await exited; await eof; const plain = core.spawn(['/bin/true'], { onexit: () => {} }); return { text: String.fromCharCode(...bytes), stdioType: typeof proc.stdio, plainStdio: typeof plain.stdio };)JS";
            answer = json::dump(output_value(tool_json(session, "run_code", json::Object{{"body", body}, {"timeoutMs", 30000}})));
        }
    }
    std::error_code ec;
    std::filesystem::remove_all(sandbox, ec);
    if (!started) return result;
    if (answer.find(R"("text":"hello")") == std::string::npos) result.failures.push_back("the byte written to fd 3 did not reach the parent-side pipe stdio[3]: " + answer.substr(0, 320));
    if (answer.find(R"("stdioType":"object")") == std::string::npos) result.failures.push_back("a spawn with a pipe at fd 3 does not return stdio as an array: " + answer.substr(0, 320));
    if (answer.find(R"("plainStdio":"undefined")") == std::string::npos) result.failures.push_back("a spawn without extra stdio entries returns a stdio property: " + answer.substr(0, 320));
    result.summary = "spawn with stdio entries from fd 3 returns the parent-side pipe, and reads what the child writes to it";
    return result;
}

}
