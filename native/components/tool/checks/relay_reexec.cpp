#include "gm/tool.hpp"

#include <atomic>
#include <chrono>
#include <filesystem>
#include <format>
#include <fstream>
#include <optional>
#include <sstream>
#include <system_error>
#include <thread>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;
using Clock = std::chrono::steady_clock;

constexpr std::int64_t kWaitMs = 45000;
constexpr long long kReexecLimitMs = 5000;
constexpr std::chrono::milliseconds kReplyWait{90000};
constexpr const char* kOffered = "ffff111-9999999999";
constexpr std::uint64_t kOfferedCommitted = 4102444800;
constexpr const char* kUpdatedMarker = "-> ffff111-9999999999";
constexpr const char* kReexecMarker = "re-executing the relay";

#if defined(__aarch64__)
constexpr const char* kPlatformTarget = "arm64-linux";
#else
constexpr const char* kPlatformTarget = "x64-linux";
#endif

std::string short_text(const std::string& text) {
    return text.substr(0, 300);
}

std::string first_word(const std::string& text) {
    const auto start = text.find_first_not_of(" \t\r\n");
    if (start == std::string::npos) return {};
    const auto end = text.find_first_of(" \t\r\n", start);
    return text.substr(start, end == std::string::npos ? std::string::npos : end - start);
}

std::string trimmed(const std::string& text) {
    const auto start = text.find_first_not_of(" \t\r\n");
    if (start == std::string::npos) return {};
    const auto end = text.find_last_not_of(" \t\r\n");
    return text.substr(start, end - start + 1);
}

bool ends_with(const std::string& text, const std::string& tail) {
    return text.size() >= tail.size() && text.compare(text.size() - tail.size(), tail.size(), tail) == 0;
}

fs::path checkout_root() {
    for (fs::path dir = fs::current_path();; dir = dir.parent_path()) {
        std::error_code ec;
        if (fs::exists(dir / "skills" / "gm" / "SKILL.md", ec)) return dir;
        if (dir == dir.parent_path()) return {};
    }
}

std::string iso_now() {
    return std::format("{:%FT%TZ}", std::chrono::floor<std::chrono::milliseconds>(std::chrono::system_clock::now()));
}

long long ms_between(Clock::time_point from, Clock::time_point to) {
    return std::chrono::duration_cast<std::chrono::milliseconds>(to - from).count();
}

std::string or_null(std::optional<long long> value) {
    return value ? std::to_string(*value) : std::string("null");
}

struct Marks {
    std::atomic<bool> stop{false};
    std::mutex mutex;
    std::optional<Clock::time_point> updated;
    std::optional<Clock::time_point> reexec;
};

}

CheckResult check_relay_reexec(const std::string& binary) {
    CheckResult result;
#if !defined(__linux__)
    result.summary = "skipped (not on this platform: the check packs a linux archive; the relay does not re-execute on win32)";
    return result;
#else
    const auto started = Clock::now();
    const fs::path host = fs::path(binary).parent_path();
    const auto version_run = proc::run({binary, "--version"}, {}, {}, 30000);
    const std::string stamp = trimmed(version_run.out);
    const std::string version = first_word(stamp);
    if (version == "dev" || ends_with(version, "-dev")) {
        result.summary = "skipped (" + stamp + ": a development build never updates itself, so its relay never re-executes; run this on a build configured with -DGMNEW_VERSION=<commit>-1)";
        return result;
    }
    const fs::path repo = checkout_root();
    if (repo.empty()) {
        result.failures.push_back("run from the checkout: no skills/gm/SKILL.md in the working directory or its parents");
        return result;
    }
    const fs::path scratch = fs::temp_directory_path() / ("gm-relay-reexec-" + std::to_string(started.time_since_epoch().count()));
    const std::string stage_name = std::string("gmnew-") + kPlatformTarget;
    const std::string archive_name = stage_name + ".tar.gz";
    const fs::path published = scratch / "published";
    const fs::path stage = published / stage_name;
    std::optional<long long> update_after_send;
    std::optional<long long> reexec_after_update;
    std::optional<long long> wait_answered_after_send;
    [&] {
        std::error_code ec;
        fs::create_directories(stage, ec);
        for (const char* name : {"gm", "gm-core"}) {
            fs::copy_file(host / name, stage / name, fs::copy_options::overwrite_existing, ec);
            if (ec) {
                result.failures.push_back(std::string("could not stage ") + name + ": " + ec.message());
                return;
            }
        }
        const std::vector<std::pair<std::string, fs::path>> shared{
            {"leaves", repo / "native" / "leaves"}, {"skills", repo / "skills"}, {"defaults", repo / "defaults"}};
        for (const auto& [name, from_checkout] : shared) {
            std::error_code exists_ec;
            const fs::path from = fs::exists(host / name, exists_ec) ? host / name : from_checkout;
            fs::copy(from, stage / name, fs::copy_options::recursive | fs::copy_options::overwrite_existing, ec);
            if (ec) {
                result.failures.push_back("could not stage " + name + ": " + ec.message());
                return;
            }
        }
        const auto packed = proc::run({"tar", "-czf", archive_name, stage_name}, published, {}, 120000);
        if (!packed.started || packed.exit_code != 0) {
            result.failures.push_back("tar failed: " + packed.err);
            return;
        }
        const auto summed = proc::run({"sha256sum", (published / archive_name).string()}, published, {}, 60000);
        const std::string digest = first_word(summed.out);
        if (!summed.started || summed.exit_code != 0 || digest.size() != 64) {
            result.failures.push_back("sha256sum failed: " + summed.err);
            return;
        }
        const auto size = fs::file_size(published / archive_name, ec);
        json::Value manifest = json::Object{
            {"version", kOffered},
            {"commit", "ffff111" + std::string(33, 'a')},
            {"built", iso_now()},
            {"repo", "AnEntrypoint/gm"},
            {"assets", json::Object{{kPlatformTarget, json::Object{{"file", archive_name}, {"sha256", digest}, {"size", static_cast<std::uint64_t>(size)}, {"version", kOffered}, {"committed", kOfferedCommitted}}}}}};
        std::ofstream(published / "manifest.json") << json::dump(manifest);

        const fs::path install = scratch / "install";
        fs::copy(stage, install, fs::copy_options::recursive, ec);
        if (ec) {
            result.failures.push_back("could not copy the install: " + ec.message());
            return;
        }
        const fs::path home = scratch / "home";
        const fs::path workspace = scratch / "ws";
        fs::create_directories(home, ec);
        fs::create_directories(workspace, ec);
        const fs::path quiet = scratch / "quiet-mcp.json";
        std::ofstream(quiet) << R"({"mcpServers":{"playwriter":{"disabled":true}}})";

        const std::string manifest_url = "file://" + (published / "manifest.json").string();
        Session session(std::vector<std::string>{"env", "-u", "GMNEW_AUTO_UPDATE", "GMNEW_UPDATE_URL=" + manifest_url, (install / "gm").string(), "serve",
                                                 "--workspace", workspace.string(), "--run-dir", (workspace / "run").string(), "--mcp-config", quiet.string()},
                        workspace, home, 240000);
        if (!session.started()) {
            result.failures.push_back("the installed gm did not start from " + (install / "gm").string());
            return;
        }
        Marks marks;
        std::thread watcher([&] {
            while (!marks.stop.load()) {
                const std::string said = session.stderr_text();
                const auto now = Clock::now();
                {
                    std::lock_guard lock(marks.mutex);
                    if (!marks.updated && said.find(kUpdatedMarker) != std::string::npos) marks.updated = now;
                    if (!marks.reexec && said.find(kReexecMarker) != std::string::npos) marks.reexec = now;
                }
                std::this_thread::sleep_for(std::chrono::milliseconds(20));
            }
        });
        const auto updated_mark = [&] {
            std::lock_guard lock(marks.mutex);
            return marks.updated;
        };
        const auto reexec_mark = [&] {
            std::lock_guard lock(marks.mutex);
            return marks.reexec;
        };

        session.rpc("initialize", json::Object{{"protocolVersion", "2025-06-18"}, {"capabilities", json::Object{}},
                                              {"clientInfo", json::Object{{"name", "relay-reexec-check"}, {"version", "1"}}}});
        session.notify("notifications/initialized", json::Object{});
        session.send("resources/read", json::Object{{"uri", "skill://gm/SKILL.md"}});
        session.send("tools/call", json::Object{{"name", "next_context"}, {"arguments", json::Object{}}});
        const std::int64_t held_id = session.send("tools/call", json::Object{{"name", "next_context"}, {"arguments", json::Object{{"waitMs", kWaitMs}}}});
        const auto sent_at = Clock::now();

        const auto held = session.await_reply(held_id, kReplyWait);
        const std::optional<Clock::time_point> held_at = held ? std::optional<Clock::time_point>(Clock::now()) : std::nullopt;
        const auto updated_at = updated_mark();
        if (!updated_at) result.failures.push_back(std::string("the relay did not report the update to ") + kOffered + ": " + short_text(session.stderr_text()));
        if (!(updated_at && held_at && *updated_at < *held_at)) result.failures.push_back("the update did not land while the next_context wait was in flight, so the run measured nothing");
        const auto idle_deadline = Clock::now() + std::chrono::milliseconds(kReexecLimitMs);
        while (!reexec_mark() && Clock::now() < idle_deadline) std::this_thread::sleep_for(std::chrono::milliseconds(100));
        const auto reexec_at = reexec_mark();
        if (updated_at) update_after_send = ms_between(sent_at, *updated_at);
        if (reexec_at && updated_at) reexec_after_update = ms_between(*updated_at, *reexec_at);
        if (held_at) wait_answered_after_send = ms_between(sent_at, *held_at);
        if (!reexec_at) result.failures.push_back("the relay never said it re-executed");
        if (!(reexec_after_update && *reexec_after_update < kReexecLimitMs))
            result.failures.push_back("the relay re-executed " + or_null(reexec_after_update) + " ms after the update while a " + std::to_string(kWaitMs) +
                                      " ms next_context wait was in flight; the limit is " + std::to_string(kReexecLimitMs) + " ms");
        if (!(reexec_at && held_at && *reexec_at < *held_at))
            result.failures.push_back("the relay re-executed only after the next_context wait had answered; the wait was answered with " + short_text(held ? json::dump(*held) : std::string("null")));
        const json::Value* held_ok = held ? value_at(*held, "result.structuredContent.ok") : nullptr;
        if (!(held_ok && held_ok->is_bool() && held_ok->as_bool()))
            result.failures.push_back("the held next_context wait was not answered ok across the re-execution: " + short_text(held ? json::dump(*held) : std::string("null")));

        const std::int64_t ran_id = session.send("tools/call", json::Object{{"name", "run_code"}, {"arguments", json::Object{{"body", "return 6 * 7"}}}});
        const auto ran_reply = session.await_reply(ran_id, kReplyWait);
        const json::Value* ran = ran_reply ? value_at(*ran_reply, "result.structuredContent") : nullptr;
        const json::Value ran_value = ran ? *ran : json::Value(json::Object{});
        const json::Value* ran_ok = ran_value.find("ok");
        if (!(ran_ok && ran_ok->is_bool() && ran_ok->as_bool() && text_at(ran_value, "output") == "42"))
            result.failures.push_back("run_code after the re-execution did not run: " + short_text(json::dump(ran_value)));
        const bool answered_again = session.await_reply(held_id, std::chrono::milliseconds(0)).has_value();
        const int answered = (held ? 1 : 0) + (answered_again ? 1 : 0);
        if (answered != 1) result.failures.push_back("the held next_context wait was answered " + std::to_string(answered) + " times");

        marks.stop.store(true);
        watcher.join();
        session.stop();
    }();
    std::error_code ignored;
    fs::remove_all(scratch, ignored);
    const double wall = std::chrono::duration<double>(Clock::now() - started).count();
    const std::string measured = "{\"waitMs\":" + std::to_string(kWaitMs) + ",\"updateAfterSendMs\":" + or_null(update_after_send) + ",\"reexecAfterUpdateMs\":" +
                                 or_null(reexec_after_update) + ",\"waitAnsweredAfterSendMs\":" + or_null(wait_answered_after_send) + "}";
    if (result.failures.empty()) {
        result.summary = stamp + ": with a " + std::to_string(kWaitMs) + " ms next_context wait in flight the relay re-executed " + or_null(reexec_after_update) +
                         " ms after the update, the wait was answered once at " + or_null(wait_answered_after_send) + " ms, and run_code ran on the new relay (wall " +
                         std::to_string(wall) + " s)";
    } else {
        result.summary = stamp + ": measured " + measured + " (wall " + std::to_string(wall) + " s)";
    }
    return result;
#endif
}

}
