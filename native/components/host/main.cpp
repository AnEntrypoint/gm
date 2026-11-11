#include <algorithm>
#include <iostream>
#include <optional>
#include <string>

#include "gm/host/cli.hpp"
#include "gm/host/install.hpp"
#include "gm/host/options.hpp"
#include "gm/host/update.hpp"

namespace {

constexpr std::string_view kUsage =
    "usage: gm serve|worker --workspace <dir> [--runs <dir>] [--run-dir <dir>] [--resume <id>] [--task <file>] "
    "[--skills <dir>] [--leaves <dir>] [--build-dir <dir>]\n"
    "       gm doctor [--leaves <dir>]\n"
    "       gm update\n"
    "       gm install [--local <build dir> [--source <checkout>]] [--config <file>] [--mcp-config <file>]\n"
    "       gm uninstall [--config <file>]\n"
    "       gm --version\n"
    "       gm events (--run <id> [--workspace <dir>] | --dir <run dir>) [--wait [--timeout-ms N]]\n"
    "       gm query (--run <id> [--workspace <dir>] | --dir <run dir>) [--js \"<filter>\"]\n"
    "       gm stop-run --dir <run dir> [--idle-ms N]\n";

using Names = std::initializer_list<std::string_view>;

bool listed(Names names, const std::string& name) {
    return std::find(names.begin(), names.end(), std::string_view(name)) != names.end();
}

std::optional<std::string> flag_error(const std::vector<std::string>& rest, Names values, Names switches) {
    for (std::size_t i = 0; i < rest.size(); ++i) {
        const std::string& token = rest[i];
        if (token.rfind("--", 0) != 0) return "unexpected argument " + token;
        const std::string name = token.substr(2);
        if (listed(switches, name)) continue;
        if (!listed(values, name)) return "unknown flag " + token;
        if (i + 1 >= rest.size() || rest[i + 1].rfind("--", 0) == 0) return token + " needs a value";
        ++i;
    }
    return std::nullopt;
}

std::optional<std::string> flag_error_for(const gm::host::HostArgs& args) {
    if (args.mode == "serve" || args.mode == "worker") {
        return flag_error(args.rest,
                          {"workspace", "runs", "run-dir", "resume", "task", "skills", "leaves", "build-dir", "mcp-config",
                           "max-inflight", "max-steps", "stuck-ms", "job-lifetime-ms", "monitor-ms", "handshake",
                           "skill-read", "resend", "supervised", "owner", "restart-reason", "from-build"},
                          {});
    }
    if (args.mode == "doctor") return flag_error(args.rest, {"leaves"}, {});
    if (args.mode == "install") return flag_error(args.rest, {"config", "mcp-config", "local", "source"}, {});
    if (args.mode == "uninstall") return flag_error(args.rest, {"config"}, {});
    if (args.mode == "events") return flag_error(args.rest, {"run", "workspace", "dir", "timeout-ms"}, {"wait", "read-clear"});
    if (args.mode == "query") return flag_error(args.rest, {"run", "workspace", "dir", "js"}, {"read-clear"});
    if (args.mode == "stop-run") return flag_error(args.rest, {"dir", "idle-ms"}, {});
    if (args.mode == "update" || args.mode == "--version") return flag_error(args.rest, {}, {});
    return std::nullopt;
}

}

int main(int argc, char** argv) {
    const gm::host::HostArgs args = gm::host::parse_args(argc, argv);
    if (auto error = flag_error_for(args)) {
        std::cerr << "gm " << args.mode << ": " << *error << "; this call changed nothing\n" << kUsage;
        return 2;
    }
    if (args.mode == "serve") return gm::host::run_serve(args);
    if (args.mode == "worker") return gm::host::run_worker(args);
    if (args.mode == "doctor") return gm::host::run_doctor(args);
    if (args.mode == "events") return gm::host::run_events(args);
    if (args.mode == "query") return gm::host::run_query_command(args);
    if (args.mode == "stop-run") return gm::host::run_stop(args);
    if (args.mode == "update") return gm::host::run_update_command();
    if (args.mode == "install") return gm::host::run_install_command(args);
    if (args.mode == "uninstall") return gm::host::run_uninstall_command(args);
    if (args.mode == "--version") {
        std::cout << gm::host::kBuildVersion << " (" << gm::host::kBuildCommit << ")\n";
        return 0;
    }
    std::cerr << kUsage;
    return 2;
}
