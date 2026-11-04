#include <iostream>

#include "gmnew/host/child.hpp"
#include "gmnew/host/options.hpp"
#include "gmnew/host/relay.hpp"

namespace gmnew::host {

int run_serve(const HostArgs& args) {
    const auto workspace = workspace_of(args);
    auto run_dir = choose_run_dir(args, workspace);
    if (!run_dir) {
        std::cerr << "gm-new relay: " << run_dir.error() << '\n';
        return 1;
    }
    RelayOptions options;
    options.worker_argv = {current_executable().string(), "worker"};
    for (std::string& arg : without_flags(args.rest, {"--runs", "--resume", "--run-dir", "--workspace", "--supervised"}))
        options.worker_argv.push_back(std::move(arg));
    options.worker_argv.insert(options.worker_argv.end(), {"--workspace", workspace.string(), "--run-dir",
                                                           run_dir->string(), "--supervised", "yes"});
    const auto build_flag = args.flag("--build-dir");
    options.build_dir = build_flag && *build_flag == "none" ? std::filesystem::path{}
                                                            : args.path_or("--build-dir", default_build_dir());
    const auto root = source_root();
    options.watch_roots = {root / "native" / "components", root / "native" / "include", root / "include"};
    return serve_stdio(std::move(options));
}

}  // namespace gmnew::host
