#include <iostream>

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
    "       gm install [--mcp-config <file>]\n"
    "       gm --version\n"
    "       gm events (--run <id> [--workspace <dir>] | --dir <run dir>) [--wait [--timeout-ms N]]\n"
    "       gm query (--run <id> [--workspace <dir>] | --dir <run dir>) [--js \"<filter>\"]\n"
    "       gm stop-run --dir <run dir> [--idle-ms N]\n";

}

int main(int argc, char** argv) {
    const gm::host::HostArgs args = gm::host::parse_args(argc, argv);
    if (args.mode == "serve") return gm::host::run_serve(args);
    if (args.mode == "worker") return gm::host::run_worker(args);
    if (args.mode == "doctor") return gm::host::run_doctor(args);
    if (args.mode == "events") return gm::host::run_events(args);
    if (args.mode == "query") return gm::host::run_query_command(args);
    if (args.mode == "stop-run") return gm::host::run_stop(args);
    if (args.mode == "update") return gm::host::run_update_command();
    if (args.mode == "install") return gm::host::run_install_command(args);
    if (args.mode == "--version") {
        std::cout << gm::host::kBuildVersion << " (" << gm::host::kBuildCommit << ")\n";
        return 0;
    }
    std::cerr << kUsage;
    return 2;
}
