#include "gm/tool.hpp"
#include "support.hpp"

#include <chrono>
#include <filesystem>
#include <fstream>
#include <system_error>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

constexpr const char* kBody =
    "const found = await gm.run_shell({ command: 'command -v playwriter', timeoutMs: 10000 });\n"
    "const ran = await gm.run_shell({ command: 'playwriter witness', timeoutMs: 10000 });\n"
    "await gm.job_start({ job: 'playwriter-job', command: 'playwriter job', timeoutMs: 10000 });\n"
    "const job = await gm.job_status({ job: 'playwriter-job', waitMs: 10000 });\n"
    "return { found: found.output, ran: ran.output, ranOk: ran.ok, job: job.output, jobState: job.state };\n";

}

#if !defined(_WIN32)
CheckResult check_shell_playwriter(const std::string& binary) {
    CheckResult result;
    const auto stamp = std::chrono::steady_clock::now().time_since_epoch().count();
    const fs::path sandbox = fs::temp_directory_path() / ("gm-shell-playwriter-" + std::to_string(stamp % 1000000));
    const fs::path workspace = sandbox / "ws";
    const fs::path bin = sandbox / ".gmnew" / "pw" / "bin";
    const fs::path package = sandbox / ".gmnew" / "pw" / "node_modules" / "playwriter";
    fs::create_directories(workspace);
    fs::create_directories(bin);
    fs::create_directories(package);
    const fs::path command = bin / "playwriter";
    const fs::path entry = package / "bin.js";
    std::ofstream(entry) << "#!/bin/sh\necho gm-witness-playwriter \"$@\"\n";
    fs::permissions(entry, fs::perms::owner_all | fs::perms::group_read | fs::perms::group_exec | fs::perms::others_read | fs::perms::others_exec);
    {
        Session session(binary, workspace, sandbox, 180000, true);
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + binary);
        } else {
            initialize_session(session, "check-shell-playwriter");
            session.rpc("resources/read", json::Object{{"uri", "skill://gm/SKILL.md"}});
            const json::Value reply = tool_json(session, "run_code", json::Object{{"format", "esm"}, {"timeoutMs", 60000}, {"body", kBody}});
            const json::Value out = output_value(reply);
            if (!out.is_object()) {
                result.failures.push_back("run_code did not return the body value: " + json::dump(out).substr(0, 200));
            } else {
                const std::string found = text_at(out, "found");
                if (found != command.string() + "\n") result.failures.push_back("command -v playwriter in a gm shell printed " + found + ", expected " + command.string());
                const std::string ran = text_at(out, "ran");
                if (ran.find("gm-witness-playwriter witness") == std::string::npos) result.failures.push_back("playwriter by name in a gm shell printed " + ran + ", expected the witness stub");
                const std::string job = text_at(out, "job");
                if (job.find("gm-witness-playwriter job") == std::string::npos) result.failures.push_back("playwriter by name in a gm job printed " + job + ", expected the witness stub");
                result.summary = "a fresh gm serve on an install whose pw/bin has no playwriter link (as an auto-updated install has) links pw/bin/playwriter to the package's bin.js and puts pw/bin first on PATH: command -v playwriter in a run_shell names that link, and playwriter runs by name from a run_shell and from a job";
            }
            std::error_code link_ec;
            if (!fs::is_symlink(command, link_ec) || fs::read_symlink(command, link_ec) != entry)
                result.failures.push_back("the fresh gm serve did not link " + command.string() + " to the package's " + entry.string());
            session.stop();
        }
    }
    std::error_code ignored;
    fs::remove_all(sandbox, ignored);
    return result;
}
#else
CheckResult check_shell_playwriter(const std::string&) {
    CheckResult result;
    result.summary = "skipped: POSIX-only check, the playwriter command link is not created on Windows";
    return result;
}
#endif

}
