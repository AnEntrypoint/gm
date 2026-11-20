#include "gm/tool.hpp"
#include "support.hpp"

#include <system_error>

namespace gm::tool {

CheckResult check_txiki_sync_errno(const std::string& binary) {
    CheckResult result;
    const std::filesystem::path sandbox = support::fresh_sandbox("txiki-sync-errno");
    std::string answer;
    bool started = false;
    {
        Session session(binary, sandbox / "ws", sandbox, 300000, true);
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + binary);
        } else {
            started = true;
            support::start_session(session, "check-txiki-sync-errno");
            const std::string body = R"JS(await gm.read_file({ path: 'skill://gm/SKILL.md' }); const core = (await import("tjs:internal/core")).default; let code = null; let threw = false; try { core.syncReadFile("/nonexistent/gm-sync-errno"); } catch (e) { threw = true; code = e.code; } const okPath = core.mkdtempSync(globalThis.tjs.tmpDir + '/gm-sync-ok-XXXXXX') + '/ok.txt'; const okFd = core.openSync(okPath, 'w', 420); core.writeSync(okFd, new Uint8Array([111, 107]), 0, 2, null); core.closeSync(okFd); const ok = core.syncReadFile(okPath); return { threw, code, okBytes: ok.length };)JS";
            const json::Value raw = tool_json(session, "run_code", json::Object{{"body", body}});
            answer = json::dump(output_value(raw));
            if (answer == "null") answer = "no output: " + json::dump(raw);
        }
    }
    std::error_code ec;
    std::filesystem::remove_all(sandbox, ec);
    if (!started) return result;
    if (answer.find("\"threw\":true") == std::string::npos) result.failures.push_back("syncReadFile of a missing file did not throw: " + answer.substr(0, 200));
    if (answer.find("\"code\":\"ENOENT\"") == std::string::npos) result.failures.push_back("the error from a missing file does not carry the errno code ENOENT: " + answer.substr(0, 200));
    if (answer.find("\"okBytes\":0") != std::string::npos || answer.find("\"okBytes\"") == std::string::npos) result.failures.push_back("syncReadFile of a readable file returned no bytes: " + answer.substr(0, 200));
    result.summary = "txiki syncReadFile throws the errno of a failed read (ENOENT for a missing file) and still returns bytes for a readable file";
    return result;
}

}
