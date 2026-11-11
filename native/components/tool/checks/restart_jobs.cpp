#include "gm/tool.hpp"

#include <chrono>
#include <csignal>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <signal.h>
#include <system_error>
#include <thread>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

constexpr const char* kJob = "carry";
constexpr const char* kJobCommand = "sleep 8; echo done";
constexpr std::int64_t kCallMs = 90000;
constexpr std::uint64_t kWatchdogMs = 240000;

std::int64_t since_ms(std::chrono::steady_clock::time_point from) {
    return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - from).count();
}

std::string clip(const json::Value& value, std::size_t size) { return json::dump(value).substr(0, size); }

json::Value call(Session& session, const std::string& name, json::Value args) {
    const std::int64_t id = session.send("tools/call", json::Object{{"name", name}, {"arguments", std::move(args)}});
    const auto reply = id < 0 ? std::nullopt : session.await_reply(id, std::chrono::milliseconds(kCallMs));
    if (!reply) return json::Object{{"error", "no answer to " + name + " within " + std::to_string(kCallMs) + " ms"}};
    if (const json::Value* error = reply->find("error")) return json::Object{{"error", text_at(*error, "message")}};
    const json::Value* content = value_at(*reply, "result.content");
    const json::Value* first = content != nullptr && content->is_array() && !content->as_array().empty() ? content->as_array().front().find("text") : nullptr;
    const std::string text = first != nullptr && first->is_string() ? first->as_string() : std::string();
    auto parsed = json::parse(text);
    if (!parsed) return json::Object{{"error", text}};
    json::Value envelope = *parsed;
    const json::Value* output = envelope.find("output");
    const bool placeholder = output != nullptr && output->is_string() && output->as_string() == "[the output is the text block after this one]";
    if (placeholder && content->as_array().size() > 1) {
        const json::Value* second = content->as_array()[1].find("text");
        const std::string value = second != nullptr && second->is_string() ? second->as_string() : std::string();
        if (auto value_json = json::parse(value)) envelope.set("output", *value_json);
        else envelope.set("output", value);
    }
    return envelope;
}

json::Value run_code(Session& session, const std::string& body) {
    const json::Value reply = call(session, "run_code", json::Object{{"format", "esm"}, {"timeoutMs", 120000}, {"body", body}});
    if (const json::Value* error = reply.find("error"); error != nullptr && !error->is_null() && !(error->is_bool() && !error->as_bool()) && !(error->is_string() && error->as_string().empty()))
        return json::Object{{"error", *error}};
    return output_value(reply);
}

std::string status_body(int wait_ms) {
    return "return await gm.job_status({ job: " + json::quote(kJob) + ", waitMs: " + std::to_string(wait_ms) + " });";
}

std::vector<json::Value> list_of(const json::Value* value) {
    if (value == nullptr) return {};
    json::Value body = value->find("output") != nullptr ? output_value(*value) : *value;
    if (body.is_array()) return body.as_array();
    for (const char* key : {"events", "records"}) {
        if (const json::Value* found = body.find(key); found != nullptr && !found->is_null()) return found->is_array() ? found->as_array() : std::vector<json::Value>{};
    }
    return {};
}

bool alive(long long pid) { return pid > 0 && !alive_of({pid}).empty(); }

std::vector<long long> engine_processes(const fs::path& workspace) {
    std::vector<long long> found;
    for (const long long pid : alive_of(processes_mentioning(workspace.string()))) {
        std::ifstream cmdline(fs::path("/proc") / std::to_string(pid) / "cmdline", std::ios::binary);
        const std::string bytes((std::istreambuf_iterator<char>(cmdline)), std::istreambuf_iterator<char>());
        for (const std::string& arg : nul_split(bytes)) {
            if (arg == "worker") {
                found.push_back(pid);
                break;
            }
        }
    }
    return found;
}

bool contains(const std::vector<long long>& pids, long long pid) {
    for (const long long known : pids) {
        if (known == pid) return true;
    }
    return false;
}

double number_or(const json::Value& value, const std::string& dotted, double fallback) {
    const json::Value* found = value_at(value, dotted);
    return found != nullptr && found->is_number() ? found->as_number() : fallback;
}

}

CheckResult check_restart_jobs(const std::string& binary) {
    CheckResult result;
    const auto started = std::chrono::steady_clock::now();
    const auto stamp = started.time_since_epoch().count();
    const fs::path sandbox = fs::temp_directory_path() / ("gm-restart-jobs-" + std::to_string(stamp));
    const fs::path workspace = sandbox / "ws";
    const fs::path bin_dir = sandbox / "bin";
    const fs::path mcp_config = sandbox / "no-default-mcp.json";
    fs::create_directories(workspace);
    fs::create_directories(bin_dir);
    std::ofstream(mcp_config) << R"({"mcpServers":{"playwriter":{"disabled":true}}})";
    const fs::path source = fs::absolute(binary);
    const fs::path copied = bin_dir / source.filename();
    std::error_code copy_ec;
    fs::copy_file(source, copied, fs::copy_options::overwrite_existing, copy_ec);
    for (const char* sub : {"leaves", "skills", "defaults"}) {
        if (!copy_ec) fs::copy(source.parent_path() / sub, bin_dir / sub, fs::copy_options::recursive, copy_ec);
    }
    if (!copy_ec) fs::permissions(copied, fs::perms::owner_all | fs::perms::group_read | fs::perms::group_exec | fs::perms::others_read | fs::perms::others_exec, copy_ec);
    if (copy_ec) {
        result.failures.push_back("cannot copy the binary and its leaves, skills and defaults into " + bin_dir.string() + ": " + copy_ec.message());
        std::error_code ignored;
        fs::remove_all(sandbox, ignored);
        return result;
    }
    const std::vector<std::string> argv{copied.string(), "serve", "--workspace", workspace.string(), "--mcp-config", mcp_config.string()};
    long long job_pid = -1;
    std::string how;
    std::int64_t worker_replaced_ms = -1;
    std::int64_t restart_ms = -1;
    std::int64_t alive_ms = -1;
    std::int64_t end_ms = -1;
    std::size_t carried_count = 0;
    {
        Session session(argv, workspace, sandbox, kWatchdogMs);
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + copied.string());
        } else {
            session.rpc("initialize", json::Object{{"protocolVersion", "2025-06-18"}, {"capabilities", json::Object{}},
                                                  {"clientInfo", json::Object{{"name", "gm-restart-jobs-check"}, {"version", "1"}}}});
            session.notify("notifications/initialized", json::Object{});
            session.rpc("resources/read", json::Object{{"uri", "skill://gm/SKILL.md"}});
            call(session, "next_context", json::Object{});

            const json::Value started_job = run_code(session, "return await gm.job_start({ job: " + json::quote(kJob) + ", command: " + json::quote(kJobCommand) + ", timeoutMs: 120000 });");
            const json::Value* ok = value_at(started_job, "ok");
            if (ok == nullptr || !ok->is_bool() || !ok->as_bool()) result.failures.push_back("job_start: " + clip(started_job, 200));
            const json::Value before_status = run_code(session, status_body(0));
            const json::Value* pid_value = value_at(before_status, "pid");
            job_pid = pid_value != nullptr && pid_value->is_number() ? static_cast<long long>(pid_value->as_number()) : -1;
            if (job_pid < 0 || !alive(job_pid))
                result.failures.push_back("before the restart the job's process " + (job_pid < 0 ? std::string("null") : std::to_string(job_pid)) + " was not alive");

            const auto workers_before = engine_processes(workspace);
            const auto triggered_at = std::chrono::steady_clock::now();
            std::error_code touch_ec;
            fs::last_write_time(copied, fs::file_time_type::clock::now() + std::chrono::seconds(60), touch_ec);
            how = "binary mtime changed at " + copied.string() + " (the relay's binary-change restart)";
            if (touch_ec) result.failures.push_back("cannot change the mtime of " + copied.string() + ": " + touch_ec.message());
            std::vector<long long> replacement;
            while (since_ms(triggered_at) < kCallMs) {
                replacement.clear();
                for (const long long pid : engine_processes(workspace)) {
                    if (!contains(workers_before, pid)) replacement.push_back(pid);
                }
                if (!replacement.empty()) break;
                std::this_thread::sleep_for(std::chrono::milliseconds(50));
            }
            worker_replaced_ms = since_ms(triggered_at);
            if (replacement.empty()) result.failures.push_back("no replacement worker appeared within " + std::to_string(kCallMs) + " ms of the trigger");
            json::Value answered;
            while (!replacement.empty() && since_ms(triggered_at) < kCallMs) {
                answered = run_code(session, status_body(0));
                if (value_at(answered, "state") != nullptr) break;
                std::this_thread::sleep_for(std::chrono::milliseconds(200));
            }
            restart_ms = since_ms(triggered_at);
            if (value_at(answered, "state") == nullptr) result.failures.push_back("after the restart job_status did not answer: " + clip(answered, 200));

            const bool job_alive = job_pid >= 0 && alive(job_pid);
            alive_ms = since_ms(triggered_at);
            if (!job_alive) result.failures.push_back("after the restart the job's process " + std::to_string(job_pid) + " is gone (ps reports no live row)");
            if (text_at(answered, "state") != "running") {
                const json::Value* state = value_at(answered, "state");
                result.failures.push_back("after the restart job_status reports " + (state != nullptr ? json::dump(*state) : std::string("undefined")) + ", expected running");
            }

            json::Value ended = answered;
            const auto wait_start = std::chrono::steady_clock::now();
            while (text_at(ended, "state") == "running" && since_ms(wait_start) < 60000) ended = run_code(session, status_body(5000));
            end_ms = since_ms(triggered_at);
            if (text_at(ended, "state") != "exited" || number_or(ended, "exitCode", -1) != 0)
                result.failures.push_back("the job ended " + clip(ended, 240) + ", expected exited with exitCode 0");
            const json::Value* output = value_at(ended, "output");
            const std::string output_text = output == nullptr || output->is_null() ? std::string() : output->is_string() ? output->as_string() : json::dump(*output);
            if (output_text.find("done") == std::string::npos)
                result.failures.push_back("the job output was " + (output != nullptr ? json::dump(*output) : std::string("undefined")) + ", expected done");

            const json::Value logs = run_code(session, "return { job: await gm.query_log({ kind: 'job' }), killed: await gm.query_log({ kind: 'job-killed' }), restart: await gm.query_log({ kind: 'restart' }) };");
            std::vector<json::Value> job_events;
            std::vector<json::Value> killed_on_restart;
            std::size_t carried = 0;
            for (const json::Value& event : list_of(value_at(logs, "job"))) {
                if (text_at(event, "job") != kJob) continue;
                job_events.push_back(event);
                const json::Value* flag = event.find("carried");
                if (flag != nullptr && flag->is_bool() && flag->as_bool()) ++carried;
                if (text_at(event, "reason") == "restart") killed_on_restart.push_back(event);
            }
            for (const json::Value& event : list_of(value_at(logs, "killed"))) {
                if (text_at(event, "job") == kJob && text_at(event, "reason") == "restart") killed_on_restart.push_back(event);
            }
            const auto restarts = list_of(value_at(logs, "restart"));
            carried_count = carried;
            const json::Value* restart_value = value_at(logs, "restart");
            if (restarts.empty()) result.failures.push_back("the log has no restart event: " + (restart_value != nullptr ? clip(*restart_value, 300) : std::string("undefined")));
            if (carried == 0) result.failures.push_back(std::string("the log has no carry-over event for ") + kJob + ": " + clip(json::Value(job_events), 300));
            if (!killed_on_restart.empty()) result.failures.push_back(std::string("the log records ") + kJob + " killed with reason restart: " + clip(json::Value(killed_on_restart), 300));
        }
        session.stop();
    }
    if (job_pid > 0 && alive(job_pid)) ::kill(static_cast<pid_t>(-job_pid), SIGKILL);
    kill_processes(engine_processes(workspace));
    std::error_code ignored;
    fs::remove_all(sandbox, ignored);
    const double wall = std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count();
    if (result.failures.empty()) {
        result.summary = "native: " + how + "; the job's process " + std::to_string(job_pid) + " was alive " + std::to_string(alive_ms) + " ms after the trigger; the restart answered in " +
                         std::to_string(restart_ms) + " ms; the job exited 0 with output \"done\" at " + std::to_string(end_ms) + " ms; carry-over events " + std::to_string(carried_count) +
                         "; killed with reason restart 0";
    } else {
        result.summary = "timings: trigger " + how + "; workerReplacedMs " + std::to_string(worker_replaced_ms) + "; restartMs " + std::to_string(restart_ms) + "; aliveMs " +
                         std::to_string(alive_ms) + "; endMs " + std::to_string(end_ms);
    }
    result.summary += " (wall " + std::to_string(wall) + " s)";
    return result;
}

}
