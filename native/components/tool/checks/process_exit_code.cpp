#include "gm/tool.hpp"
#include "support.hpp"

#include <system_error>

namespace gm::tool {

namespace {

std::optional<int> serve_exit_status(const std::string& binary, const std::filesystem::path& dir, const std::string& body, std::string& output) {
    const std::filesystem::path ws = dir / "ws";
    std::filesystem::create_directories(ws);
    Session session(binary, ws, dir, 240000, true);
    if (!session.started()) {
        output = "gm serve did not start from " + binary;
        return std::nullopt;
    }
    support::start_session(session, "gm-process-exit-code-check");
    output = json::dump(output_value(tool_json(session, "run_code", json::Object{{"format", "esm"}, {"timeoutMs", 30000}, {"body", body}})));
    return session.wait_exit(std::chrono::seconds(30));
}

}

CheckResult check_process_exit_code(const std::string& binary) {
    CheckResult result;
    const std::filesystem::path sandbox = support::fresh_sandbox("process-exit-code");
    const std::string prefix = "await gm.read_file({ path: 'skill://gm/SKILL.md' }); const core = (await import('tjs:internal/core')).default; ";
    std::string set_output;
    std::string plain_output;
    const std::optional<int> set_status = serve_exit_status(binary, sandbox / "set", prefix + "core.setExitCode(7); return 'set';", set_output);
    const std::optional<int> plain_status = serve_exit_status(binary, sandbox / "plain", prefix + "return 'plain';", plain_output);
    std::error_code ec;
    std::filesystem::remove_all(sandbox, ec);
    if (set_output.find("\"set\"") == std::string::npos) result.failures.push_back("the run with setExitCode did not finish: " + set_output.substr(0, 320));
    if (set_status != 7) result.failures.push_back("serve did not exit with the code set by setExitCode: status " + std::to_string(set_status.value_or(-1)));
    if (plain_output.find("\"plain\"") == std::string::npos) result.failures.push_back("the run without setExitCode did not finish: " + plain_output.substr(0, 320));
    if (plain_status != 0) result.failures.push_back("serve without setExitCode did not exit 0: status " + std::to_string(plain_status.value_or(-1)));
    result.summary = "setExitCode sets the status serve exits with, and a run without it exits 0";
    return result;
}

}
