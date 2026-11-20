#include "gm/tool.hpp"
#include "support.hpp"

#include <system_error>

namespace gm::tool {

CheckResult check_worker_message_channel(const std::string& binary) {
    CheckResult result;
    const std::filesystem::path sandbox = support::fresh_sandbox("worker-message-channel");
    std::string answer;
    bool started = false;
    {
        Session session(binary, sandbox / "ws", sandbox, 300000, true);
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + binary);
        } else {
            started = true;
            support::start_session(session, "check-worker-message-channel");
            const std::string body = R"JS(await gm.read_file({ path: 'skill://gm/SKILL.md' }); const core = (await import('tjs:internal/core')).default; const dir = core.mkdtempSync(globalThis.tjs.tmpDir + '/gm-worker-XXXXXX'); const entry = dir + '/entry.js'; const source = "self.addEventListener('message', (e) => { self.postMessage(e.data * 2) })"; const fd = core.openSync(entry, 'w', 420); core.writeSync(fd, new Uint8Array(Array.from(source, (c) => c.charCodeAt(0))), 0, source.length, null); core.closeSync(fd); let reply = null; let error = null; let w = null; try { w = new core.Worker(entry); const port = w.messagePipe; reply = await new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error('timeout')), 8000); port.onmessage = (e) => { clearTimeout(t); resolve(e.data); }; port.start(); port.postMessage(21); }); } catch (e) { error = String((e && e.message) || e).slice(0, 200); } if (w) { w.terminate(); } core.rmSync(entry); core.rmSync(dir); return { reply, error };)JS";
            answer = json::dump(output_value(tool_json(session, "run_code", json::Object{{"body", body}, {"timeoutMs", 30000}})));
        }
    }
    std::error_code ec;
    std::filesystem::remove_all(sandbox, ec);
    if (!started) return result;
    if (answer.find(R"("reply":42)") == std::string::npos) result.failures.push_back("the worker did not reply to the message it was sent: " + answer.substr(0, 320));
    if (answer.find(R"("error":null)") == std::string::npos) result.failures.push_back("the message channel reported an error: " + answer.substr(0, 320));
    result.summary = "a port started without a delivery function delivers to onmessage, and the worker's reply arrives";
    return result;
}

}
