#include "gm/tool.hpp"
#include "support.hpp"

#include <system_error>

namespace gm::tool {

CheckResult check_vm_script_compile(const std::string& binary) {
    CheckResult result;
    const std::filesystem::path sandbox = support::fresh_sandbox("vm-script-compile");
    std::string answer;
    bool started = false;
    {
        Session session(binary, sandbox / "ws", sandbox, 300000, true);
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + binary);
        } else {
            started = true;
            support::start_session(session, "check-vm-script-compile");
            const std::string body = R"JS(await gm.read_file({ path: 'skill://gm/SKILL.md' }); const core = (await import('tjs:internal/core')).default; const fn = core.compileScript('globalThis.gmCompiled = 41; 1 + 1'); const before = typeof globalThis.gmCompiled; const first = core.runCompiledScript(fn); const again = core.runCompiledScript(fn); let syntax = null; try { core.compileScript('1 +'); } catch (e) { syntax = e.name; } return { before, first, again, set: globalThis.gmCompiled, syntax };)JS";
            answer = json::dump(output_value(tool_json(session, "run_code", json::Object{{"body", body}, {"timeoutMs", 30000}})));
        }
    }
    std::error_code ec;
    std::filesystem::remove_all(sandbox, ec);
    if (!started) return result;
    if (answer.find(R"("before":"undefined")") == std::string::npos) result.failures.push_back("compileScript ran the script before it was run: " + answer.substr(0, 320));
    if (answer.find(R"("first":2)") == std::string::npos) result.failures.push_back("runCompiledScript did not return the completion value: " + answer.substr(0, 320));
    if (answer.find(R"("again":2)") == std::string::npos) result.failures.push_back("a compiled script could not be run a second time: " + answer.substr(0, 320));
    if (answer.find(R"("set":41)") == std::string::npos) result.failures.push_back("the compiled script did not set its global: " + answer.substr(0, 320));
    if (answer.find(R"("syntax":"SyntaxError")") == std::string::npos) result.failures.push_back("a syntax error did not throw at compile time: " + answer.substr(0, 320));
    result.summary = "vm-script-compile witness";
    return result;
}

}
