#include <iostream>

#include "gm/host/child.hpp"
#include "gm/host/options.hpp"
#include "gm/host/relay.hpp"
#include "gm/host/update.hpp"
#include "gm/json.hpp"

namespace gm::host {

namespace {

std::filesystem::path worker_executable(const std::filesystem::path& install_dir) {
    std::error_code ec;
    const std::filesystem::path core = install_dir / core_executable_name();
    return std::filesystem::exists(core, ec) ? core : current_executable();
}

}

int run_serve(const HostArgs& args) {
    const auto workspace = workspace_of(args);
    auto run_dir = choose_run_dir(args, workspace);
    if (!run_dir) {
        std::cerr << "gm relay: " << run_dir.error() << '\n';
        return 1;
    }
    const std::filesystem::path install_dir = current_executable().parent_path();
    remove_retired_executable(install_dir);
    RelayOptions options;
    options.worker_argv = {worker_executable(install_dir).string(), "worker"};
    for (std::string& arg : without_flags(args.rest, {"--runs", "--resume", "--run-dir", "--workspace", "--supervised"}))
        options.worker_argv.push_back(std::move(arg));
    options.worker_argv.insert(options.worker_argv.end(), {"--workspace", workspace.string(), "--run-dir",
                                                           run_dir->string(), "--supervised", "yes"});
    options.reexec_argv = {current_executable().string(), "serve"};
    for (std::string& arg : without_flags(args.rest, {"--runs", "--resume", "--run-dir", "--workspace", "--handshake"}))
        options.reexec_argv.push_back(std::move(arg));
    options.reexec_argv.insert(options.reexec_argv.end(), {"--workspace", workspace.string(), "--run-dir",
                                                           run_dir->string()});
    if (const auto handshake = args.flag("--handshake")) {
        if (auto parsed = json::parse(*handshake)) options.initialize = std::move(*parsed);
    }
    const auto build_flag = args.flag("--build-dir");
    options.build_dir = build_flag && *build_flag == "none" ? std::filesystem::path{}
                                                            : args.path_or("--build-dir", default_build_dir());
    const auto root = source_root();
    options.runtime_roots = {leaves_dir_of(args), skills_dir_of(args)};
    options.build_roots = {root / "native" / "components", root / "native" / "include", root / "include"};
    options.update = policy_from_environment(install_dir);
    return serve_stdio(std::move(options));
}

}
