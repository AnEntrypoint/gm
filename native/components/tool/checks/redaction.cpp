#include "gm/tool.hpp"
#include "support.hpp"

#include <filesystem>
#include <fstream>
#include <sstream>
#include <string>
#include <system_error>
#include <vector>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;
using namespace support;

const std::vector<std::string> kSecrets = {"Bearer tokA1x", "Bearer tokB2y", "bearer tokC3z", "Bearer tokD4w", "access_token=SECRETZ1", "refresh_token=SECRETZ2", "api_key=KEYZ2", "password=PWZ3"};
constexpr const char* kKept = "keep-me";

std::string shell_body() {
    std::string joined;
    for (const std::string& secret : kSecrets) joined += secret + " and ";
    return "return (await gm.run_shell({ command: \"echo '" + joined + kKept + "'\" })).output;";
}

std::string output_artifacts(const fs::path& workspace) {
    std::string all;
    std::error_code ec;
    for (const auto& entry : fs::recursive_directory_iterator(workspace / "runs", ec)) {
        if (!entry.is_regular_file(ec) || entry.path().parent_path().filename() != "outputs") continue;
        std::ifstream in(entry.path(), std::ios::binary);
        std::ostringstream text;
        text << in.rdbuf();
        all += text.str() + "\n";
    }
    return all;
}

}

CheckResult check_redaction(const std::string& binary) {
    CheckResult result;
    const fs::path sandbox = fresh_sandbox("rd");
    const fs::path workspace = sandbox / "ws";
    std::string log;
    {
        Session session(binary, workspace, sandbox);
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + binary);
            return result;
        }
        initialize_session(session, "gm-tool");
        session.rpc("resources/read", json::Object{{"uri", "skill://gm/SKILL.md"}});
        session.rpc("tools/call", json::Object{{"name", "next_context"}, {"arguments", json::Object{}}});
        session.body(shell_body());
        log = session.body("return JSON.stringify(await gm.query_log({ kind: 'action', limit: 50 }));");
        session.stop();
    }
    const std::string artifacts = output_artifacts(workspace);
    auto expect = [&](bool condition, const std::string& what) {
        if (!condition) result.failures.push_back(what);
    };
    expect(contains(log, "run_shell"), "the run_shell action did not reach the run log (positive control): " + log.substr(0, 200));
    for (const std::string& secret : kSecrets) {
        expect(!contains(log, secret), "the raw '" + secret + "' is in the run log");
        expect(!contains(artifacts, secret), "the raw '" + secret + "' is in an output artifact");
    }
    expect(contains(log, kKept), std::string("the non-secret '") + kKept + "' was not kept in the run log");
    expect(contains(log, "[redacted]"), "the run log does not show [redacted] in place of the values");
    expect(artifacts.empty() || contains(artifacts, "[redacted]"), "the output artifacts do not show [redacted] in place of the values");
    std::error_code ec;
    fs::remove_all(sandbox, ec);
    if (result.failures.empty()) result.summary = "eight secret shapes (four Bearer tokens, access_token, refresh_token, api_key, password) echoed by run_shell are absent from the run log and the output artifacts, [redacted] stands in their place, and a non-secret word is kept";
    return result;
}

}
