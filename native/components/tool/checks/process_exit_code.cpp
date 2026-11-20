#include "gm/tool.hpp"
#include "support.hpp"

#include <sys/wait.h>

#include <fstream>
#include <iterator>
#include <system_error>

namespace gm::tool {

namespace {

int serve_exit_status(const std::string& binary, const std::filesystem::path& dir, const std::string& body, std::string& output) {
    const std::filesystem::path ws = dir / "ws";
    std::filesystem::create_directories(ws);
    const std::filesystem::path input = dir / "in.jsonl";
    const std::filesystem::path out = dir / "out.jsonl";
    {
        std::ofstream file(input);
        file << json::dump(json::Object{{"jsonrpc", "2.0"}, {"id", "1"}, {"method", "initialize"}, {"params", json::Object{{"protocolVersion", "2025-06-18"}, {"capabilities", json::Object{}}, {"clientInfo", json::Object{{"name", "check"}, {"version", "1"}}}}}}) << '\n';
        file << json::dump(json::Object{{"jsonrpc", "2.0"}, {"method", "notifications/initialized"}, {"params", json::Object{}}}) << '\n';
        file << json::dump(json::Object{{"jsonrpc", "2.0"}, {"id", "3"}, {"method", "tools/call"}, {"params", json::Object{{"name", "run_code"}, {"arguments", json::Object{{"body", body}, {"timeoutMs", 30000}}}}}}) << '\n';
    }
    const std::string command = "\"" + binary + "\" serve --workspace \"" + ws.string() + "\" < \"" + input.string() + "\" > \"" + out.string() + "\" 2>&1";
    const int status = std::system(command.c_str());
    std::ifstream file(out);
    output.assign(std::istreambuf_iterator<char>(file), std::istreambuf_iterator<char>());
    return WIFEXITED(status) ? WEXITSTATUS(status) : -1;
}

}

CheckResult check_process_exit_code(const std::string& binary) {
    CheckResult result;
    const std::filesystem::path sandbox = support::fresh_sandbox("process-exit-code");
    const std::string prefix = "await gm.read_file({ path: 'skill://gm/SKILL.md' }); const core = (await import('tjs:internal/core')).default; ";
    std::string set_output;
    std::string plain_output;
    const int set_status = serve_exit_status(binary, sandbox / "set", prefix + "core.setExitCode(7); return 'set';", set_output);
    const int plain_status = serve_exit_status(binary, sandbox / "plain", prefix + "return 'plain';", plain_output);
    std::error_code ec;
    std::filesystem::remove_all(sandbox, ec);
    if (set_output.find(R"("set")") == std::string::npos) result.failures.push_back("the run with setExitCode did not finish: " + set_output.substr(0, 320));
    if (set_status != 7) result.failures.push_back("serve did not exit with the code set by setExitCode: status " + std::to_string(set_status));
    if (plain_output.find(R"("plain")") == std::string::npos) result.failures.push_back("the run without setExitCode did not finish: " + plain_output.substr(0, 320));
    if (plain_status != 0) result.failures.push_back("serve without setExitCode did not exit 0: status " + std::to_string(plain_status));
    result.summary = "setExitCode sets the status serve exits with, and a run without it exits 0";
    return result;
}

}
