#include <iostream>
#include <mutex>

#include "gm/clock.hpp"
#include "gm/core_verbs.hpp"
#include "gm/host/browser_scope.hpp"
#include "gm/host/asan_probe.hpp"
#include "gm/host/child.hpp"
#include "gm/host/composed_verbs.hpp"
#include "gm/host/options.hpp"
#include "gm/host/primitives.hpp"
#include "gm/leaves.hpp"
#include "gm/log.hpp"
#include "gm/mcp.hpp"
#include "gm/mcpclient.hpp"
#include "gm/runcode.hpp"
#include "search.hpp"

namespace gm::host {

namespace {

class BootEvents {
public:
    void emit(std::string_view kind, json::Value fields) {
        std::lock_guard lock(mutex_);
        if (released_ && log_ != nullptr) {
            log_->append(kind, std::move(fields));
            return;
        }
        pending_.emplace_back(std::string(kind), std::move(fields));
    }

    void bind(const std::shared_ptr<RunLog>& log) {
        std::lock_guard lock(mutex_);
        if (log_ == nullptr) log_ = log;
    }

    void release() {
        std::lock_guard lock(mutex_);
        if (released_ || log_ == nullptr) return;
        released_ = true;
        for (auto& [kind, fields] : pending_) log_->append(kind, std::move(fields));
        pending_.clear();
    }

private:
    std::mutex mutex_;
    std::shared_ptr<RunLog> log_;
    std::vector<std::pair<std::string, json::Value>> pending_;
    bool released_ = false;
};

class GatedVerbs final : public VerbTable {
public:
    GatedVerbs(const mcpclient::McpVerbs& gate, BootEvents& events, VerbTable& inner)
        : gate_(gate), events_(events), inner_(inner) {}
    std::vector<VerbInfo> list() const override {
        events_.release();
        return inner_.list();
    }
    json::Value call(std::string_view name, const json::Value& args) override {
        gate_.wait_ready();
        events_.release();
        if (!gate_.serves(name)) {
            if (auto refusal = refuse_unknown_keys(inner_, name, args)) return std::move(*refusal);
        }
        return inner_.call(name, args);
    }

private:
    const mcpclient::McpVerbs& gate_;
    BootEvents& events_;
    VerbTable& inner_;
};

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


}

int run_worker(const HostArgs& args) {
    install_asan_probe();
    const auto workspace = workspace_of(args);
    if (!std::filesystem::is_directory(workspace)) return fail("workspace is not a directory: " + workspace.string());
    auto max_inflight = positive_int_flag(args, "--max-inflight", mcp::ServerOptions{}.max_inflight);
    if (!max_inflight) return fail(max_inflight.error());
    auto stuck_ms = positive_int_flag(args, "--stuck-ms", static_cast<int>(mcp::ServerOptions{}.stuck_ms));
    if (!stuck_ms) return fail(stuck_ms.error());
    auto max_steps = positive_int_flag(args, "--max-steps", mcp::ServerOptions{}.max_steps);
    if (!max_steps) return fail(max_steps.error());
    auto job_lifetime = positive_int_flag(args, "--job-lifetime-ms", static_cast<int>(mcp::ServerOptions{}.job_lifetime_ms));
    if (!job_lifetime) return fail(job_lifetime.error());
    auto monitor_ms = positive_int_flag(args, "--monitor-ms", static_cast<int>(mcp::ServerOptions{}.monitor_ms));
    if (!monitor_ms) return fail(monitor_ms.error());
    auto task = task_of(args);
    if (!task) return fail(task.error());
    auto run_dir = choose_run_dir(args, workspace);
    if (!run_dir) return fail(run_dir.error());
    auto current_log = std::make_shared<std::shared_ptr<RunLog>>();
    auto current_log_mutex = std::make_shared<std::mutex>();
    const CurrentLog read_current_log = [current_log, current_log_mutex] {
        std::lock_guard lock(*current_log_mutex);
        return *current_log;
    };

    auto serve_skill_hook = std::make_shared<std::function<std::optional<std::string>(const std::string&)>>();
    CoreVerbsOptions core_options;
    core_options.workspace = workspace;
    core_options.job_stuck_ms = static_cast<std::uint64_t>(*stuck_ms);
    core_options.job_lifetime_ms = static_cast<std::uint64_t>(*job_lifetime * clock_scale());
    core_options.serve_skill = [serve_skill_hook, skills = skills_dir_of(args)](const std::string& uri) {
        return *serve_skill_hook ? (*serve_skill_hook)(uri) : mcp::served_skill_text(skills, uri);
    };
    const auto queue_pending = [](const RunLog& log, std::string_view kind, std::uint64_t seq) {
        try {
            mcp::enqueue_pending(log, kind, seq);
        } catch (const std::exception& error) {
            std::cerr << "gm mcp: " << error.what() << '\n';
        }
    };
    core_options.on_append = queue_pending;
    CoreVerbs core(std::move(core_options));
    SearchVerbs search(workspace);
    auto native = ComposedVerbs::compose({&core, &search});
    if (!native) return fail(native.error());
    HostServices services{workspace, *run_dir, native->get(), make_primitives(workspace, read_current_log, queue_pending)};
    LeafVerbs leaves(leaves_dir_of(args), services);
    BootEvents boot_events;
    mcpclient::Options mcp_options;
    mcp_options.workspace = workspace;
    mcp_options.config_files = {{defaults_dir_of() / "mcp.json", true}, {workspace / ".gm" / "mcp.json", false}};
    if (auto config = args.flag("--mcp-config")) mcp_options.config_files.push_back({std::filesystem::absolute(*config), true});
    mcp_options.depth = mcpclient::depth_from_environment();
    mcp_options.tool_cache = defaults_dir_of() / "mcp-tools";
    for (const VerbInfo& verb : (*native)->list()) mcp_options.reserved.insert(verb.name);
    for (const VerbInfo& verb : leaves.list()) mcp_options.reserved.insert(verb.name);
    mcp_options.emit = [&boot_events](std::string_view kind, json::Value fields) { boot_events.emit(kind, std::move(fields)); };
    mcpclient::McpVerbs mcp_verbs(std::move(mcp_options));
    auto all = ComposedVerbs::compose({native->get(), &mcp_verbs, &leaves});
    if (!all) return fail(all.error());
    BrowserScope browser(**all);
    GatedVerbs served(mcp_verbs, boot_events, browser);

    mcp::ServerOptions options;
    options.workspace = workspace;
    options.runs = run_dir->parent_path();
    options.skills = skills_dir_of(args);
    options.serve_skill_hook = serve_skill_hook;
    options.task = *task;
    options.max_inflight = *max_inflight;
    options.max_steps = *max_steps;
    options.job_lifetime_ms = static_cast<std::uint64_t>(*job_lifetime * clock_scale());
    options.stuck_ms = static_cast<std::uint64_t>(*stuck_ms);
    options.monitor_ms = static_cast<std::uint64_t>(*monitor_ms);
    options.run_dir = *run_dir;
    options.supervised = args.flag("--supervised") == "yes";
    if (auto owner = args.flag("--owner")) options.connection = *owner;
    if (auto reason = args.flag("--restart-reason")) options.restart_reason = *reason;
    options.on_run_open = [&core, &leaves, &boot_events, current_log, current_log_mutex](std::shared_ptr<RunLog> log) {
        boot_events.bind(log);
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
    options.close_jobs = [&core](const std::string& reason) { core.close(reason); };
    options.release_leases = [&mcp_verbs](const std::string& reason, bool run_end) { mcp_verbs.release_leases(reason, run_end); };
    options.flush_job_events = [&core] { core.flush_job_events(); };
    options.wait_program = current_executable().string();
    options.run_body = [&mcp_verbs, &boot_events](VerbTable& verbs, std::string_view body, const std::filesystem::path& root,
                                                  std::string_view format) {
        mcp_verbs.wait_ready();
        boot_events.release();
        return gm::run_body(verbs, body, root, format);
    };
    return mcp::serve_stream(std::cin, std::cout, served, std::move(options));
}

int run_doctor(const HostArgs& args) {
    const auto leaves_dir = leaves_dir_of(args);
    EmptyVerbs native;
    HostServices services{std::filesystem::current_path(), {}, &native, make_primitives(std::filesystem::current_path(), {})};
    LeafVerbs leaves(leaves_dir, services);
    std::cout << "abi: gm host " << GMNEW_HOST_ABI_VERSION << ", mcp " << mcp::ServerOptions{}.version << '\n';
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
