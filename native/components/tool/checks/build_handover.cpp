#include "gm/tool.hpp"
#if !defined(_WIN32)

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <system_error>
#include <thread>
#include <unistd.h>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

constexpr double kScale = 0.1;
constexpr const char* kCheck = "build-handover-check";
constexpr const char* kQuiet = R"({"mcpServers":{"playwriter":{"disabled":true}}})";

std::string read_text(const fs::path& file) {
    std::ifstream in(file, std::ios::binary);
    std::ostringstream text;
    text << in.rdbuf();
    return text.str();
}

std::string tail_of(const std::string& text, std::size_t count) {
    return text.size() > count ? text.substr(text.size() - count) : text;
}

void scaled_sleep(long long ms) {
    std::this_thread::sleep_for(std::chrono::milliseconds(static_cast<long long>(static_cast<double>(ms) * kScale)));
}

std::string stamp_of(const fs::path& gm) {
    const auto version = proc::run({gm.string(), "--version"}, {}, {}, 20000);
    std::istringstream words(version.out);
    std::string first;
    words >> first;
    return first;
}

std::string replace_all(std::string text, const std::string& from, const std::string& to) {
    if (from.empty()) return text;
    std::string out;
    std::size_t start = 0;
    for (std::size_t at = text.find(from); at != std::string::npos; at = text.find(from, start)) {
        out.append(text, start, at - start);
        out += to;
        start = at + from.size();
    }
    out.append(text, start, std::string::npos);
    return out;
}

void make_executable(const fs::path& file) {
    std::error_code ec;
    fs::permissions(file, fs::perms::owner_all | fs::perms::group_read | fs::perms::group_exec | fs::perms::others_read | fs::perms::others_exec, fs::perm_options::replace, ec);
}

void place(const fs::path& versions, const fs::path& host, const std::string& stamp, const std::string& version, bool patch) {
    const fs::path dir = versions / version;
    fs::create_directories(dir);
    for (const char* name : {"gm", "gm-core"}) {
        const fs::path from = host / name;
        std::error_code ec;
        if (patch) {
            std::ofstream(dir / name, std::ios::binary) << replace_all(read_text(from), stamp, version);
            make_executable(dir / name);
        } else {
            fs::copy_file(from, dir / name, fs::copy_options::overwrite_existing, ec);
        }
    }
    for (const char* sub : {"leaves", "skills", "defaults"}) {
        std::error_code ec;
        fs::copy(host / sub, dir / sub, fs::copy_options::recursive | fs::copy_options::copy_symlinks | fs::copy_options::overwrite_existing, ec);
    }
}

void point(const fs::path& install, const std::string& version) {
    const fs::path link = install / ("current." + std::to_string(getpid()));
    std::error_code ec;
    fs::remove(link, ec);
    fs::create_directory_symlink(fs::path("versions") / version, link, ec);
    fs::rename(link, install / "current", ec);
}

std::vector<long long> children_of(long long pid) {
    std::vector<long long> found;
    std::error_code ec;
    for (const auto& entry : fs::directory_iterator("/proc", ec)) {
        const std::string name = entry.path().filename().string();
        if (name.empty() || name.find_first_not_of("0123456789") != std::string::npos) continue;
        std::ifstream stat(entry.path() / "stat");
        std::string line;
        std::getline(stat, line);
        const auto close = line.rfind(')');
        if (close == std::string::npos || close + 2 > line.size()) continue;
        std::istringstream rest(line.substr(close + 2));
        std::string state;
        long long parent = 0;
        rest >> state >> parent;
        if (parent == pid) found.push_back(std::stoll(name));
    }
    std::sort(found.begin(), found.end());
    return found;
}

std::string pids_text(const std::vector<long long>& pids) {
    std::string text;
    for (long long pid : pids) {
        if (!text.empty()) text.push_back(',');
        text += std::to_string(pid);
    }
    return text;
}

std::string worker_exe(const Session& relay) {
    for (long long pid : children_of(relay.pid())) {
        std::error_code ec;
        const fs::path exe = fs::read_symlink("/proc/" + std::to_string(pid) + "/exe", ec);
        if (!ec) return exe.string();
    }
    return "no worker";
}

std::vector<json::Value> log_events(const fs::path& log) {
    std::vector<json::Value> events;
    std::ifstream in(log);
    std::string line;
    while (std::getline(in, line)) {
        if (line.empty()) continue;
        if (auto parsed = json::parse(line)) events.push_back(*parsed);
    }
    return events;
}

json::Value await_or_null(Session& session, std::int64_t id, long long ms) {
    if (id < 0) return json::Value();
    const auto reply = session.await_reply(id, std::chrono::milliseconds(ms));
    return reply ? *reply : json::Value();
}

json::Value request(Session& session, const std::string& method, json::Value params, long long ms = 60000) {
    return await_or_null(session, session.send(method, std::move(params)), ms);
}

std::int64_t send_call(Session& session, const std::string& name, json::Value args) {
    return session.send("tools/call", json::Object{{"name", name}, {"arguments", std::move(args)}});
}

json::Value structured_of(const json::Value& reply) {
    const json::Value* found = value_at(reply, "result.structuredContent");
    return found != nullptr ? *found : json::Value();
}

json::Value call(Session& session, const std::string& name, json::Value args, long long ms = 60000) {
    return structured_of(await_or_null(session, send_call(session, name, std::move(args)), ms));
}

void connect(Session& session, long long ms = 60000) {
    request(session, "initialize", json::Object{{"protocolVersion", "2025-06-18"}, {"capabilities", json::Object{}}, {"clientInfo", json::Object{{"name", kCheck}, {"version", "1"}}}}, ms);
    session.notify("notifications/initialized", json::Object{});
}

bool flag(const json::Value& value, const std::string& dotted, bool expected) {
    const json::Value* found = value_at(value, dotted);
    return found != nullptr && found->is_bool() && found->as_bool() == expected;
}

std::string output_text(const json::Value& value) {
    const json::Value* output = value.find("output");
    if (output == nullptr) return "undefined";
    return output->is_string() ? output->as_string() : json::dump(*output);
}

bool output_is(const json::Value& value, const std::string& expected) {
    const json::Value* output = value.find("output");
    return output != nullptr && output->is_string() && output->as_string() == expected;
}

std::string clipped(const json::Value& value, std::size_t count) {
    return json::dump(value).substr(0, count);
}

std::string kind_of(const json::Value& event) {
    return text_at(event, "kind");
}

std::string note_text(const json::Value& note) {
    const json::Value* data = value_at(note, "params.data");
    if (data == nullptr) return {};
    return data->is_string() ? data->as_string() : json::dump(*data);
}

json::Value first_text_json(const json::Value& reply) {
    const json::Value* content = value_at(reply, "result.content");
    if (content == nullptr || !content->is_array() || content->as_array().empty()) return json::Value();
    auto parsed = json::parse(text_at(content->as_array().front(), "text"));
    return parsed ? *parsed : json::Value();
}

std::size_t blocks_with(const json::Value& reply, const std::string& text) {
    const json::Value* content = value_at(reply, "result.content");
    if (content == nullptr || !content->is_array()) return 0;
    return static_cast<std::size_t>(std::count_if(content->as_array().begin(), content->as_array().end(), [&](const json::Value& block) {
        const json::Value* part = block.find("text");
        return part != nullptr && part->is_string() && part->as_string() == text;
    }));
}

fs::path find_repo() {
    for (fs::path dir = fs::current_path();; dir = dir.parent_path()) {
        std::error_code ec;
        if (fs::exists(dir / "skills" / "gm" / "SKILL.md", ec)) return dir;
        if (dir == dir.parent_path()) return {};
    }
}

void check_relay_handover(CheckResult& result, Session& relay, const fs::path& install, const fs::path& run_dir, const std::string& stamp, const std::string& second) {
    connect(relay);
    request(relay, "resources/read", json::Object{{"uri", "skill://gm/SKILL.md"}});
    call(relay, "next_context", json::Object{});
    const std::size_t before = log_events(run_dir / "log.jsonl").size();
    const std::string on_a = worker_exe(relay);
    if (on_a.find((fs::path("versions") / stamp).string()) == std::string::npos) result.failures.push_back("the first worker should run " + stamp + ", runs " + on_a);

    const std::int64_t held = send_call(relay, "run_code", json::Object{{"body", "const end = Date.now() + " + std::to_string(static_cast<long long>(5000 * kScale + 0.5)) + "; while (Date.now() < end) {} return \"held on A\";"}});
    scaled_sleep(1500);
    point(install, second);
    const json::Value body = structured_of(await_or_null(relay, held, 60000));
    if (!output_is(body, "held on A")) result.failures.push_back("the body in flight should finish on the old build: " + clipped(body, 200));

    scaled_sleep(4000);
    const json::Value after = call(relay, "run_code", json::Object{{"body", "return (await gm.run_shell({ command: \"echo answered\" })).output;"}});
    if (!flag(after, "ok", true) || output_text(after).find("answered") == std::string::npos) result.failures.push_back("the next call should be answered by the new build: " + clipped(after, 200));
    const std::string on_b = worker_exe(relay);
    if (on_b.find((fs::path("versions") / second).string()) == std::string::npos) result.failures.push_back("the worker should run " + second + " after the hand-over, runs " + on_b);
    const std::string change = "gm build changed from " + stamp + " to " + second;
    bool noticed = false;
    json::Array notice_texts;
    for (const json::Value& note : relay.notes()) {
        if (text_at(note, "method") != "notifications/message") continue;
        const std::string text = note_text(note);
        notice_texts.push_back(text);
        if (text.find(change) != std::string::npos) noticed = true;
    }
    if (!noticed) result.failures.push_back("the session should get one notice of the change: " + json::dump(notice_texts));

    const auto log = log_events(run_dir / "log.jsonl");
    std::vector<json::Value> restarts;
    std::ptrdiff_t restart_at = -1;
    for (std::size_t index = 0; index < log.size(); ++index) {
        if (kind_of(log[index]) != "restart") continue;
        if (restart_at < 0) restart_at = static_cast<std::ptrdiff_t>(index);
        restarts.push_back(log[index]);
    }
    json::Array reloaded;
    if (restart_at >= 0) {
        for (std::size_t index = static_cast<std::size_t>(restart_at); index < log.size(); ++index) {
            if (kind_of(log[index]) == "skill-loaded") reloaded.push_back(log[index]);
        }
    }
    if (!(restart_at > 0 && reloaded.empty())) result.failures.push_back("an unchanged skill should not be read again after the hand-over: " + json::dump(reloaded));
    const std::string restarts_text = json::dump(json::Array(restarts.begin(), restarts.end()));
    if (!(restarts.size() == 1 && flag(restarts[0], "skillRead", true) && flag(restarts[0], "skillChanged", false)))
        result.failures.push_back("an unchanged skill should carry over without a re-read: " + restarts_text);
    const bool fingerprint = restarts.size() == 1 && value_at(restarts[0], "skillSha") != nullptr && value_at(restarts[0], "skillSha")->is_string() &&
                             value_at(restarts[0], "skillWas") != nullptr && value_at(restarts[0], "skillWas")->is_string() &&
                             text_at(restarts[0], "skillSha") == text_at(restarts[0], "skillWas");
    if (!fingerprint) result.failures.push_back("the restart should record the fingerprint it matched: " + restarts_text);
    if (std::count_if(log.begin(), log.end(), [](const json::Value& event) { return kind_of(event) == "start"; }) != 1)
        result.failures.push_back("the run should keep one start event across the hand-over");
    if (log.size() <= before) result.failures.push_back("the run log should keep growing across the hand-over");
    bool continuous = true;
    for (std::size_t index = 1; index < log.size(); ++index) {
        const json::Value* seq = log[index].find("seq");
        const json::Value* previous = log[index - 1].find("seq");
        if (seq == nullptr || previous == nullptr || !seq->is_number() || !previous->is_number() || seq->as_number() != previous->as_number() + 1) continuous = false;
    }
    if (!continuous) result.failures.push_back("the run log seq should stay continuous across the hand-over");
}

void check_direct_handover(CheckResult& result, const fs::path& host, const fs::path& workspace, const fs::path& sandbox, const fs::path& quiet, const std::string& stamp) {
    const std::string older = "0b7a16b961ae-dev";
    const fs::path direct_run = workspace / "runs" / "direct";
    const auto serve_args = [&](const std::string& from_build) {
        std::vector<std::string> args{(host / "gm").string(), "serve", "--workspace", workspace.string(), "--run-dir", direct_run.string(), "--mcp-config", quiet.string()};
        if (!from_build.empty()) {
            args.push_back("--from-build");
            args.push_back(from_build);
        }
        return args;
    };
    {
        Session first_run(serve_args(""), workspace, sandbox, 300000);
        connect(first_run);
        call(first_run, "next_context", json::Object{});
        first_run.stop();
    }
    scaled_sleep(500);
    json::Value first_reply;
    json::Value second_reply;
    {
        Session restarted(serve_args(older), workspace, sandbox, 300000);
        connect(restarted);
        request(restarted, "resources/read", json::Object{{"uri", "skill://gm/SKILL.md"}});
        first_reply = await_or_null(restarted, send_call(restarted, "run_code", json::Object{{"body", "return \"direct\";"}}), 60000);
        second_reply = await_or_null(restarted, send_call(restarted, "run_code", json::Object{{"body", "return \"again\";"}}), 60000);
        restarted.stop();
    }
    const std::string notice_line = "gm build changed from " + older + " to " + stamp + "; this session now runs " + stamp + ", and its run carries over";
    if (blocks_with(first_reply, notice_line) != 1) result.failures.push_back("the first reply after a hand-over should carry the notice once: " + clipped(first_reply, 300));
    const json::Value first_carried = first_text_json(first_reply);
    if (text_at(first_carried, "handover") != notice_line)
        result.failures.push_back("the first reply's text JSON should carry the notice in handover, which the host keeps: " + clipped(first_carried, 300));
    if (first_text_json(second_reply).find("handover") != nullptr) result.failures.push_back("the handover field should not repeat on the next reply");
    if (blocks_with(second_reply, notice_line) != 0) result.failures.push_back("the notice should not repeat on the next reply");
    const auto direct_restarts = run_events(direct_run / "log.jsonl", "restart");
    if (!(direct_restarts.size() == 1 && text_at(direct_restarts[0], "reason") == "build " + older + " -> " + stamp))
        result.failures.push_back("the restart should name the build change: " + json::dump(json::Array(direct_restarts.begin(), direct_restarts.end())));
}

void check_broken_refused(CheckResult& result, Session& relay, const fs::path& install, const std::string& second, const std::string& broken) {
    point(install, broken);
    const std::string refused = "refused build " + broken;
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(60000);
    while (relay.stderr_text().find(refused) == std::string::npos && std::chrono::steady_clock::now() < deadline) scaled_sleep(250);
    const json::Value still = call(relay, "run_code", json::Object{{"body", "return \"still on B\";"}});
    if (!output_is(still, "still on B")) result.failures.push_back("a broken build must not take the session: " + clipped(still, 200));
    if (worker_exe(relay).find((fs::path("versions") / second).string()) == std::string::npos) result.failures.push_back("a broken build must leave the worker on its build");
    if (relay.stderr_text().find(refused) == std::string::npos) result.failures.push_back("the relay should name the refused build: " + tail_of(relay.stderr_text(), 300));
}

void check_leaf_restart(CheckResult& result, const fs::path& sandbox, const fs::path& install, const fs::path& quiet, const std::string& stamp) {
    const fs::path leaf_sandbox = sandbox / "leaf";
    const fs::path leaves_dir = leaf_sandbox / "leaves";
    const fs::path skills_dir = leaf_sandbox / "skills" / "gm";
    const fs::path leaf_workspace = leaf_sandbox / "ws";
    fs::create_directories(leaves_dir);
    fs::create_directories(skills_dir);
    fs::create_directories(leaf_workspace);
    std::ofstream(leaves_dir / "probe.mjs") << "export const v = 1;\n";
    std::ofstream(skills_dir / "SKILL.md") << "# skill\n";
    point(install, stamp);
    Session leaf({(install / "current" / "gm").string(), "serve", "--workspace", leaf_workspace.string(), "--run-dir", (leaf_workspace / "runs" / "leaf").string(), "--mcp-config", quiet.string(),
                  "--leaves", leaves_dir.string(), "--skills", (leaf_sandbox / "skills").string()},
                 leaf_workspace, sandbox, 600000);
    connect(leaf, 90000);
    request(leaf, "resources/read", json::Object{{"uri", "skill://gm/SKILL.md"}}, 90000);
    request(leaf, "tools/call", json::Object{{"name", "next_context"}, {"arguments", json::Object{}}}, 90000);
    const auto workers_before_skill = children_of(leaf.pid());
    std::ofstream(skills_dir / "SKILL.md") << "# a skill-only edit\n";
    scaled_sleep(3000);
    const auto after_skill = children_of(leaf.pid());
    if (after_skill != workers_before_skill)
        result.failures.push_back("a skill-only change must not restart the worker: before " + pids_text(workers_before_skill) + " after " + pids_text(after_skill));
    const std::int64_t wait_in_flight = send_call(leaf, "next_context", json::Object{{"waitMs", 32000}});
    scaled_sleep(1500);
    std::ofstream(leaves_dir / "probe.mjs") << "export const v = 2;\n";
    const json::Value waited = await_or_null(leaf, wait_in_flight, 60000);
    if (waited.find("result") == nullptr || json::dump(waited).find("restarted before it answered") != std::string::npos)
        result.failures.push_back("a next_context wait in flight at a leaf restart must be answered, not abandoned: " + clipped(waited, 200));
    scaled_sleep(2000);
    if (children_of(leaf.pid()) == workers_before_skill) result.failures.push_back("a leaf change should restart the worker");
    leaf.stop();
}

void check_long_call(CheckResult& result, Session& relay, const fs::path& versions, const fs::path& install, const fs::path& host, const std::string& stamp, const std::string& second) {
    const std::string third = std::string(1, stamp[0] == '9' || second[0] == '9' ? '8' : '9') + stamp.substr(1);
    place(versions, host, stamp, third, true);
    char seconds[32];
    std::snprintf(seconds, sizeof seconds, "%.2f", 35 * kScale);
    const std::int64_t long_call = send_call(relay, "run_code", json::Object{{"body", std::string("return (await gm.run_shell({ command: \"sleep ") + seconds + "; echo install-done\", timeoutMs: 120000 })).output;"}});
    scaled_sleep(1500);
    point(install, third);
    const json::Value long_reply = structured_of(await_or_null(relay, long_call, 150000));
    const json::Value* output = long_reply.find("output");
    const std::string long_text = output == nullptr ? std::string() : output->is_string() ? output->as_string() : json::dump(*output);
    if (long_text.find("install-done") == std::string::npos || !flag(long_reply, "ok", true))
        result.failures.push_back("a 35 s shell call in flight must finish on the build it started on, not be cut by the install: " + clipped(long_reply, 200));
    scaled_sleep(4000);
    const std::string exe = worker_exe(relay);
    if (exe.find((fs::path("versions") / third).string()) == std::string::npos) result.failures.push_back("the worker should run " + third + " once the shell call finished, runs " + exe);
}

void check_identical_install(CheckResult& result, const fs::path& sandbox, const fs::path& host, const fs::path& repo, const fs::path& quiet) {
    const fs::path home = sandbox / "home";
    fs::create_directories(home);
    const fs::path build = host.parent_path().parent_path().parent_path();
    const auto install_once = [&] {
        return proc::run({"env", "HOME=" + home.string(), "USERPROFILE=" + home.string(), (build / "native" / "components" / "host" / "gm").string(), "install", "--local", build.string(), "--source", repo.string()},
                         repo, {}, 120000);
    };
    const auto first = install_once();
    if (!first.started || first.exit_code != 0) result.failures.push_back("the first local install should succeed: " + first.err);
    const fs::path home_workspace = sandbox / "home-ws";
    fs::create_directories(home_workspace);
    Session home_relay({(home / ".gmnew" / "current" / "gm").string(), "serve", "--workspace", home_workspace.string(), "--run-dir", (home_workspace / "runs" / "same").string(), "--mcp-config", quiet.string(),
                        "--skill-read", "yes"},
                       home_workspace, home, 600000);
    connect(home_relay);
    request(home_relay, "tools/call", json::Object{{"name", "next_context"}, {"arguments", json::Object{}}});
    const auto workers_before = children_of(home_relay.pid());
    if (workers_before.empty()) result.failures.push_back("the home relay should have a worker before the identical install");
    const auto again = install_once();
    if (!again.started || again.exit_code != 0) result.failures.push_back("the identical install should succeed: " + again.err);
    if (again.out.find("the binaries and their processes were kept") == std::string::npos) result.failures.push_back("the identical install should keep the binaries: " + again.out);
    scaled_sleep(3000);
    const auto workers_after = children_of(home_relay.pid());
    if (workers_after != workers_before)
        result.failures.push_back("an identical install must leave every worker pid unchanged: before " + pids_text(workers_before) + " after " + pids_text(workers_after));
    home_relay.stop();
}

}

CheckResult check_build_handover(const std::string& binary) {
    CheckResult result;
    const auto started = std::chrono::steady_clock::now();
    std::error_code exists_ec;
    const fs::path given = fs::absolute(binary);
    const fs::path host = fs::exists(given / "gm", exists_ec) ? given : given.parent_path();
    const fs::path repo = find_repo();
    if (repo.empty()) {
        result.failures.push_back("run from the checkout: no skills/gm/SKILL.md in the working directory or its parents");
        return result;
    }
    set_env("GMNEW_TEST_CLOCK", "1");
    set_env("GM_CLOCK_SCALE", "0.1");
    const std::string stamp = stamp_of(host / "gm");
    if (stamp.empty()) {
        result.failures.push_back("the build under test reports no stamp: " + stamp);
        unset_env("GMNEW_TEST_CLOCK");
        unset_env("GM_CLOCK_SCALE");
        return result;
    }
    const fs::path sandbox = fs::temp_directory_path() / ("gm-handover-" + std::to_string(started.time_since_epoch().count()));
    const fs::path install = sandbox / "install";
    const fs::path versions = install / "versions";
    const std::string second = std::string(1, stamp[0] == '0' ? '1' : '0') + stamp.substr(1);
    const std::string broken = "broken-dev";
    const fs::path broken_dir = versions / broken;
    fs::create_directories(broken_dir);
    for (const char* name : {"gm", "gm-core"}) {
        std::ofstream(broken_dir / name) << "#!/bin/sh\necho broken\nexit 1\n";
        make_executable(broken_dir / name);
    }
    place(versions, host, stamp, stamp, false);
    place(versions, host, stamp, second, true);
    point(install, stamp);
    const fs::path workspace = sandbox / "ws";
    fs::create_directories(workspace);
    const fs::path quiet = sandbox / "quiet.json";
    std::ofstream(quiet) << kQuiet;
    const fs::path run_dir = workspace / "runs" / "hand";
    {
        Session relay({(install / "current" / "gm").string(), "serve", "--workspace", workspace.string(), "--run-dir", run_dir.string(), "--mcp-config", quiet.string(), "--skill-read", "yes"},
                      workspace, sandbox, 1800000);
        if (!relay.started()) {
            result.failures.push_back("the relay did not start from " + (install / "current" / "gm").string());
        } else {
            check_relay_handover(result, relay, install, run_dir, stamp, second);
            check_direct_handover(result, host, workspace, sandbox, quiet, stamp);
            check_broken_refused(result, relay, install, second, broken);
            check_leaf_restart(result, sandbox, install, quiet, stamp);
            check_long_call(result, relay, versions, install, host, stamp, second);
            check_identical_install(result, sandbox, host, repo, quiet);
        }
        relay.stop();
    }
    unset_env("GMNEW_TEST_CLOCK");
    unset_env("GM_CLOCK_SCALE");
    std::error_code ignored;
    fs::remove_all(sandbox, ignored);
    const double wall = std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count();
    result.summary = stamp + " -> " + second + ": the body in flight finished on the old build, the next call ran on the new one, the run log carried over, and the broken build " + broken +
                     " was refused; wall " + std::to_string(wall) + " s";
    return result;
}

}
#else

namespace gm::tool {

CheckResult check_build_handover(const std::string&) {
    CheckResult result;
    result.summary = "skipped: POSIX-only check, runs on Linux and macOS";
    return result;
}

}
#endif
