#include "gm/tool.hpp"

#include <algorithm>
#include <chrono>
#include <cstdint>
#include <cstdlib>
#include <filesystem>
#include <regex>
#include <set>
#include <system_error>
#include <thread>
#include <vector>

#if defined(_WIN32)

namespace gm::tool {

CheckResult check_browser_tabs_owner(const std::string&) {
    CheckResult result;
    result.summary = "skipped (not on this platform: the tab-owner witness drives the POSIX playwriter gate)";
    return result;
}

}

#else

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

constexpr std::int64_t kCallMs = 180000;

const json::Value* field(const json::Value& value, const char* key) {
    return value.is_object() ? value.find(key) : nullptr;
}

std::string text_of(const json::Value& value, const char* key) {
    const json::Value* found = field(value, key);
    return found != nullptr && found->is_string() ? found->as_string() : std::string();
}

bool flag_of(const json::Value& value, const char* key) {
    const json::Value* found = field(value, key);
    return found != nullptr && found->is_bool() && found->as_bool();
}

json::Value run_code(Session& session, const std::string& body) {
    return tool_json(session, "run_code", json::Object{{"format", "esm"}, {"timeoutMs", kCallMs}, {"body", body}});
}

json::Value output_of(const json::Value& reply) {
    const json::Value* output = field(reply, "output");
    if (output == nullptr) return reply;
    if (!output->is_string()) return *output;
    if (auto parsed = json::parse(output->as_string())) return *parsed;
    return reply;
}

void connect(Session& session) {
    session.rpc("initialize", json::Object{{"protocolVersion", "2025-06-18"}, {"capabilities", json::Object{}},
                                          {"clientInfo", json::Object{{"name", "gm-tool"}, {"version", "1"}}}});
    session.notify("notifications/initialized", json::Object{});
    session.rpc("resources/read", json::Object{{"uri", "skill://gm/SKILL.md"}});
    tool_json(session, "next_context", json::Object{});
}

std::string open_pages(const std::string& marker) {
    return "const made = []; for (const n of [1, 2]) { const p = await context.newPage(); await p.goto('data:text/html,<title>" + marker +
           "-' + n + '</title>'); made.push(p.url()); } return 'OPENED ' + made.length;";
}

json::Value playwriter(Session& session, const std::string& code) {
    const json::Value reply = output_of(run_code(session, "return { exec: await gm.playwriter_execute({ code: " + json::quote(code) + " }) };"));
    const json::Value* exec = field(reply, "exec");
    return exec != nullptr ? *exec : reply;
}

std::string tabs_text(Session& session) {
    const json::Value reply = output_of(run_code(session, "return { tabs: await gm.browser_tabs({}) };"));
    const json::Value* tabs = field(reply, "tabs");
    const std::string text = tabs != nullptr ? text_of(*tabs, "text") : std::string();
    return text.empty() ? "UNREAD " + json::dump(reply).substr(0, 300) : text;
}

std::vector<std::string> own_ids(const std::string& text) {
    const std::size_t split = text.find("; not this run");
    const std::string own = text.substr(0, split);
    static const std::regex row(R"(\[([0-9A-Fa-f]+)\] )");
    std::vector<std::string> ids;
    for (std::sregex_iterator it(own.begin(), own.end(), row), end; it != end; ++it) ids.push_back((*it)[1].str());
    return ids;
}

bool gone(long long pid) {
    return proc::start_time_of(pid) == 0;
}

}

CheckResult check_browser_tabs_owner(const std::string& binary) {
    CheckResult result;
    const auto began = std::chrono::steady_clock::now();
    const auto stamp = began.time_since_epoch().count();
    const fs::path sandbox = fs::temp_directory_path() / ("gm-browser-tabs-owner-" + std::to_string(stamp));
    const fs::path workspace = sandbox / "ws";
    fs::create_directories(workspace);
    auto expect = [&](bool condition, const std::string& text) {
        if (!condition) result.failures.push_back(text);
    };
    std::error_code ec;
    const char* real_home = std::getenv("HOME");
    const fs::path installed = fs::path(real_home == nullptr ? "" : real_home) / ".gmnew" / "pw";
    if (real_home == nullptr || !fs::is_directory(installed, ec)) {
        result.failures.push_back("no installed playwriter package at " + installed.string() + "; this check reuses it and never installs one");
        fs::remove_all(sandbox, ec);
        result.summary = "tab owners: not run";
        return result;
    }
    fs::create_directories(sandbox / ".gmnew");
    fs::create_directory_symlink(installed, sandbox / ".gmnew" / "pw", ec);
    long long gate = 0;
    {
        Session alpha({binary, "serve", "--workspace", workspace.string(), "--run-dir", (workspace / "runs" / "alpha").string()}, workspace, sandbox, 300000);
        Session beta({binary, "serve", "--workspace", workspace.string(), "--run-dir", (workspace / "runs" / "beta").string()}, workspace, sandbox, 300000);
        expect(alpha.started() && beta.started(), "a gm serve did not start from " + binary);
        if (alpha.started() && beta.started()) {
            connect(alpha);
            connect(beta);
            const json::Value first = playwriter(alpha, "return 1;");
            const std::string first_text = json::dump(first);
            std::smatch found;
            if (std::regex_search(first_text, found, std::regex("gate pid ([0-9]+)"))) gate = std::stoll(found[1].str());
            expect(gate > 0, "the first browser call reported no gate pid: " + first_text.substr(0, 300));

            json::Value alpha_open;
            json::Value beta_open;
            std::thread opening_alpha([&] { alpha_open = playwriter(alpha, open_pages("alpha")); });
            std::thread opening_beta([&] { beta_open = playwriter(beta, open_pages("beta")); });
            opening_alpha.join();
            opening_beta.join();
            const std::string alpha_out = text_of(alpha_open, "output");
            const std::string beta_out = text_of(beta_open, "output");
            expect(alpha_out.find("OPENED 2") != std::string::npos && alpha_out.find("at start 0 []") != std::string::npos &&
                       alpha_out.find("at end 2 [") != std::string::npos,
                   "alpha's open call did not report its census: " + alpha_out.substr(0, 300));
            expect(beta_out.find("OPENED 2") != std::string::npos && beta_out.find("at end 2 [") != std::string::npos,
                   "beta's open call did not report its census: " + beta_out.substr(0, 300));

            const std::string alpha_text = tabs_text(alpha);
            const std::string beta_text = tabs_text(beta);
            const std::vector<std::string> alpha_ids = own_ids(alpha_text);
            const std::vector<std::string> beta_ids = own_ids(beta_text);
            expect(alpha_text.starts_with("tabs: 2 in this run") && alpha_ids.size() == 2, "alpha did not list exactly its own two tabs: " + alpha_text);
            expect(beta_text.starts_with("tabs: 2 in this run") && beta_ids.size() == 2, "beta did not list exactly its own two tabs: " + beta_text);
            expect(alpha_text.find("alpha-1") != std::string::npos && alpha_text.find("alpha-2") != std::string::npos, "alpha's listing lost its pages: " + alpha_text);
            expect(alpha_text.find("beta-") == std::string::npos, "alpha's listing showed beta's pages: " + alpha_text);
            expect(beta_text.find("beta-1") != std::string::npos && beta_text.find("beta-2") != std::string::npos, "beta's listing lost its pages: " + beta_text);
            expect(beta_text.find("alpha-") == std::string::npos, "beta's listing showed alpha's pages: " + beta_text);
            expect(alpha_text.find("run beta pid") != std::string::npos && alpha_text.find("running, 2 tab(s)") != std::string::npos,
                   "alpha's listing did not name beta as the owner of its two tabs: " + alpha_text);
            expect(beta_text.find("run alpha pid") != std::string::npos && beta_text.find("running, 2 tab(s)") != std::string::npos,
                   "beta's listing did not name alpha as the owner of its two tabs: " + beta_text);
            for (const std::string& id : alpha_ids) {
                expect(std::find(beta_ids.begin(), beta_ids.end(), id) == beta_ids.end(), "alpha and beta list the same tab " + id);
            }

            if (alpha_ids.size() == 2 && beta_ids.size() == 2) {
                const json::Value refused = output_of(run_code(alpha, "return { close: await gm.browser_close_tab({ targetId: " + json::quote(beta_ids[0]) + " }) };"));
                const json::Value* refused_close = field(refused, "close");
                expect(refused_close != nullptr && !flag_of(*refused_close, "ok"), "alpha closed beta's tab " + beta_ids[0]);
                const json::Value closed = output_of(run_code(alpha, "return { close: await gm.browser_close_tab({ targetId: " + json::quote(alpha_ids[0]) + " }) };"));
                const json::Value* own_close = field(closed, "close");
                expect(own_close != nullptr && flag_of(*own_close, "ok"), "alpha could not close its own tab " + alpha_ids[0]);
                const std::string after_alpha = tabs_text(alpha);
                const std::string after_beta = tabs_text(beta);
                expect(after_alpha.starts_with("tabs: 1 in this run"), "alpha's listing did not drop its closed tab: " + after_alpha);
                expect(after_beta.starts_with("tabs: 2 in this run"), "beta lost a tab when alpha closed its own: " + after_beta);
                const std::string census = text_of(playwriter(alpha, "return 1;"), "output");
                expect(census.find("at start 1 [") != std::string::npos && census.find("at end 1 [") != std::string::npos,
                       "a later call did not report its one tab at start and end: " + census.substr(0, 300));
            }

            playwriter(alpha, "await browser.close(); return 'browser closed';");
            for (Session* session : {&alpha, &beta}) {
                const json::Value finished = output_of(run_code(*session, "return { close: await gm.browser_close_run({}) };"));
                const json::Value* closed = field(finished, "close");
                expect(closed != nullptr && flag_of(*closed, "ok"), "browser_close_run did not finish a serve's own tabs: " + json::dump(finished).substr(0, 300));
            }
        }
        alpha.stop();
        beta.stop();
    }
    if (gate > 0) {
        const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(30);
        while (!gone(gate) && std::chrono::steady_clock::now() < deadline) std::this_thread::sleep_for(std::chrono::milliseconds(100));
        if (!gone(gate)) {
            const std::vector<long long> tree = process_tree({gate});
            kill_processes(tree);
            result.failures.push_back("the gate " + std::to_string(gate) + " outlived both serves by 30 s; its tree of " + std::to_string(tree.size()) + " process(es) was stopped by pid");
        }
    }
    fs::remove_all(sandbox, ec);
    const auto wall = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - began).count();
    result.summary = "two serves in one project share one browser: each lists only its own tabs by targetId, the other serve's tabs are counted with its run id and pid, a browser_close_tab of another serve's tab is refused, a serve closes its own tab, and each playwriter_execute reports its tabs at start and end (wall " +
                     std::to_string(wall) + " ms)";
    return result;
}

}

#endif
