#include <chrono>
#include <condition_variable>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "gm/host/relay.hpp"

namespace {

using namespace std::chrono_literals;
namespace fs = std::filesystem;

int failures = 0;

void check(bool ok, const std::string& what) {
    std::cout << (ok ? "ok   " : "FAIL ") << what << '\n';
    if (!ok) ++failures;
}

struct HostSide {
    std::mutex mutex;
    std::condition_variable arrived;
    std::vector<std::string> lines;

    void take(std::string_view line) {
        std::lock_guard lock(mutex);
        lines.emplace_back(line);
        arrived.notify_all();
    }

    bool wait_for_text(const std::string& text, std::chrono::milliseconds timeout) {
        std::unique_lock lock(mutex);
        return arrived.wait_for(lock, timeout, [&] {
            for (const auto& line : lines)
                if (line.find(text) != std::string::npos) return true;
            return false;
        });
    }
};

template <typename Predicate>
bool eventually(Predicate predicate, std::chrono::milliseconds timeout) {
    const auto deadline = std::chrono::steady_clock::now() + timeout;
    while (std::chrono::steady_clock::now() < deadline) {
        if (predicate()) return true;
        std::this_thread::sleep_for(20ms);
    }
    return predicate();
}

std::vector<std::string> worker_argv(const char* sh_script, const char* mode) {
#if defined(_WIN32)
    (void)sh_script;
    return {GMNEW_RELAY_WORKER, mode};
#else
    (void)mode;
    return {"/bin/sh", "-c", sh_script};
#endif
}

gm::host::RelayOptions echo_options(const fs::path& watched) {
    gm::host::RelayOptions options;
    options.worker_argv = worker_argv("while IFS= read -r line; do printf '%s\\n' \"$line\"; done", "echo");
    options.runtime_roots = {watched};
    options.poll = 50ms;
    options.retry_min = 100ms;
    options.say = [](std::string_view message) { std::cout << "     relay: " << message << '\n'; };
    return options;
}

void write_file(const fs::path& path, const std::string& text) {
    std::ofstream out(path, std::ios::binary | std::ios::trunc);
    out << text;
}

void restart_on_source_change(const fs::path& root) {
    const fs::path watched = root / "watched";
    fs::create_directories(watched / "tests");
    write_file(watched / "core.cpp", "int a;\n");
    HostSide host;
    gm::host::Relay relay(echo_options(watched), [&](std::string_view line) { host.take(line); });
    relay.start();
    relay.host_line(R"({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}})");
    relay.host_line(R"({"jsonrpc":"2.0","id":2,"method":"ping"})");
    check(host.wait_for_text(R"("id":2)", 3s), "a host line reaches the worker and its answer comes back");
    const long long first_pid = relay.worker_pid();
    write_file(watched / "tests" / "ignored.cpp", "int ignored;\n");
    write_file(root / "CMakeLists.txt", "project(gm)\n");
    std::this_thread::sleep_for(300ms);
    check(relay.restarts() == 0, "a change under tests/ or outside the runtime roots restarts nothing");
    write_file(watched / "core.cpp", "int a, b;\n");
    check(eventually([&] { return relay.restarts() == 1 && relay.running(); }, 5s),
          "a source change restarts the worker once");
    check(relay.worker_pid() != first_pid, "the new worker is a new process (pid " + std::to_string(first_pid) + " -> " +
                                               std::to_string(relay.worker_pid()) + ")");
    relay.host_line(R"({"jsonrpc":"2.0","id":3,"method":"ping"})");
    check(host.wait_for_text(R"("id":3)", 3s), "the restarted worker answers the next call");
    {
        std::lock_guard lock(host.mutex);
        bool handshake_hidden = true;
        for (const auto& line : host.lines)
            if (line.find("gm-core") != std::string::npos) handshake_hidden = false;
        check(handshake_hidden, "the replayed handshake and list probes are not passed to the host");
    }
    relay.host_closed();
    check(!relay.running(), "the relay stops when the host closes its input");
}

void drain_before_restart(const fs::path& root) {
    const fs::path watched = root / "drain";
    fs::create_directories(watched);
    write_file(watched / "core.cpp", "int a;\n");
    HostSide host;
    auto options = echo_options(watched);
    options.worker_argv = worker_argv(
        "while IFS= read -r line; do case \"$line\" in *slow*) sleep 1;; esac; printf '%s\\n' \"$line\"; done", "slow");
    gm::host::Relay relay(options, [&](std::string_view line) { host.take(line); });
    relay.start();
    relay.host_line(R"({"jsonrpc":"2.0","id":7,"method":"slow"})");
    std::this_thread::sleep_for(100ms);
    relay.request_restart("test");
    relay.host_line(R"({"jsonrpc":"2.0","id":8,"method":"ping"})");
    check(host.wait_for_text(R"("id":7)", 5s), "the call in flight is answered before the restart");
    check(host.wait_for_text(R"("id":8)", 5s), "a call held during the restart reaches the new worker");
    check(eventually([&] { return relay.restarts() == 1; }, 5s), "the restart happened after the drain");
    relay.host_closed();
}

void stuck_call_gets_retry_error(const fs::path& root) {
    const fs::path watched = root / "stuck";
    fs::create_directories(watched);
    write_file(watched / "core.cpp", "int a;\n");
    HostSide host;
    auto options = echo_options(watched);
    options.worker_argv = worker_argv(
        R"sh(while IFS= read -r line; do case "$line" in *hang*) sleep 3;; esac; printf '%s\n' "$line"; done)sh", "hang");
    options.drain_timeout = 300ms;
    gm::host::Relay relay(options, [&](std::string_view line) { host.take(line); });
    relay.start();
    relay.host_line(R"({"jsonrpc":"2.0","id":9,"method":"hang"})");
    std::this_thread::sleep_for(100ms);
    relay.request_restart("test");
    relay.host_line(R"({"jsonrpc":"2.0","id":10,"method":"ping"})");
    check(host.wait_for_text(R"("id":9,"error")", 5s), "a call still running after the drain gets an error reply");
    check(host.wait_for_text("may be retried", 5s), "the error says the call may be retried");
    check(host.wait_for_text(R"("id":10)", 8s), "a call held during the restart reaches the new worker");
    relay.host_closed();
}

void binary_change_restarts_once(const fs::path& root) {
    const fs::path dir = root / "binary";
    fs::create_directories(dir / "leaves");
#if defined(_WIN32)
    const fs::path worker = dir / "worker.exe";
    fs::copy_file(GMNEW_RELAY_WORKER, worker);
#else
    const fs::path worker = dir / "worker.sh";
    const std::string first = R"sh(#!/bin/sh
while IFS= read -r line; do printf '%s\n' "$line"; done
)sh";
    write_file(worker, first);
    fs::permissions(worker, fs::perms::owner_all, fs::perm_options::replace);
#endif
    HostSide host;
    auto options = echo_options(dir / "leaves");
    options.worker_argv = {worker.string()};
#if defined(_WIN32)
    options.worker_argv.push_back("echo");
#endif
    gm::host::Relay relay(options, [&](std::string_view line) { host.take(line); });
    relay.start();
    relay.host_line(R"({"jsonrpc":"2.0","id":11,"method":"ping"})");
    check(host.wait_for_text(R"("id":11)", 3s), "a worker started from a script answers a call");
    const fs::path next = dir / "worker.next";
#if defined(_WIN32)
    fs::copy_file(GMNEW_RELAY_WORKER, next);
    fs::rename(worker, dir / "worker.old");
#else
    write_file(next, first + "\n");
    fs::permissions(next, fs::perms::owner_all, fs::perm_options::replace);
#endif
    fs::rename(next, worker);
    check(eventually([&] { return relay.restarts() == 1 && relay.running(); }, 5s),
          "a new worker binary restarts the worker once");
    relay.host_line(R"({"jsonrpc":"2.0","id":12,"method":"ping"})");
    check(host.wait_for_text(R"("id":12)", 3s), "the worker started from the new binary answers");
    relay.host_closed();
}

void failed_build_keeps_worker(const fs::path& root) {
    const fs::path watched = root / "build-fail";
    fs::create_directories(watched);
    fs::create_directories(root / "not-a-build-dir");
    write_file(watched / "core.cpp", "int a;\n");
    HostSide host;
    auto options = echo_options(watched);
    options.runtime_roots.clear();
    options.build_roots = {watched};
    options.build_dir = root / "not-a-build-dir";
    gm::host::Relay relay(options, [&](std::string_view line) { host.take(line); });
    relay.start();
    const long long first_pid = relay.worker_pid();
    write_file(watched / "core.cpp", "int broken(;\n");
    check(eventually([&] { return relay.failed_builds() == 1; }, 20s), "a failed build is counted");
    check(relay.restarts() == 0 && relay.worker_pid() == first_pid, "a failed build keeps the old worker");
    relay.host_line(R"({"jsonrpc":"2.0","id":4,"method":"ping"})");
    check(host.wait_for_text(R"("id":4)", 3s), "the old worker still answers");
    relay.host_closed();
}

void missing_worker_answers_with_failure(const fs::path& root) {
    HostSide host;
    auto options = echo_options(root);
    options.worker_argv = {(root / "no-such-worker").string()};
    options.retry_min = 10000ms;
    gm::host::Relay relay(options, [&](std::string_view line) { host.take(line); });
    relay.start();
    relay.host_line(R"({"jsonrpc":"2.0","id":5,"method":"tools/list"})");
    check(host.wait_for_text(R"("id":5,"error")", 2s), "a request while the worker is down gets the failure text");
    {
        std::lock_guard lock(host.mutex);
        if (!host.lines.empty()) std::cout << "     " << host.lines.back() << '\n';
    }
    relay.host_closed();
}

}

int main() {
    const fs::path root = fs::temp_directory_path() / ("gm-relay-test-" + std::to_string(std::rand()) +
                                                       std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()));
    fs::create_directories(root);
    restart_on_source_change(root);
    drain_before_restart(root);
    stuck_call_gets_retry_error(root);
    binary_change_restarts_once(root);
    failed_build_keeps_worker(root);
    missing_worker_answers_with_failure(root);
    std::error_code ec;
    fs::remove_all(root, ec);
    std::cout << (failures == 0 ? "relay_test: all passed" : "relay_test: failures") << '\n';
    return failures == 0 ? 0 : 1;
}
