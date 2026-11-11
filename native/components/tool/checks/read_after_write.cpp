#include "gm/tool.hpp"

#include <chrono>
#include <fstream>
#include <system_error>

namespace gm::tool {
namespace {

const std::string kRead = "const r = await gm.read_file({ path: 'f.txt' }); return JSON.stringify(r);";

bool pointer(const std::string& text) { return text.find("\"pointer\":true") != std::string::npos; }

bool contains(const std::string& text, const std::string& word) { return text.find(word) != std::string::npos; }

std::filesystem::path make_sandbox() {
    const auto stamp = std::chrono::steady_clock::now().time_since_epoch().count();
    auto root = std::filesystem::temp_directory_path() / ("gm-read-after-write-" + std::to_string(stamp));
    std::filesystem::create_directories(root / "ws");
    std::ofstream(root / "ws" / "f.txt") << "v0\n";
    std::ofstream(root / "quiet.json") << R"({"mcpServers":{"playwriter":{"disabled":true}}})";
    return root;
}

CheckResult read_after_write(const std::string& binary) {
    CheckResult result;
    const auto started = std::chrono::steady_clock::now();
    const auto sandbox = make_sandbox();
    const auto workspace = sandbox / "ws";
    auto expect = [&](bool condition, const std::string& text) {
        if (!condition) result.failures.push_back(text);
    };
    {
        Session session(binary, workspace, sandbox);
        expect(session.started(), "gm serve did not start from " + binary);
        if (session.started()) {
            session.rpc("initialize", json::Object{{"protocolVersion", "2025-06-18"}, {"capabilities", json::Object{}},
                                                  {"clientInfo", json::Object{{"name", "gm-tool"}, {"version", "1"}}}});
            session.notify("notifications/initialized", json::Object{});
            session.rpc("resources/read", json::Object{{"uri", "skill://gm/SKILL.md"}});
            session.rpc("tools/call", json::Object{{"name", "next_context"}, {"arguments", json::Object{}}});

            session.body(kRead);
            session.body(kRead);
            const std::string repeat = session.body(kRead);
            expect(pointer(repeat), "a repeat read with no write in between should be a pointer, got: " + repeat.substr(0, 200));

            const std::string edit = session.body(
                "await gm.edit_file({ path: 'f.txt', old: 'v0', new: 'v1' }); const first = await gm.read_file({ path: 'f.txt' }); return JSON.stringify(first);");
            expect(contains(edit, "v1") && !pointer(edit), "edit then read in one body served a stale or pointer read: " + edit.substr(0, 300));

            session.body(kRead);
            session.body(kRead);
            session.body("await gm.run_shell({ command: \"printf v2 > f.txt\" }); return 'written';");
            const std::string shell = session.body(kRead);
            expect(contains(shell, "v2") && !pointer(shell), "a shell write then read served a stale read: " + shell.substr(0, 300));

            session.body(kRead);
            session.body(kRead);
            session.body("await gm.job_start({ job: 'raw-writer', command: 'sleep 1; printf v3 > f.txt', timeoutMs: 60000 }); return 'started';");
            session.body("return JSON.stringify(await gm.job_status({ job: 'raw-writer', waitMs: 8000 }));");
            const std::string job = session.body(kRead);
            expect(contains(job, "v3") && !pointer(job), "a job that wrote then a read after it finished served a stale read: " + job.substr(0, 300));
        }
        session.stop();
    }
    std::error_code ignored;
    std::filesystem::remove_all(sandbox, ignored);
    const double wall = std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count();
    result.summary = "an edit, a shell write and a finished job's write each reached the next read in fresh content, never a pointer; wall " +
                     std::to_string(wall).substr(0, 4) + " s";
    return result;
}

}

const std::vector<Registered>& checks() {
    static const std::vector<Registered> all{{"check-read-after-write", read_after_write}};
    return all;
}

}
