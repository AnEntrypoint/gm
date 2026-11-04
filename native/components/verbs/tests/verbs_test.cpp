#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <string>
#include <thread>

#include "gmnew/core_verbs.hpp"
#include "gmnew/json.hpp"
#include "gmnew/log.hpp"

namespace {

int failures = 0;

void expect(bool condition, const std::string& what) {
    if (condition) {
        std::printf("ok   %s\n", what.c_str());
    } else {
        std::printf("FAIL %s\n", what.c_str());
        ++failures;
    }
}

gmnew::json::Value object_of(std::initializer_list<gmnew::json::Member> members) { return gmnew::json::Value(gmnew::json::Object(members)); }

std::string text_of(const gmnew::json::Value& reply, std::string_view key) {
    const gmnew::json::Value* v = reply.find(key);
    return v != nullptr && v->is_string() ? v->as_string() : std::string();
}

bool ok_of(const gmnew::json::Value& reply) {
    const gmnew::json::Value* v = reply.find("ok");
    return v != nullptr && v->as_bool();
}

double number_of(const gmnew::json::Value& reply, std::string_view key) {
    const gmnew::json::Value* v = reply.find(key);
    return v != nullptr && v->is_number() ? v->as_number() : -1;
}

std::filesystem::path fresh_dir() {
    auto base = std::filesystem::temp_directory_path() /
                ("gmnew-verbs-test-" + std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()));
    std::filesystem::create_directories(base / "workspace");
    std::filesystem::create_directories(base / "run");
    return base;
}

}

int main() {
    using gmnew::json::Value;
    auto base = fresh_dir();
    auto log = gmnew::RunLog::open(base / "run");
    if (!log) {
        std::printf("FAIL open log: %s\n", log.error().c_str());
        return 1;
    }
    {
        gmnew::CoreVerbsOptions options;
        options.workspace = base / "workspace";
        gmnew::CoreVerbs verbs(std::move(options), *log);

        expect(verbs.list().size() == 10, "list has the ten core verbs");

        auto wrote = verbs.call("write_file", object_of({{"path", "dir/a.txt"}, {"content", "alpha\nbeta\ngamma\n"}}));
        expect(ok_of(wrote) && text_of(wrote, "output") == "wrote dir/a.txt (17 chars)", "write_file: " + gmnew::json::dump(wrote));

        auto read = verbs.call("read_file", object_of({{"path", "dir/a.txt"}}));
        expect(text_of(read, "output") == "alpha\nbeta\ngamma\n" && number_of(read, "total") == 3 && text_of(read, "unit") == "lines",
               "read_file round trip: " + gmnew::json::dump(read));

        auto paged = verbs.call("read_file", object_of({{"path", (base / "workspace/dir/a.txt").string()}, {"offset", 1}, {"limit", 1}}));
        expect(text_of(paged, "output") == "beta\n" && number_of(paged, "next") == 2 && text_of(paged, "hint") == "pass offset: 2 and limit: 1 to read the rest",
               "read_file absolute path page: " + gmnew::json::dump(paged));

        auto chars = verbs.call("read_file", object_of({{"path", "dir/a.txt"}, {"unit", "chars"}, {"offset", 6}, {"limit", 4}}));
        expect(text_of(chars, "output") == "beta" && number_of(chars, "next") == 10, "read_file chars: " + gmnew::json::dump(chars));

        auto missing = verbs.call("read_file", object_of({{"path", "nope.txt"}}));
        expect(!ok_of(missing) && text_of(missing, "error").starts_with("ENOENT: no such file or directory, stat '"), "read_file missing: " + gmnew::json::dump(missing));

        auto edited = verbs.call("edit_file", object_of({{"path", "dir/a.txt"}, {"old", "beta"}, {"new", "BETA"}}));
        auto after_edit = verbs.call("read_file", object_of({{"path", "dir/a.txt"}}));
        expect(text_of(edited, "output") == "edited dir/a.txt (1 replacement)" && text_of(after_edit, "output") == "alpha\nBETA\ngamma\n",
               "edit_file: " + gmnew::json::dump(edited));

        verbs.call("write_file", object_of({{"path", "dir/b.txt"}, {"content", "x x x"}}));
        auto twice = verbs.call("edit_file", object_of({{"path", "dir/b.txt"}, {"old", "x"}, {"new", "y"}}));
        expect(text_of(twice, "error") == "old text occurs 3 times in dir/b.txt; add context to make it unique, or set replaceAll", "edit_file ambiguity");
        auto all = verbs.call("edit_file", object_of({{"path", "dir/b.txt"}, {"old", "x"}, {"new", "y"}, {"replaceAll", true}}));
        expect(text_of(all, "output") == "edited dir/b.txt (3 replacements)", "edit_file replaceAll");

        std::filesystem::create_directories(base / "workspace/dir/sub");
        auto listing = verbs.call("list_dir", object_of({{"path", "dir"}}));
        expect(text_of(listing, "output") == "a.txt\nb.txt\nsub/", "list_dir: " + gmnew::json::dump(listing));

        auto stat = verbs.call("stat_file", object_of({{"path", "dir/a.txt"}}));
        expect(text_of(stat, "output").starts_with("{\"type\":\"file\",\"size\":17,\"mtime\":\""), "stat_file: " + gmnew::json::dump(stat));

        auto empty_path = verbs.call("read_file", object_of({{"path", ""}}));
        expect(text_of(empty_path, "error") == "refused: path must be a non-empty string", "empty path refused");

        auto shell = verbs.call("run_shell", object_of({{"command", "echo hello; echo oops 1>&2"}}));
        expect(ok_of(shell) && text_of(shell, "output") == "hello\noops\n" && number_of(shell, "exitCode") == 0, "run_shell echo: " + gmnew::json::dump(shell));

        auto failing = verbs.call("run_shell", object_of({{"command", "exit 3"}}));
        expect(!ok_of(failing) && number_of(failing, "exitCode") == 3, "run_shell exit code: " + gmnew::json::dump(failing));

        auto timed = verbs.call("run_shell", object_of({{"command", "sleep 5"}, {"timeoutMs", 200}}));
        expect(text_of(timed, "error") == "timed out after 200 ms", "run_shell timeout: " + gmnew::json::dump(timed));

        auto started = verbs.call("job_start", object_of({{"job", "quick"}, {"command", "echo from-job"}}));
        expect(ok_of(started) && text_of(started, "output").starts_with("started job quick (pid "), "job_start: " + gmnew::json::dump(started));
        auto done = verbs.call("job_status", object_of({{"job", "quick"}, {"waitMs", 10000}}));
        expect(text_of(done, "state") == "exited" && number_of(done, "exitCode") == 0 && text_of(done, "output") == "from-job\n",
               "job_status exit 0: " + gmnew::json::dump(done));

        auto again = verbs.call("job_start", object_of({{"job", "quick"}, {"command", "true"}}));
        expect(text_of(again, "error") == "job quick already exists", "job name reuse refused");

        verbs.call("job_start", object_of({{"job", "sleeper"}, {"command", "sleep 30"}}));
        auto stopped = verbs.call("job_stop", object_of({{"job", "sleeper"}}));
        expect(ok_of(stopped) && text_of(stopped, "state") == "killed" && text_of(stopped, "reason") == "cancelled",
               "job_stop sleep: " + gmnew::json::dump(stopped));
        auto stopped_status = verbs.call("job_status", object_of({{"job", "sleeper"}}));
        expect(text_of(stopped_status, "state") == "killed" && text_of(stopped_status, "signal") == "SIGTERM" && text_of(stopped_status, "reason") == "cancelled",
               "job_status after stop: " + gmnew::json::dump(stopped_status));
        auto stop_again = verbs.call("job_stop", object_of({{"job", "sleeper"}}));
        expect(text_of(stop_again, "error") == "job sleeper already ended (killed)", "job_stop twice");

        auto jobs = verbs.call("query_log", object_of({{"kind", "job"}}));
        auto parsed = gmnew::json::parse(text_of(jobs, "output"));
        expect(parsed && parsed->is_array() && parsed->as_array().size() == 4, "query_log kind job: " + gmnew::json::dump(jobs));
        auto killed = verbs.call("query_log", object_of({{"kind", "job-killed"}, {"last", 5}}));
        auto killed_events = gmnew::json::parse(text_of(killed, "output"));
        expect(killed_events && killed_events->as_array().size() == 1, "query_log last kind job-killed: " + gmnew::json::dump(killed));
        auto unknown = verbs.call("query_log", object_of({{"bogus", 1}}));
        expect(text_of(unknown, "error") == "refused: unknown argument bogus; query_log takes js, kind, fromMono, toMono, after, last, limit",
               "query_log unknown argument");
        auto paged_log = verbs.call("query_log", object_of({{"limit", 1}}));
        expect(number_of(paged_log, "next") == 1, "query_log limit gives next: " + gmnew::json::dump(paged_log));

        auto js_count = verbs.call("query_log", object_of({{"js", "events.filter(e => e.kind === 'job').length"}}));
        expect(ok_of(js_count) && text_of(js_count, "output") == "4" && js_count.find("next") == nullptr,
               "query_log js counts job events: " + gmnew::json::dump(js_count));
        auto js_statements = verbs.call("query_log", object_of({{"js", "const n = events.length; return n > 0 ? 'some' : 'none';"}}));
        expect(text_of(js_statements, "output") == "\"some\"", "query_log js statement body: " + gmnew::json::dump(js_statements));
        auto js_undefined = verbs.call("query_log", object_of({{"js", "undefined"}}));
        expect(text_of(js_undefined, "output") == "undefined", "query_log js undefined: " + gmnew::json::dump(js_undefined));
        auto js_last = verbs.call("query_log", object_of({{"kind", "job"}, {"last", 2}, {"js", "events.map(e => e.state)"}}));
        expect(text_of(js_last, "output") == "[\"running\",\"killed\"]", "query_log js with last: " + gmnew::json::dump(js_last));
        auto js_throws = verbs.call("query_log", object_of({{"js", "events.nope.length"}}));
        expect(!ok_of(js_throws) && !text_of(js_throws, "error").empty(), "query_log js error: " + gmnew::json::dump(js_throws));
        auto loop_started = std::chrono::steady_clock::now();
        auto js_loop = verbs.call("query_log", object_of({{"js", "{ for (;;) {} }"}}));
        auto loop_ms = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - loop_started).count();
        expect(!ok_of(js_loop) && text_of(js_loop, "error") == "the call passed its deadline of 5000 ms" && loop_ms < 10000,
               "query_log js infinite loop hits the deadline in " + std::to_string(loop_ms) + " ms: " + gmnew::json::dump(js_loop));
        auto js_window =verbs.call("query_log", object_of({{"js", "events.length"}, {"after", 0}}));
        expect(ok_of(js_window) && js_window.find("next") == nullptr, "query_log js whole log in one window: " + gmnew::json::dump(js_window));

        auto unknown_tool = verbs.call("nope", object_of({}));
        expect(text_of(unknown_tool, "error") == "unknown tool: nope", "unknown tool");
    }
    {
        gmnew::CoreVerbsOptions options;
        options.workspace = base / "workspace";
        options.serve_skill = [](const std::string& uri) -> std::optional<std::string> {
            if (uri == "skill://gm/SKILL.md") return std::string("line one\nline two\n");
            return std::nullopt;
        };
        gmnew::CoreVerbs verbs(std::move(options), *log);
        auto served = verbs.call("read_file", object_of({{"path", "skill://gm/SKILL.md"}}));
        expect(ok_of(served) && text_of(served, "output") == "line one\nline two\n" && number_of(served, "total") == 2,
               "read_file serves a skill:// uri: " + gmnew::json::dump(served));
        auto paged = verbs.call("read_file", object_of({{"path", "skill://gm/SKILL.md"}, {"offset", 1}, {"limit", 1}}));
        expect(ok_of(paged) && text_of(paged, "output") == "line two\n" && number_of(paged, "next") == -1,
               "read_file pages a skill:// uri: " + gmnew::json::dump(paged));
        auto absent = verbs.call("read_file", object_of({{"path", "skill://gm/NOPE.md"}}));
        expect(!ok_of(absent) && text_of(absent, "error") == "no served skill file has the uri skill://gm/NOPE.md",
               "read_file of an unserved skill:// uri fails: " + gmnew::json::dump(absent));
    }
    {
        std::filesystem::create_directories(base / "run-stuck");
        auto stuck_log = gmnew::RunLog::open(base / "run-stuck");
        expect(static_cast<bool>(stuck_log), "open stuck log");
        gmnew::CoreVerbsOptions options;
        options.workspace = base / "workspace";
        options.job_stuck_ms = 1000;
        gmnew::CoreVerbs verbs(std::move(options), *stuck_log);
        verbs.call("job_start", object_of({{"job", "quiet"}, {"command", "sleep 2; echo woke; sleep 5"}}));
        verbs.call("job_start", object_of({{"job", "brief"}, {"command", "true"}}));
        verbs.call("job_status", object_of({{"job", "brief"}, {"waitMs", 5000}}));
        auto first = verbs.job_snapshot();
        auto listed = first.find("jobs");
        expect(listed != nullptr && listed->as_array().size() == 2 && first.find("jobsStuck") == nullptr && first.find("jobsUnstuck") == nullptr,
               "snapshot lists both jobs, none stuck: " + gmnew::json::dump(first));
        std::this_thread::sleep_for(std::chrono::milliseconds(1500));
        auto stuck = verbs.job_snapshot();
        const gmnew::json::Value* turned = stuck.find("jobsStuck");
        expect(turned != nullptr && turned->as_array().size() == 1 && text_of(turned->as_array()[0], "job") == "quiet" &&
                   number_of(turned->as_array()[0], "sinceProgressMs") > 1000 && number_of(turned->as_array()[0], "seq") > 0,
               "quiet job turns stuck: " + gmnew::json::dump(stuck));
        bool brief_state_ok = false;
        bool quiet_flag_ok = false;
        for (const auto& entry : stuck.find("jobs")->as_array()) {
            if (text_of(entry, "job") == "brief") brief_state_ok = text_of(entry, "state") == "exited" && entry.find("stuck")->as_bool() == false;
            if (text_of(entry, "job") == "quiet") quiet_flag_ok = text_of(entry, "state") == "running" && entry.find("stuck")->as_bool();
        }
        expect(brief_state_ok && quiet_flag_ok, "snapshot entries carry state and stuck: " + gmnew::json::dump(stuck));
        auto repeat = verbs.job_snapshot();
        expect(repeat.find("jobsStuck") == nullptr, "stuck is reported once: " + gmnew::json::dump(repeat));
        std::this_thread::sleep_for(std::chrono::milliseconds(1000));
        auto unstuck = verbs.job_snapshot();
        const gmnew::json::Value* again = unstuck.find("jobsUnstuck");
        expect(again != nullptr && again->as_array().size() == 1 && text_of(again->as_array()[0], "job") == "quiet",
               "output write unsticks the job: " + gmnew::json::dump(unstuck));
        auto changes = verbs.call("query_log", object_of({{"js", "events.filter(e => e.kind === 'job-stuck' || e.kind === 'job-unstuck').map(e => e.kind)"}}));
        expect(text_of(changes, "output") == "[\"job-stuck\",\"job-unstuck\"]", "stuck changes are logged: " + gmnew::json::dump(changes));
        verbs.call("job_stop", object_of({{"job", "quiet"}}));

        verbs.call("job_start", object_of({{"job", "ordered"}, {"command", "sleep 1"}}));
        std::this_thread::sleep_for(std::chrono::milliseconds(80));
        stuck_log->append("action", object_of({{"tool", "run_code"}}));
        auto ordered_status = verbs.call("job_status", object_of({{"job", "ordered"}, {"waitMs", 10000}}));
        auto order = verbs.call("query_log", object_of({{"js", "events.filter(e => e.job === 'ordered' || e.kind === 'action').map(e => e.kind + ':' + (e.state ?? ''))"}}));
        expect(text_of(ordered_status, "state") == "exited" && text_of(order, "output") == "[\"job:running\",\"action:\",\"job:exited\"]",
               "exit event lands after the next action and before the reply that reads it: " + gmnew::json::dump(order));

        verbs.call("job_start", object_of({{"job", "unobserved"}, {"command", "true"}}));
        std::this_thread::sleep_for(std::chrono::milliseconds(600));
        auto logged = stuck_log->read_all();
        bool exit_logged = false;
        if (logged) {
            for (const auto& event : *logged) {
                if (text_of(event, "job") == "unobserved" && text_of(event, "state") == "exited") exit_logged = true;
            }
        }
        expect(exit_logged, "exit event lands within the grace when no call reads it");
    }
    {
        std::filesystem::create_directories(base / "run-timeout");
        auto timeout_log = gmnew::RunLog::open(base / "run-timeout");
        expect(static_cast<bool>(timeout_log), "open timeout log");
        gmnew::CoreVerbsOptions options;
        options.workspace = base / "workspace";
        gmnew::CoreVerbs verbs(std::move(options), *timeout_log);
        verbs.call("job_start", object_of({{"job", "by-default"}, {"command", "sleep 30"}}));
        verbs.call("job_start", object_of({{"job", "explicit"}, {"command", "sleep 30"}, {"timeoutMs", 450000}}));
        verbs.call("job_start", object_of({{"job", "capped"}, {"command", "sleep 30"}, {"timeoutMs", 900000}}));
        auto by_default = verbs.call("job_status", object_of({{"job", "by-default"}}));
        auto explicit_status = verbs.call("job_status", object_of({{"job", "explicit"}}));
        auto capped = verbs.call("job_status", object_of({{"job", "capped"}}));
        expect(number_of(by_default, "timeoutMs") == 300000, "job_start default deadline is 300000 ms: " + gmnew::json::dump(by_default));
        expect(number_of(explicit_status, "timeoutMs") == 450000, "job_start honors an explicit timeoutMs above the default: " + gmnew::json::dump(explicit_status));
        expect(number_of(capped, "timeoutMs") == 600000, "job_start caps timeoutMs at 600000 ms: " + gmnew::json::dump(capped));
        for (const char* name : {"by-default", "explicit", "capped"}) verbs.call("job_stop", object_of({{"job", name}}));

        verbs.call("job_start", object_of({{"job", "short"}, {"command", "sleep 30"}, {"timeoutMs", 200}}));
        auto short_done = verbs.call("job_status", object_of({{"job", "short"}, {"waitMs", 10000}}));
        expect(text_of(short_done, "state") == "killed" && text_of(short_done, "reason") == "timeout",
               "job past its deadline is killed with reason timeout: " + gmnew::json::dump(short_done));
    }
    std::error_code ec;
    std::filesystem::remove_all(base, ec);
    std::printf("%s (%d failed)\n", failures == 0 ? "all passed" : "FAILED", failures);
    return failures == 0 ? 0 : 1;
}
