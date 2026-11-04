#include <iostream>

#include "gmnew/host/options.hpp"

namespace {

constexpr std::string_view kUsage =
    "usage: gmnew serve|worker --workspace <dir> [--runs <dir>] [--run-dir <dir>] [--resume <id>] [--task <file>] "
    "[--skills <dir>] [--leaves <dir>] [--build-dir <dir>]\n"
    "       gmnew doctor [--leaves <dir>]\n";

}

int main(int argc, char** argv) {
    const gmnew::host::HostArgs args = gmnew::host::parse_args(argc, argv);
    if (args.mode == "serve") return gmnew::host::run_serve(args);
    if (args.mode == "worker") return gmnew::host::run_worker(args);
    if (args.mode == "doctor") return gmnew::host::run_doctor(args);
    std::cerr << kUsage;
    return 2;
}
