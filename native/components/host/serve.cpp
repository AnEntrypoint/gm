#include <iostream>

#if defined(_WIN32)
#include <process.h>
#else
#include <unistd.h>
#endif

#include "gm/host/child.hpp"
#include "gm/host/options.hpp"
#include "gm/host/relay.hpp"
#include "gm/host/update.hpp"
#include "gm/json.hpp"
#include "gm/mcp.hpp"

namespace gm::host {

namespace {

std::filesystem::path worker_executable(const std::filesystem::path& install_dir) {
    std::error_code ec;
    const std::filesystem::path core = install_dir / core_executable_name();
    return std::filesystem::exists(core, ec) ? core : current_executable();
}

std::string relay_process_id() { return gm::mcp::process_identity(); }

}

int run_serve(const HostArgs& args) {
    auto max_inflight = positive_int_flag(args, "--max-inflight", mcp::ServerOptions{}.max_inflight);
    if (!max_inflight) {
        std::cerr << "gm relay: " << max_inflight.error() << '\n';
        return 1;
    }
    const auto workspace = workspace_of(args);
    if (!std::filesystem::is_directory(workspace)) {
        std::cerr << "gm relay: workspace is not a directory: " << workspace.string() << '\n';
        return 1;
    }
    if (auto task = task_of(args); !task) {
        std::cerr << "gm relay: " << task.error() << '\n';
        return 1;
    }
    auto run_dir = choose_run_dir(args, workspace);
    if (!run_dir) {
        std::cerr << "gm relay: " << run_dir.error() << '\n';
        return 1;
    }
    const std::filesystem::path install_dir = current_executable().parent_path();
    RelayOptions options;
    options.worker_argv = {worker_executable(install_dir).string(), "worker"};
    for (std::string& arg : without_flags(args.rest, {"--runs", "--resume", "--run-dir", "--workspace", "--supervised", "--owner", "--resend", "--from-build"}))
        options.worker_argv.push_back(std::move(arg));
    options.worker_argv.insert(options.worker_argv.end(), {"--workspace", workspace.string(), "--run-dir",
                                                           run_dir->string(), "--supervised", "yes", "--owner",
                                                           relay_process_id()});
    options.reexec_argv = {stable_executable(current_executable()).string(), "serve"};
    for (std::string& arg : without_flags(args.rest, {"--runs", "--resume", "--run-dir", "--workspace", "--handshake", "--skill-read", "--resend", "--from-build"}))
        options.reexec_argv.push_back(std::move(arg));
    options.reexec_argv.insert(options.reexec_argv.end(), {"--workspace", workspace.string(), "--run-dir",
                                                           run_dir->string()});
    if (const auto handshake = args.flag("--handshake")) {
        if (auto parsed = json::parse(*handshake)) options.initialize = std::move(*parsed);
    }
    if (const auto resend = args.flag("--resend")) {
        if (auto parsed = json::parse(*resend); parsed && parsed->is_array()) {
            for (const json::Value& line : parsed->as_array()) {
                if (line.is_string()) options.resend.push_back(line.as_string());
            }
        }
    }
    const auto skill_read = args.flag("--skill-read");
    options.skill_read = skill_read && *skill_read == "yes";
    if (const auto from_build = args.flag("--from-build")) options.from_build = *from_build;
    options.build_dir = args.path_or("--build-dir", {});
    options.runtime_roots = {leaves_dir_of(args)};
    options.update = policy_from_environment(install_dir);
    return serve_stdio(std::move(options));
}

}
