#include "gm/tool.hpp"
#include "support.hpp"

#include <system_error>

namespace gm::tool {

namespace {

namespace fs = std::filesystem;

}

CheckResult check_friction_verbs(const std::string& binary) {
    CheckResult result;
    const fs::path sandbox = support::fresh_sandbox("friction-verbs");
    const fs::path ws = sandbox / "ws";
    fs::create_directories(ws);
    {
        Session session(binary, ws, sandbox, 240000, true);
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + binary);
        } else {
            support::start_session(session, "check-friction-verbs");
            const std::string body =
                "await gm.read_file({ path: 'skill://gm/SKILL.md' }); "
                "return { full: await gm.write_file({ path: 'full.txt', content: 'x', full: true }), "
                "plain: await gm.write_file({ path: 'plain.txt', content: 'y' }), "
                "shell: await gm.run_shell({ command: 'grep -c zzz /dev/null' }) };";
            const json::Value reply = output_value(tool_json(session, "run_code", json::Object{{"body", body}}));
            const std::string seen = json::dump(reply).substr(0, 300);
            const json::Value* full_ok = value_at(reply, "full.ok");
            const json::Value* full_error = value_at(reply, "full.error");
            const json::Value* plain_ok = value_at(reply, "plain.ok");
            const json::Value* shell_ok = value_at(reply, "shell.ok");
            const json::Value* shell_exit = value_at(reply, "shell.exitCode");
            if (full_ok == nullptr || !full_ok->is_bool() || full_ok->as_bool()) result.failures.push_back("write_file with full: true was not refused: " + seen);
            if (full_error == nullptr || !full_error->is_string() || full_error->as_string().find("full") == std::string::npos) result.failures.push_back("the refusal of full: true does not name full: " + seen);
            if (fs::exists(ws / "full.txt")) result.failures.push_back("a refused write_file created full.txt");
            if (plain_ok == nullptr || !plain_ok->is_bool() || !plain_ok->as_bool() || !fs::exists(ws / "plain.txt")) result.failures.push_back("write_file with path and content did not write plain.txt: " + seen);
            if (shell_ok == nullptr || !shell_ok->is_bool() || !shell_ok->as_bool()) result.failures.push_back("run_shell of a grep with no matches was not ok true: " + seen);
            if (shell_exit == nullptr || !shell_exit->is_number() || shell_exit->as_number() != 1) result.failures.push_back("run_shell of a grep with no matches did not report exitCode 1: " + seen);
        }
    }
    std::error_code ec;
    fs::remove_all(sandbox, ec);
    result.summary = "write_file refuses full, an argument it does not take, and still writes path and content; a run_shell that exits 1 is ok true with exitCode 1";
    return result;
}

}
