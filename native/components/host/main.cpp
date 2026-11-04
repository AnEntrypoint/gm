#include <iostream>

#include "gmnew/host/cli.hpp"
#include "gmnew/host/options.hpp"
#include "gmnew/host/update.hpp"

namespace {

constexpr std::string_view kUsage =
    "usage: gmnew serve|worker --workspace <dir> [--runs <dir>] [--run-dir <dir>] [--resume <id>] [--task <file>] "
    "[--skills <dir>] [--leaves <dir>] [--build-dir <dir>]\n"
    "       gmnew doctor [--leaves <dir>]\n"
    "       gmnew update\n"
    "       gmnew --version\n"
    "       gmnew events (--run <id> [--workspace <dir>] | --dir <run dir>) [--wait [--timeout-ms N]]\n"
    "       gmnew query (--run <id> [--workspace <dir>] | --dir <run dir>) [--js \"<filter>\"]\n";

}

int main(int argc, char** argv) {
    const gmnew::host::HostArgs args = gmnew::host::parse_args(argc, argv);
    if (args.mode == "serve") return gmnew::host::run_serve(args);
    if (args.mode == "worker") return gmnew::host::run_worker(args);
    if (args.mode == "doctor") return gmnew::host::run_doctor(args);
    if (args.mode == "events") return gmnew::host::run_events(args);
    if (args.mode == "query") return gmnew::host::run_query_command(args);
    if (args.mode == "update") return gmnew::host::run_update_command();
    if (args.mode == "--version") {
        std::cout << gmnew::host::kBuildVersion << '\n';
        return 0;
    }
    std::cerr << kUsage;
    return 2;
}
