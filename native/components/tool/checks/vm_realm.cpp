#include "gm/tool.hpp"
#include "support.hpp"

#include <system_error>

namespace gm::tool {

CheckResult check_vm_realm(const std::string& binary) {
    CheckResult result;
    const std::filesystem::path sandbox = support::fresh_sandbox("vm-realm");
    std::string answer;
    bool started = false;
    {
        Session session(binary, sandbox / "ws", sandbox, 300000, true);
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + binary);
        } else {
            started = true;
            support::start_session(session, "check-vm-realm");
            const std::string body = R"JS(await gm.read_file({ path: 'skill://gm/SKILL.md' }); const core = (await import('tjs:internal/core')).default; const kind = core.evalInNewRealm('typeof Array'); core.evalInNewRealm('var gmRealmProbe = 7'); const leaked = typeof globalThis.gmRealmProbe; let thrown = null; try { core.evalInNewRealm('null.x'); } catch (e) { thrown = e.name; } return { kind, leaked, thrown };)JS";
            answer = json::dump(output_value(tool_json(session, "run_code", json::Object{{"body", body}, {"timeoutMs", 30000}})));
        }
    }
    std::error_code ec;
    std::filesystem::remove_all(sandbox, ec);
    if (!started) return result;
    if (answer.find(R"("kind":"function")") == std::string::npos) result.failures.push_back("the new realm does not have its own built-ins: " + answer.substr(0, 320));
    if (answer.find(R"("leaked":"undefined")") == std::string::npos) result.failures.push_back("a global of the new realm leaked into the host realm: " + answer.substr(0, 320));
    if (answer.find(R"("thrown":"TypeError")") == std::string::npos) result.failures.push_back("an error in the new realm did not keep its name: " + answer.substr(0, 320));
    result.summary = "vm-realm witness";
    return result;
}

}
