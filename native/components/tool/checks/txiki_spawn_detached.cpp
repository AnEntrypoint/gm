#include "gm/tool.hpp"
#include "support.hpp"

#include <system_error>

namespace gm::tool {

CheckResult check_txiki_spawn_detached(const std::string& binary) {
    CheckResult result;
    const std::filesystem::path sandbox = support::fresh_sandbox("txiki-spawn-detached");
    std::string answer;
    bool started = false;
    {
        Session session(binary, sandbox / "ws", sandbox, 300000, true);
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + binary);
        } else {
            started = true;
            support::start_session(session, "check-txiki-spawn-detached");
            const std::string body = R"JS(await gm.read_file({ path: 'skill://gm/SKILL.md' }); const core = (await import('tjs:internal/core')).default; const dir = core.mkdtempSync(globalThis.tjs.tmpDir + '/gm-detach-XXXXXX'); const text = (bytes) => Array.from(bytes, (b) => String.fromCharCode(b)).join(''); async function run(name, options) { const out = dir + '/' + name + '.txt'; let done; const exited = new Promise((resolve) => { done = resolve; }); const p = core.spawn(['/bin/sh', '-c', 'cat /proc/$$/stat > "' + out + '"'], { ...options, onexit: () => done() }); await exited; const stat = text(core.syncReadFile(out)); const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' '); return { pid: p.pid, session: Number(fields[3]) }; } const plain = await run('plain', {}); const det = await run('detached', { detached: true }); core.rmSync(dir + '/plain.txt'); core.rmSync(dir + '/detached.txt'); core.rmSync(dir); return { plainSameSession: plain.session === plain.pid, detachedSameSession: det.session === det.pid, pidsDiffer: plain.pid !== det.pid };)JS";
            answer = json::dump(output_value(tool_json(session, "run_code", json::Object{{"body", body}, {"timeoutMs", 30000}})));
        }
    }
    std::error_code ec;
    std::filesystem::remove_all(sandbox, ec);
    if (!started) return result;
    if (answer.find(R"("detachedSameSession":true)") == std::string::npos) result.failures.push_back("a detached child is not its own session leader: " + answer.substr(0, 320));
    if (answer.find(R"("plainSameSession":false)") == std::string::npos) result.failures.push_back("a child that is not detached is already its own session leader: " + answer.substr(0, 320));
    if (answer.find(R"("pidsDiffer":true)") == std::string::npos) result.failures.push_back("the two children have the same pid: " + answer.substr(0, 320));
    result.summary = "spawn with detached: true makes the child a session leader; without it the child keeps the session";
    return result;
}

}
