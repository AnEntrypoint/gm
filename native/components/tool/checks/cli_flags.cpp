#include "gm/tool.hpp"

#include <chrono>
#include <filesystem>
#include <regex>
#include <system_error>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

}

CheckResult check_cli_flags(const std::string& binary) {
    CheckResult result;
#if defined(__linux__)
    const auto started = std::chrono::steady_clock::now();
    const auto stamp = started.time_since_epoch().count();
    const fs::path home = fs::temp_directory_path() / ("gm-cli-flags-" + std::to_string(stamp));
    const fs::path workspace = home / "workspace";
    const fs::path scratch = home / "scratch";
    fs::create_directories(home);
    fs::create_directories(scratch);
    const std::string home_env = "HOME=" + home.string();
    const auto run = [&](std::vector<std::string> args) {
        std::vector<std::string> argv{"env", home_env, "USERPROFILE=" + home.string(), (fs::path(binary).parent_path() / "gm").string()};
        argv.insert(argv.end(), args.begin(), args.end());
        return proc::run(argv, home, {}, 20000);
    };
    const auto joined = [](const std::vector<std::string>& args) {
        std::string text;
        for (const auto& arg : args) text += (text.empty() ? "" : " ") + arg;
        return text;
    };
    const std::regex refused_flag("unknown flag|unexpected argument");
    const std::vector<std::vector<std::string>> bad{
        {"install", "--bogus", "x"},
        {"install", "--wait"},
        {"install", "--config", (scratch / "claude.json").string()},
        {"uninstall", "--config", (scratch / "claude.json").string()},
        {"serve", "--workspace", workspace.string(), "--nope", "1"},
        {"worker", "--workspace", workspace.string(), "--nope"},
        {"doctor", "--bogus"},
        {"update", "--now"},
        {"events", "--run", "abc", "--bogus", "x"},
        {"query", "--run", "abc", "--wait"},
        {"stop-run", "--dir", scratch.string(), "--bogus", "1"},
        {"--version", "extra"},
    };
    for (const auto& args : bad) {
        const auto outcome = run(args);
        if (outcome.exit_code != 2) result.failures.push_back(joined(args) + " should exit 2, exited " + std::to_string(outcome.exit_code) + ": " + outcome.err.substr(0, 200));
        if (!std::regex_search(outcome.err, refused_flag)) result.failures.push_back(joined(args) + " should name the flag: " + outcome.err.substr(0, 200));
    }
    const fs::path claude = home / ".claude.json";
    if (fs::exists(claude)) result.failures.push_back("refused flags must not register the gm server in HOME/.claude.json");
    if (fs::exists(workspace / "runs")) result.failures.push_back("a refused serve must not create a run directory");

    const auto entry = run({"install"});
    if (entry.exit_code != 0) result.failures.push_back("install should succeed without a harness file: " + entry.err);
    if (fs::exists(claude)) result.failures.push_back("install must not write HOME/.claude.json");
    if (entry.out.find("\"args\":[\"serve\"]") == std::string::npos) result.failures.push_back("install should print the gm server entry: " + entry.out.substr(0, 300));
    if (entry.out.find("files touched: 0") == std::string::npos) result.failures.push_back("install should report the files it touched: " + entry.out.substr(0, 300));

    const std::string mcp_config = (scratch / "q.json").string();
    const auto with_server = run({"install", "--mcp-config", mcp_config});
    if (with_server.exit_code != 0) result.failures.push_back("install with --mcp-config should succeed: " + with_server.err);
    if (with_server.out.find("\"serve\",\"--mcp-config\",\"" + mcp_config + "\"") == std::string::npos)
        result.failures.push_back("--mcp-config should be in the printed server args: " + with_server.out.substr(0, 300));
    if (fs::exists(claude)) result.failures.push_back("install --mcp-config must not write HOME/.claude.json");

    const auto quiet = run({"events", "--run", "abc", "--wait", "--timeout-ms", "1000"});
    if (std::regex_search(quiet.err, std::regex("unknown flag|unexpected argument|needs a value")))
        result.failures.push_back("known events flags should be accepted: " + quiet.err.substr(0, 200));

    std::error_code ignored;
    fs::remove_all(home, ignored);
    const double wall = std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count();
    result.summary = "twelve refused command lines changed nothing; install writes no harness file and prints the server entry with its files-touched report; --mcp-config reaches the server args (wall " + std::to_string(wall) + " s)";
#else
    result.summary = "not measured: the flag check runs the command lines through env, which this platform does not have";
#endif
    return result;
}

}
