#include <chrono>
#include <condition_variable>
#include <filesystem>
#include <cstdlib>
#include <fstream>
#include <set>
#include <sstream>
#include <iostream>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "gmnew/host/child.hpp"
#include "gmnew/host/composed_verbs.hpp"
#include "gmnew/host/primitives.hpp"
#include "gmnew/leaves.hpp"

namespace {

using namespace std::chrono_literals;
namespace fs = std::filesystem;

int failures = 0;

void check(bool ok, const std::string& what) {
    std::cout << (ok ? "ok   " : "FAIL ") << what << '\n';
    if (!ok) ++failures;
}

void write_leaf(const fs::path& path, int value) {
    std::ofstream out(path, std::ios::binary | std::ios::trunc);
    out << "export const verbs = [{ name: 'probe', description: 'returns a fixed value', inputSchema: { type: 'object', "
           "properties: {} }, call: (args) => ({ ok: true, value: "
        << value << ", runDir: host.runDir, seq: host.logAppend({ kind: 'probe', fields: { value: " << value
        << " } }).seq }) }];\n";
}

struct Lines {
    std::mutex mutex;
    std::condition_variable arrived;
    std::vector<std::string> lines;
    bool ended = false;

    std::string wait_for_id(int id, std::chrono::milliseconds timeout) {
        const std::string key = "\"id\":" + std::to_string(id) + ",";
        const std::string tail = "\"id\":" + std::to_string(id) + "}";
        std::unique_lock lock(mutex);
        std::string found;
        arrived.wait_for(lock, timeout, [&] {
            for (const auto& line : lines)
                if (line.find(key) != std::string::npos || line.find(tail) != std::string::npos) found = line;
            return !found.empty() || ended;
        });
        return found;
    }
};

std::string call_line(int id, const std::string& tool, const std::string& arguments) {
    return R"({"jsonrpc":"2.0","id":)" + std::to_string(id) + R"(,"method":"tools/call","params":{"name":")" + tool +
           R"(","arguments":)" + arguments + "}}";
}

class NamedVerbs final : public gmnew::VerbTable {
public:
    explicit NamedVerbs(std::string name) : name_(std::move(name)) {}
    std::vector<gmnew::VerbInfo> list() const override { return {{name_, "", "{}"}}; }
    gmnew::json::Value call(std::string_view, const gmnew::json::Value&) override {
        gmnew::json::Value reply;
        reply.set("ok", true);
        return reply;
    }

private:
    std::string name_;
};

std::string shorten(const std::string& line) { return line.size() <= 240 ? line : line.substr(0, 240) + "..."; }

std::string run_of(const std::string& line) {
    const std::string key = "\\\"run\\\":\\\"";
    const auto at = line.find(key);
    if (at == std::string::npos) return {};
    const auto start = at + key.size();
    return line.substr(start, line.find('\\', start) - start);
}

struct LogCheck {
    std::size_t events = 0;
    bool increasing = true;
    std::set<std::string> kinds;
    std::string jobs;
};

LogCheck check_log(const fs::path& file) {
    LogCheck result;
    std::ifstream in(file);
    std::string line;
    double last = 0;
    while (std::getline(in, line)) {
        if (line.empty()) continue;
        auto event = gmnew::json::parse(line);
        if (!event) {
            result.increasing = false;
            continue;
        }
        ++result.events;
        const double seq = event->find("seq") ? event->find("seq")->as_number() : 0;
        if (seq != last + 1) result.increasing = false;
        last = seq;
        const std::string kind = event->find("kind") ? event->find("kind")->as_string() : "";
        result.kinds.insert(kind);
        if (kind == "job" && event->find("job")) result.jobs += event->find("job")->as_string() + " ";
        if (kind == "probe") result.jobs += "probe-log ";
    }
    return result;
}

}  // namespace

int main() {
    const fs::path root = fs::temp_directory_path() /
                          ("gmnew-worker-test-" + std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()));
    const fs::path workspace = root / "workspace";
    const fs::path leaves = root / "leaves";
    fs::create_directories(workspace);
    fs::create_directories(leaves);
    fs::create_directories(root / "runs");
    write_leaf(leaves / "probe.mjs", 4242);
    for (const auto& entry : fs::directory_iterator(fs::path(GMNEW_SOURCE_ROOT) / "native" / "leaves")) {
        if (entry.path().extension() == ".mjs") fs::copy_file(entry.path(), leaves / entry.path().filename());
    }
    {
        std::ofstream hello(workspace / "hello.txt");
        hello << "hello native\n";
    }
    const std::string git_init = "git -C '" + workspace.string() + "' init -q";
    check(std::system(git_init.c_str()) == 0, "the workspace is a fresh git repository");

    NamedVerbs read_file("read_file");
    NamedVerbs other_read_file("read_file");
    auto clash = gmnew::host::ComposedVerbs::compose({&read_file, &other_read_file});
    check(!clash.has_value() && clash.error().find("read_file") != std::string::npos,
          "a verb name in two tables is an error: " + (clash ? std::string("no error") : clash.error()));
    auto native = gmnew::host::ComposedVerbs::compose({&read_file});
    gmnew::HostServices services{workspace, root / "runs", native->get(), gmnew::host::make_primitives(workspace, {})};
    const auto shell = services.extra.at("shell")(gmnew::json::parse(R"({"command":"echo primitive"})").value());
    check(shell.find("out") != nullptr && shell.find("out")->as_string() == "primitive\n", "the shell primitive runs");
    gmnew::LeafVerbs in_process(leaves, services);
    auto composed = gmnew::host::ComposedVerbs::compose({native->get(), &in_process});
    const auto before = composed.value()->call("probe", gmnew::json::Value(gmnew::json::Object{}));
    const auto generation_before = in_process.generation();
    check(gmnew::json::dump(before).find("4242") != std::string::npos,
          "ComposedVerbs routes probe to LeafVerbs: " + gmnew::json::dump(before));

    auto spawned = gmnew::host::Child::spawn({GMNEW_BINARY, "worker", "--workspace", workspace.string(), "--runs",
                                              (root / "runs").string(), "--leaves", leaves.string(), "--skills",
                                              (fs::path(GMNEW_SOURCE_ROOT) / "skills").string()});
    check(spawned.has_value(), "the worker starts");
    if (!spawned) return 1;
    auto worker = *spawned;
    Lines out;
    std::thread reader([&] {
        while (auto line = worker->read_line()) {
            std::lock_guard lock(out.mutex);
            out.lines.push_back(*line);
            out.arrived.notify_all();
        }
        std::lock_guard lock(out.mutex);
        out.ended = true;
        out.arrived.notify_all();
    });

    worker->write_line(
        R"({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"worker_test","version":"1"}}})");
    const std::string init = out.wait_for_id(1, 10s);
    check(init.find("\"result\"") != std::string::npos, "initialize: " + shorten(init));
    worker->write_line(R"({"jsonrpc":"2.0","method":"notifications/initialized"})");

    worker->write_line(call_line(2, "next_context", "{}"));
    const std::string step = out.wait_for_id(2, 10s);
    check(step.find("\"result\"") != std::string::npos && step.find("isError\":true") == std::string::npos,
          "next_context: " + shorten(step));

    const std::string body = R"({"body":"const r = await gm.probe({}); return r;"})";
    worker->write_line(call_line(3, "run_code", body));
    const std::string first = out.wait_for_id(3, 20s);
    check(first.find("4242") != std::string::npos, "run_code calls the leaf: " + shorten(first));

    std::this_thread::sleep_for(20ms);
    const auto edited_at = std::chrono::steady_clock::now();
    write_leaf(leaves / "probe.mjs", 535353);
    worker->write_line(call_line(4, "run_code", body));
    const std::string second = out.wait_for_id(4, 20s);
    const auto latency = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - edited_at);
    check(second.find("535353") != std::string::npos,
          "after the edit the same worker returns the new value in " + std::to_string(latency.count()) +
              " ms: " + shorten(second));
    const auto after = composed.value()->call("probe", gmnew::json::Value(gmnew::json::Object{}));
    check(gmnew::json::dump(after).find("535353") != std::string::npos &&
              in_process.generation() > generation_before,
          "LeafVerbs::generation " + std::to_string(generation_before) + " -> " +
              std::to_string(in_process.generation()) + " with the new value " + gmnew::json::dump(after));
    check(!worker->wait_for(0ms).has_value(), "the worker did not restart (pid " + std::to_string(worker->pid()) + ")");

    worker->write_line(R"({"jsonrpc":"2.0","id":5,"method":"tools/list"})");
    const std::string tools = out.wait_for_id(5, 10s);
    check(tools.find("\"run_code\"") != std::string::npos && tools.find("\"finish\"") != std::string::npos,
          "tools/list: " + shorten(tools));

    const std::string first_run = run_of(step);
    worker->write_line(call_line(
        6, "run_code",
        R"({"body":"const f = await gm.read_file({ path: 'hello.txt' }); const g = await gm.git_status({}); return { f, g };"})"));
    const std::string native_and_leaf = out.wait_for_id(6, 30s);
    check(native_and_leaf.find("hello native") != std::string::npos &&
              native_and_leaf.find("hello.txt") != native_and_leaf.rfind("hello.txt") &&
              native_and_leaf.find("unknown tool") == std::string::npos,
          "run_code calls gm.read_file and the git_status leaf: " + shorten(native_and_leaf));

    worker->write_line(call_line(7, "finish", R"({"witness":"worker_test read hello.txt and ran git_status"})"));
    const std::string finished = out.wait_for_id(7, 10s);
    check(finished.find("\"result\"") != std::string::npos && finished.find("isError\":true") == std::string::npos,
          "finish: " + shorten(finished));

    worker->write_line(call_line(8, "next_context", "{}"));
    const std::string reopened = out.wait_for_id(8, 10s);
    const std::string second_run = run_of(reopened);
    check(!second_run.empty() && second_run != first_run,
          "next_context after finish opens run " + second_run + " after " + first_run);

    worker->write_line(call_line(
        9, "run_code",
        R"({"body":"await gm.job_start({ job: 'after-reopen', command: 'echo reopened' }); const status = await gm.job_status({ job: 'after-reopen', waitMs: 10000 }); const probe = await gm.probe({}); return { state: status.state, out: status.output, probe };"})"));
    const std::string job = out.wait_for_id(9, 30s);
    check(job.find("exited") != std::string::npos, "a job runs in the reopened run: " + shorten(job));
    const auto run_dir_at = job.find("runDir");
    check(run_dir_at != std::string::npos && job.find(second_run, run_dir_at) != std::string::npos &&
              job.find(second_run, run_dir_at) < job.find("seq", run_dir_at),
          "host.runDir names the reopened run: " + job.substr(run_dir_at == std::string::npos ? 0 : run_dir_at, 160));

    worker->close_input();
    const auto code = worker->wait_for(15s);
    if (!code) worker->kill();
    reader.join();
    check(code.has_value(), "the worker exits when its input ends (code " + std::to_string(code.value_or(-1)) + ")");

    for (const auto& [run, expect_job] : {std::pair{first_run, false}, std::pair{second_run, true}}) {
        const LogCheck log = check_log(root / "runs" / run / "log.jsonl");
        std::string kinds;
        for (const auto& kind : log.kinds) kinds += kind + " ";
        check(log.events > 0 && log.increasing,
              "run " + run + ": " + std::to_string(log.events) + " events, seqs 1.." + std::to_string(log.events) +
                  " strictly increasing, no duplicates; kinds: " + kinds);
        check((log.jobs.find("after-reopen") != std::string::npos) == expect_job &&
                  (!expect_job || log.jobs.find("probe-log") != std::string::npos),
              "run " + run + (expect_job ? " has" : " lacks") + " the job event of the reopened run, and the leaf logAppend lands in its own run (events: " + log.jobs + ")");
    }
    std::error_code ec;
    fs::remove_all(root, ec);
    std::cout << (failures == 0 ? "worker_test: all passed" : "worker_test: failures") << '\n';
    return failures == 0 ? 0 : 1;
}
