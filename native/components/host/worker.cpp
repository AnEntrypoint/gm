#include <fstream>
#include <iostream>
#include <mutex>
#include <sstream>

#include "gmnew/core_verbs.hpp"
#include "gmnew/host/child.hpp"
#include "gmnew/host/composed_verbs.hpp"
#include "gmnew/host/options.hpp"
#include "gmnew/host/primitives.hpp"
#include "gmnew/leaves.hpp"
#include "gmnew/log.hpp"
#include "gmnew/mcp.hpp"
#include "gmnew/playwriter.hpp"
#include "gmnew/runcode.hpp"
#include "search.hpp"

namespace gmnew::host {

namespace {

class EmptyVerbs final : public VerbTable {
public:
    std::vector<VerbInfo> list() const override { return {}; }
    json::Value call(std::string_view name, const json::Value&) override {
        json::Value reply;
        reply.set("ok", false);
        reply.set("error", "unknown tool: " + std::string(name));
        return reply;
    }
};

int fail(std::string_view message) {
    std::cerr << "gm mcp: " << message << '\n';
    return 1;
}

deoxidene::Result<std::string, std::string> load_task(const HostArgs& args) {
    auto file = args.flag("--task");
    if (!file) return std::string{};
    std::ifstream in(*file, std::ios::binary);
    if (!in) return deoxidene::Err<std::string>("cannot read the task file " + *file);
    std::ostringstream text;
    text << in.rdbuf();
    std::string task = text.str();
    const auto first = task.find_first_not_of(" \t\r\n");
    const auto last = task.find_last_not_of(" \t\r\n");
    task = first == std::string::npos ? std::string{} : task.substr(first, last - first + 1);
    if (task.empty()) return deoxidene::Err<std::string>("--task is empty");
    return task;
}

}

int run_worker(const HostArgs& args) {
    const auto workspace = workspace_of(args);
    if (!std::filesystem::is_directory(workspace)) return fail("workspace is not a directory: " + workspace.string());
    auto task = load_task(args);
    if (!task) return fail(task.error());
    auto run_dir = choose_run_dir(args, workspace);
    if (!run_dir) return fail(run_dir.error());
    auto current_log = std::make_shared<std::shared_ptr<RunLog>>();
    auto current_log_mutex = std::make_shared<std::mutex>();
    const CurrentLog read_current_log = [current_log, current_log_mutex] {
        std::lock_guard lock(*current_log_mutex);
        return *current_log;
    };

    CoreVerbsOptions core_options;
    core_options.workspace = workspace;
    core_options.on_append = [](const RunLog& log, std::string_view kind, std::uint64_t seq) {
        try {
            mcp::enqueue_pending(log, kind, seq);
        } catch (const std::exception& error) {
            std::cerr << "gm mcp: " << error.what() << '\n';
        }
    };
    CoreVerbs core(std::move(core_options));
    SearchVerbs search(workspace);
    auto native = ComposedVerbs::compose({&core, &search});
    if (!native) return fail(native.error());
    HostServices services{workspace, *run_dir, native->get(), make_primitives(workspace, read_current_log)};
    LeafVerbs leaves(leaves_dir_of(args), services);
    playwriter::Options playwriter_options;
    playwriter_options.workspace = workspace;
    playwriter_options.config_files = {{source_root() / "defaults" / "mcp.json", true}, {workspace / ".gm-new" / "mcp.json", false}};
    if (auto config = args.flag("--mcp-config")) playwriter_options.config_files.push_back({std::filesystem::absolute(*config), true});
    playwriter_options.depth = playwriter::depth_from_environment();
    for (const VerbInfo& verb : (*native)->list()) playwriter_options.reserved.insert(verb.name);
    playwriter::PlaywriterVerbs playwriter_verbs(std::move(playwriter_options));
    auto all = ComposedVerbs::compose({native->get(), &playwriter_verbs, &leaves});
    if (!all) return fail(all.error());

    mcp::ServerOptions options;
    options.workspace = workspace;
    options.runs = run_dir->parent_path();
    options.skills = skills_dir_of(args);
    options.task = *task;
    options.run_dir = *run_dir;
    options.supervised = args.flag("--supervised") == "yes";
    if (auto reason = args.flag("--restart-reason")) options.restart_reason = *reason;
    options.on_run_open = [&core, &leaves, current_log, current_log_mutex](std::shared_ptr<RunLog> log) {
        leaves.set_run_dir(log->dir());
        {
            std::lock_guard lock(*current_log_mutex);
            *current_log = log;
        }
        core.bind_run(std::move(log));
    };
    options.job_snapshot = [&core] {
        json::Value open(json::Array{});
        const json::Value snapshot = core.job_snapshot();
        const json::Value* jobs = snapshot.find("jobs");
        if (jobs == nullptr || !jobs->is_array()) return open;
        for (const json::Value& job : jobs->as_array()) {
            const json::Value* state = job.find("state");
            if (state != nullptr && state->is_string() && state->as_string() == "running") open.push(job);
        }
        return open;
    };
    options.flush_job_events = [&core] { core.flush_job_events(); };
    options.wait_program = current_executable().string();
    options.run_body = [](VerbTable& verbs, std::string_view body, const std::filesystem::path& root) {
        return gmnew::run_body(verbs, body, root);
    };
    return mcp::serve_stream(std::cin, std::cout, **all, std::move(options));
}

int run_doctor(const HostArgs& args) {
    const auto leaves_dir = leaves_dir_of(args);
    EmptyVerbs native;
    HostServices services{std::filesystem::current_path(), {}, &native, make_primitives(std::filesystem::current_path(), {})};
    LeafVerbs leaves(leaves_dir, services);
    std::cout << "abi: gmnew host " << GMNEW_HOST_ABI_VERSION << ", mcp " << mcp::ServerOptions{}.version << '\n';
    std::cout << "leaves: " << leaves_dir.string() << '\n';
    std::error_code ec;
    for (const auto& entry : std::filesystem::directory_iterator(leaves_dir, ec)) {
        if (entry.path().extension() == ".mjs") std::cout << "  file " << entry.path().filename().string() << '\n';
    }
    const auto verbs = leaves.list();
    std::cout << "verbs (" << verbs.size() << "):";
    for (const VerbInfo& verb : verbs) std::cout << ' ' << verb.name;
    std::cout << "\ngeneration: " << leaves.generation() << '\n';
    return 0;
}

}
