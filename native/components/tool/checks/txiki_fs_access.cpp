#include "gm/tool.hpp"
#include "support.hpp"

#include <system_error>

namespace gm::tool {

CheckResult check_txiki_fs_access(const std::string& binary) {
    CheckResult result;
    const std::filesystem::path sandbox = support::fresh_sandbox("txiki-fs-access");
    std::string answer;
    bool started = false;
    {
        Session session(binary, sandbox / "ws", sandbox, 300000, true);
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + binary);
        } else {
            started = true;
            support::start_session(session, "txiki-fs-access");
            const std::string body = R"JS(await gm.read_file({ path: 'skill://gm/SKILL.md' }); const core = (await import('tjs:internal/core')).default; const dir = core.mkdtempSync(globalThis.tjs.tmpDir + '/gm-access-XXXXXX'); const fp = dir + '/f.txt'; const fd = core.openSync(fp, 'w', 420); core.closeSync(fd); const exec = await core.access(fp, 1).then(() => 'resolved', (e) => e.code); const read = await core.access(fp, 4).then(() => 'resolved', (e) => e.code); const exists = await core.access(fp, 0).then(() => 'resolved', (e) => e.code); const missing = await core.access(dir + '/nope', 0).then(() => 'resolved', (e) => e.code); core.rmSync(fp); core.rmSync(dir); return { exec, read, exists, missing };)JS";
            answer = json::dump(output_value(tool_json(session, "run_code", json::Object{{"body", body}, {"timeoutMs", 30000}})));
        }
    }
    std::error_code ec;
    std::filesystem::remove_all(sandbox, ec);
    if (!started) return result;
    if (answer.find(R"("exec":"EACCES")") == std::string::npos) result.failures.push_back("access with X_OK on a file with no execute bit did not reject with EACCES: " + answer.substr(0, 320));
    if (answer.find(R"("read":"resolved")") == std::string::npos) result.failures.push_back("access with R_OK on a readable file did not resolve: " + answer.substr(0, 320));
    if (answer.find(R"("exists":"resolved")") == std::string::npos) result.failures.push_back("access with F_OK on an existing file did not resolve: " + answer.substr(0, 320));
    if (answer.find(R"("missing":"ENOENT")") == std::string::npos) result.failures.push_back("access on a missing path did not reject with ENOENT: " + answer.substr(0, 320));
    result.summary = "txiki-fs-access witness";
    return result;
}

}
