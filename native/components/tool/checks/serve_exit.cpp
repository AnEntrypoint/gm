#include "gm/tool.hpp"
#include "support.hpp"

#include <filesystem>
#include <fstream>
#include <string>
#include <system_error>
#include <vector>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

struct Refusal {
    std::vector<std::string> flags;
    const char* message;
};

const Refusal kRefusals[] = {
    {{"--max-inflight", "0"}, "--max-inflight must be a positive integer"},
    {{"--max-inflight", "abc"}, "--max-inflight must be a positive integer"},
    {{"--max-inflight", "-3"}, "--max-inflight must be a positive integer"},
    {{"--task", ""}, "--task is empty"},
    {{"--task", "   "}, "--task is empty"},
};

}

CheckResult check_serve_exit(const std::string& binary) {
    CheckResult result;
    const fs::path sandbox = support::fresh_sandbox("sx");
    const fs::path workspace = sandbox / "ws";
    const fs::path missing = sandbox / "missing";
    const fs::path task_file = workspace / "task.md";
    std::ofstream(task_file) << "a task read from a file\n";
    std::error_code ec;
    fs::create_directories(workspace / ".gm", ec);
    std::ofstream(workspace / ".gm" / "mcp.json") << R"({"mcpServers":{"playwriter":{"disabled":true}}})";
    const auto serve = [&](const fs::path& dir, const std::vector<std::string>& flags) {
        std::vector<std::string> argv{"env", "HOME=" + sandbox.string(), "USERPROFILE=" + sandbox.string(), binary, "serve", "--workspace", dir.string()};
        argv.insert(argv.end(), flags.begin(), flags.end());
        return proc::run(argv, workspace, {}, 20000);
    };
    const auto joined = [](const std::vector<std::string>& flags) {
        std::string text;
        for (const std::string& flag : flags) text += (text.empty() ? "'" : " '") + flag + "'";
        return text;
    };
    for (const Refusal& refusal : kRefusals) {
        const proc::Outcome run = serve(workspace, refusal.flags);
        if (!run.started || run.timed_out || run.exit_code == 0) result.failures.push_back(joined(refusal.flags) + ": the relay did not exit non-zero (code " + std::to_string(run.exit_code) + (run.timed_out ? ", timed out" : "") + ")");
        if (!support::contains(run.err, refusal.message)) result.failures.push_back(joined(refusal.flags) + ": stderr does not carry \"" + refusal.message + "\": " + run.err.substr(0, 200));
    }
    const std::string missing_message = "workspace is not a directory: " + missing.string();
    const proc::Outcome gone = serve(missing, {});
    if (!gone.started || gone.timed_out || gone.exit_code == 0) result.failures.push_back("a missing workspace: the relay did not exit non-zero");
    if (!support::contains(gone.err, missing_message)) result.failures.push_back("a missing workspace: stderr does not carry \"" + missing_message + "\": " + gone.err.substr(0, 200));
    for (const std::vector<std::string>& flags : {std::vector<std::string>{"--max-inflight", "2"}, std::vector<std::string>{"--task", "a text task"}, std::vector<std::string>{"--task", task_file.string()}}) {
        const proc::Outcome run = serve(workspace, flags);
        if (!run.started || run.timed_out || run.exit_code != 0) result.failures.push_back(joined(flags) + ": the relay did not exit 0 on a closed stdin (code " + std::to_string(run.exit_code) + (run.timed_out ? ", timed out" : "") + "): " + run.err.substr(0, 200));
    }
    fs::remove_all(sandbox, ec);
    if (result.failures.empty()) result.summary = "gm serve exits non-zero with its message for --max-inflight 0, abc and -3, for an empty and a blank --task, and for a missing workspace, and exits 0 on a closed stdin for --max-inflight 2 and a --task given as text or as a file";
    return result;
}

}
