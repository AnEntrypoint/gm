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

}  // namespace

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

        auto unknown_tool = verbs.call("nope", object_of({}));
        expect(text_of(unknown_tool, "error") == "unknown tool: nope", "unknown tool");
    }
    std::error_code ec;
    std::filesystem::remove_all(base, ec);
    std::printf("%s (%d failed)\n", failures == 0 ? "all passed" : "FAILED", failures);
    return failures == 0 ? 0 : 1;
}
