#include "gm/tool.hpp"
#include "support.hpp"
#if !defined(_WIN32)

#include <arpa/inet.h>
#include <chrono>
#include <csignal>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <functional>
#include <map>
#include <regex>
#include <set>
#include <sstream>
#include <system_error>
#include <netinet/in.h>
#include <sys/socket.h>
#include <thread>
#include <unistd.h>

namespace gm::tool {
namespace fs = std::filesystem;

namespace {

std::string chromium_binary() {
    if (const char* given = std::getenv("PLAYWRITER_BROWSER_PATH"); given && fs::exists(given)) return given;
    for (const char* candidate : {"/opt/google/chrome/chrome", "/usr/lib/chromium/chromium.real", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"}) {
        if (fs::exists(candidate)) return candidate;
    }
    const char* path_env = std::getenv("PATH");
    std::istringstream dirs(path_env ? path_env : "");
    for (std::string dir; std::getline(dirs, dir, ':');) {
        for (const char* name : {"google-chrome", "google-chrome-stable", "chromium", "chromium-browser"}) {
            if (!dir.empty() && fs::exists(fs::path(dir) / name)) return (fs::path(dir) / name).string();
        }
    }
    return {};
}

long long pid_after(const std::string& text, const std::string& label) {
    std::smatch found;
    return std::regex_search(text, found, std::regex(label + " ([0-9]+)")) ? std::stoll(found[1].str()) : 0;
}

struct StartedGate {
    long long gate_pid = 0;
    long long browser_pid = 0;
    long long browser_started = 0;
    int port = 0;
    std::string status;
};

using LauncherRun = std::function<proc::Outcome(const std::string&, int)>;

struct Context {
    fs::path sandbox;
    fs::path workspace;
    fs::path installed_pw;
    LauncherRun run;
    std::function<proc::Outcome(const fs::path&, const std::string&, int)> run_with;
};

using GateBody = std::function<void(const StartedGate&, const Context&, CheckResult&)>;

CheckResult with_started_gate(const std::string& label, const std::vector<std::string>& extra_env, const GateBody& body, const std::function<void(const fs::path&)>& seed = {}) {
    CheckResult result;
    const std::string chromium = chromium_binary();
    if (chromium.empty()) {
        result.failures.push_back("no Chromium: set PLAYWRITER_BROWSER_PATH, or install one at /opt/google/chrome/chrome, /usr/lib/chromium/chromium.real or on PATH");
        return result;
    }
    const auto stamp = std::chrono::steady_clock::now().time_since_epoch().count();
    const fs::path sandbox = fs::temp_directory_path() / ("gm-" + label + "-" + std::to_string(stamp % 1000000));
    const fs::path workspace = sandbox / "ws";
    fs::create_directories(workspace);
    const char* home = std::getenv("HOME");
    const fs::path installed_pw = fs::path(home == nullptr ? "" : home) / ".gmnew" / "pw";
    std::error_code ec;
    fs::create_directories(sandbox / ".gmnew", ec);
    fs::create_directory_symlink(installed_pw, sandbox / ".gmnew" / "pw", ec);
    const fs::path launcher = sandbox / ".gmnew" / "pw" / "bin" / "playwriter-project";
    if (ec || !fs::exists(launcher)) {
        result.failures.push_back("no installed playwriter launcher to reuse at " + installed_pw.string());
        fs::remove_all(sandbox, ec);
        return result;
    }
    std::vector<std::string> env{"env", "HOME=" + sandbox.string(), "PLAYWRITER_PROJECT_DIR=" + workspace.string(), "PLAYWRITER_TELEMETRY=0", "PLAYWRITER_IDLE_MS=60000", "PLAYWRITER_NO_SANDBOX=1", "PLAYWRITER_BROWSER_PATH=" + chromium};
    env.insert(env.end(), extra_env.begin(), extra_env.end());
    env.push_back("node");
    env.push_back(launcher.string());
    const LauncherRun launcher_run = [&](const std::string& argument, int timeout_ms) {
        std::vector<std::string> argv = env;
        argv.push_back(argument);
        return proc::run(argv, workspace, {}, timeout_ms);
    };
    const auto run_with = [&](const fs::path& other, const std::string& argument, int timeout_ms) {
        std::vector<std::string> argv(env.begin(), env.end() - 1);
        argv.push_back(other.string());
        argv.push_back(argument);
        return proc::run(argv, workspace, {}, timeout_ms);
    };
    const Context context{sandbox, workspace, installed_pw, launcher_run, run_with};
    std::map<long long, long long> before;
    for (const auto& row : proc::process_table()) before[row.pid] = proc::start_time_of(row.pid);
    auto fresh = [&before](long long pid) {
        const auto known = before.find(pid);
        return known == before.end() || known->second != proc::start_time_of(pid);
    };
    std::vector<long long> roots;
    if (seed) seed(workspace);
    const auto started = launcher_run("start", 120000);
    if (!started.started || started.exit_code != 0 || started.err.find("browser ready") == std::string::npos) {
        result.failures.push_back("start did not report a ready browser: " + started.err.substr(0, 300));
    } else {
        StartedGate gate;
        gate.status = launcher_run("status", 30000).out;
        gate.gate_pid = pid_after(gate.status, "gate pid");
        gate.port = static_cast<int>(pid_after(gate.status, "gate pid [0-9]+ port"));
        gate.browser_pid = pid_after(gate.status, "browser running pid");
        gate.browser_started = proc::start_time_of(gate.browser_pid);
        if (gate.gate_pid != 0) roots.push_back(gate.gate_pid);
        if (gate.browser_pid != 0) roots.push_back(gate.browser_pid);
        if (gate.gate_pid == 0 || gate.port == 0 || gate.browser_pid == 0 || gate.browser_started <= 0) {
            result.failures.push_back("the status of the started gate names no gate pid, port or browser pid: " + gate.status.substr(0, 300));
        } else {
            body(gate, context, result);
        }
    }
    for (const long long pid : processes_mentioning(sandbox.string())) roots.push_back(pid);
    std::vector<long long> stopped;
    for (const long long pid : process_tree(roots)) {
        if (proc::start_time_of(pid) > 0 && fresh(pid)) stopped.push_back(pid);
    }
    kill_processes(stopped);
    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    const auto survivors = alive_of(stopped);
    if (!survivors.empty()) result.failures.push_back(std::to_string(survivors.size()) + " process(es) started by this check are still alive");
    fs::remove_all(sandbox, ec);
    return result;
}


fs::path launcher_variant(const Context& context, const std::string& name, const std::string& source) {
    const fs::path dir = context.sandbox / ("pw-" + name);
    std::error_code ec;
    fs::create_directories(dir / "bin", ec);
    for (const auto& entry : fs::directory_iterator(context.installed_pw, ec)) {
        const std::string leaf = entry.path().filename().string();
        if (leaf == "bin") continue;
        if (entry.is_directory(ec)) fs::create_directory_symlink(entry.path(), dir / leaf, ec);
        else fs::create_symlink(entry.path(), dir / leaf, ec);
    }
    for (const auto& entry : fs::directory_iterator(context.installed_pw / "bin", ec)) {
        if (entry.path().filename() != "playwriter-project") fs::create_symlink(entry.path(), dir / "bin" / entry.path().filename(), ec);
    }
    const fs::path launcher = dir / "bin" / "playwriter-project";
    std::ofstream(launcher, std::ios::binary) << source;
    fs::permissions(launcher, fs::perms::owner_all | fs::perms::group_read | fs::perms::others_read, ec);
    return launcher;
}

std::string old_launcher_source(const Context& context, const fs::path& checkout) {
    const fs::path scratch = context.sandbox / "old-launcher";
    std::error_code ec;
    fs::create_directories(scratch / "bin", ec);
    const auto base = proc::run({"git", "-C", context.installed_pw.string(), "show", "HEAD:bin/playwriter-project"}, scratch, {}, 30000);
    if (!base.started || base.exit_code != 0) return {};
    std::ofstream(scratch / "bin" / "playwriter-project", std::ios::binary) << base.out;
    for (const char* name : {"launcher-feedback.diff", "launcher-wait-hint.diff"}) {
        const auto applied = proc::run({"git", "apply", (checkout / "defaults" / "playwriter" / name).string()}, scratch, {}, 30000);
        if (!applied.started || applied.exit_code != 0) return {};
    }
    return read_text(scratch / "bin" / "playwriter-project");
}

bool gone_within(long long pid, long long started, int ms) {
    const auto began = std::chrono::steady_clock::now();
    while (std::chrono::steady_clock::now() - began < std::chrono::milliseconds(ms)) {
        if (proc::start_time_of(pid) != started) return true;
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }
    return proc::start_time_of(pid) != started;
}

std::string checkout_of(const fs::path& start) {
    const auto top = git_output(start, {"rev-parse", "--show-toplevel"});
    std::string text = top.value_or(start.string());
    while (!text.empty() && (text.back() == '\n' || text.back() == '\r')) text.pop_back();
    return text;
}

StartedGate gate_of(const Context& context, const fs::path& launcher) {
    StartedGate gate;
    gate.status = context.run_with(launcher, "status", 30000).out;
    gate.gate_pid = pid_after(gate.status, "gate pid");
    gate.port = static_cast<int>(pid_after(gate.status, "gate pid [0-9]+ port"));
    gate.browser_pid = pid_after(gate.status, "browser running pid");
    gate.browser_started = proc::start_time_of(gate.browser_pid);
    return gate;
}
}

CheckResult check_browser_second_gate(const std::string&) {
    return with_started_gate("second-gate", {}, [](const StartedGate& gate, const Context& context, CheckResult& result) {
        const auto second = context.run("--gate", 60000);
        std::this_thread::sleep_for(std::chrono::milliseconds(500));
        if (second.timed_out) result.failures.push_back("a second gate on the same ports did not exit within 60 s");
        const bool browser_alive = proc::start_time_of(gate.browser_pid) == gate.browser_started;
        const bool gate_alive = proc::start_time_of(gate.gate_pid) > 0;
        if (!browser_alive) result.failures.push_back("a second gate that could not listen on the project's port stopped the browser of the first gate (pid " + std::to_string(gate.browser_pid) + "); the gate log says: " + read_text(context.workspace / ".playwriter" / "gate.log").substr(0, 600));
        if (!gate_alive) result.failures.push_back("the first gate (pid " + std::to_string(gate.gate_pid) + ") was gone after a second gate failed to listen");
        if (result.failures.empty()) result.summary = "a second gate that cannot listen on the project's port exits and leaves the first gate and its browser (pid " + std::to_string(gate.browser_pid) + ") running";
    });
}

CheckResult check_gate_handoff(const std::string&) {
    return with_started_gate("gate-handoff", {}, [](const StartedGate& first, const Context& context, CheckResult& result) {
        const fs::path checkout = checkout_of(fs::current_path());
        const std::string current = read_text(context.installed_pw / "bin" / "playwriter-project");
        if (!contains(current, "/__pwp/handoff")) {
            result.failures.push_back("the installed launcher lacks the gate handoff patch (defaults/playwriter/launcher-ws-handoff.diff); gm install applies it");
            return;
        }
        const std::string old_source = old_launcher_source(context, checkout);
        if (old_source.empty()) {
            result.failures.push_back("could not compose the 22 November launcher from the pinned base and the feedback and wait-hint diffs");
            return;
        }
        const fs::path same = launcher_variant(context, "same", current);
        const fs::path newer = launcher_variant(context, "newer", current + "\n;0;\n");
        const fs::path older = launcher_variant(context, "older", old_source);
        const long long browser = first.browser_pid;
        const long long browser_started = first.browser_started;
        std::vector<std::string> steps;
        auto expect_gate = [&](const char* step, const fs::path& launcher, long long previous_gate, long long previous_started) {
            const StartedGate now = gate_of(context, launcher);
            if (!gone_within(previous_gate, previous_started, 15000)) result.failures.push_back(std::string(step) + ": the previous gate (pid " + std::to_string(previous_gate) + ") is still running");
            if (now.gate_pid == 0 || now.gate_pid == previous_gate) result.failures.push_back(std::string(step) + ": no new gate took over: " + now.status.substr(0, 300));
            if (now.browser_pid != browser || proc::start_time_of(browser) != browser_started) result.failures.push_back(std::string(step) + ": the browser (pid " + std::to_string(browser) + ") was not the one the new gate runs: " + now.status.substr(0, 300));
            steps.push_back(step);
            return now;
        };

        const long long first_started = proc::start_time_of(first.gate_pid);
        const auto upgraded = context.run_with(newer, "start", 120000);
        if (upgraded.exit_code != 0 || upgraded.err.find("browser ready") == std::string::npos) result.failures.push_back("a launcher of a newer build did not report a ready browser: " + upgraded.err.substr(0, 300));
        const StartedGate second = expect_gate("a newer launcher hands the idle gate over", newer, first.gate_pid, first_started);

        const long long second_started = proc::start_time_of(second.gate_pid);
        proc::run({"kill", "-USR2", std::to_string(second.gate_pid)}, context.workspace, {}, 10000);
        const bool second_gone = gone_within(second.gate_pid, second_started, 15000);
        if (!second_gone) result.failures.push_back("SIGUSR2 did not end the gate (pid " + std::to_string(second.gate_pid) + ")");
        if (proc::start_time_of(browser) != browser_started) result.failures.push_back("SIGUSR2 to the gate stopped the browser");
        const auto restarted = context.run_with(same, "start", 120000);
        if (restarted.exit_code != 0 || restarted.err.find("browser ready") == std::string::npos) result.failures.push_back("a launcher started after SIGUSR2 did not report a ready browser: " + restarted.err.substr(0, 300));
        const StartedGate third = expect_gate("a gate started after SIGUSR2 adopts the running browser", same, second.gate_pid, second_started);

        const long long third_started = proc::start_time_of(third.gate_pid);
        proc::run({"kill", "-USR2", std::to_string(third.gate_pid)}, context.workspace, {}, 10000);
        gone_within(third.gate_pid, third_started, 15000);
        const auto oldest = context.run_with(older, "start", 120000);
        if (oldest.exit_code != 0 || oldest.err.find("browser ready") == std::string::npos) result.failures.push_back("the 22 November launcher did not report a ready browser: " + oldest.err.substr(0, 300));
        const StartedGate fourth = expect_gate("the 22 November launcher's gate adopts the running browser", older, third.gate_pid, third_started);

        const long long fourth_started = proc::start_time_of(fourth.gate_pid);
        kill_processes({fourth.gate_pid});
        const bool fourth_gone = gone_within(fourth.gate_pid, fourth_started, 15000);
        if (!fourth_gone) result.failures.push_back("SIGKILL did not end the 22 November gate (pid " + std::to_string(fourth.gate_pid) + ")");
        if (proc::start_time_of(browser) != browser_started) result.failures.push_back("SIGKILL of the 22 November gate stopped the browser");
        const auto replaced = context.run_with(same, "start", 120000);
        if (replaced.exit_code != 0 || replaced.err.find("browser ready") == std::string::npos) result.failures.push_back("a current launcher after the SIGKILL did not report a ready browser: " + replaced.err.substr(0, 300));
        const StartedGate fifth = expect_gate("a current launcher after the SIGKILL of the old gate adopts the running browser", same, fourth.gate_pid, fourth_started);
        if (fifth.gate_pid != 0 && !contains(read_text(context.workspace / ".playwriter" / "gate.log"), "adopted running browser")) result.failures.push_back("the gate log never says a gate adopted the running browser");

        if (result.failures.empty()) result.summary = "one browser (pid " + std::to_string(browser) + ") outlived five gates: a newer launcher handed the idle gate over, SIGUSR2 ended a gate, the 22 November launcher's gate adopted the browser and a current launcher took it over after a SIGKILL of that gate";
    });
}

CheckResult check_browser_ws_address(const std::string&) {
    const auto stamp = std::chrono::steady_clock::now().time_since_epoch().count();
    const fs::path preload = fs::temp_directory_path() / ("gm-no-fetch-" + std::to_string(stamp % 1000000) + ".js");
    {
        std::ofstream out(preload);
        out << "const real = globalThis.fetch;\nglobalThis.fetch = (url, options) => String(url).includes('/json/version') ? Promise.reject(new TypeError('fetch failed')) : real(url, options);\n";
    }
    CheckResult result = with_started_gate("ws-address", {"NODE_OPTIONS=--require=" + preload.string()}, [](const StartedGate& gate, const Context& context, CheckResult& inner) {
        const std::string script =
            "const http = require('http');"
            "const request = http.request({ host: '127.0.0.1', port: Number(process.argv[1]), path: '/devtools/browser/x', headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==' } });"
            "request.on('upgrade', (response, socket) => { console.log('upgrade ' + response.statusCode); socket.destroy(); });"
            "request.on('response', (response) => { let body = ''; response.on('data', (chunk) => { body += chunk; }); response.on('end', () => console.log('response ' + response.statusCode + ' ' + body)); });"
            "request.on('error', (error) => console.log('error ' + error.message));"
            "request.end();";
        const auto reply = proc::run({"node", "-e", script, std::to_string(gate.port)}, context.workspace, {}, 60000);
        if (reply.out.find("upgrade 101") == std::string::npos) {
            inner.failures.push_back("a websocket upgrade through the gate was not passed to the browser while the gate's fetch is broken: " + reply.out.substr(0, 400) + "; the gate log says: " + support::tail_of(read_text(context.workspace / ".playwriter" / "gate.log"), 600));
        } else {
            inner.summary = "the gate finds the browser's websocket address without fetch: an upgrade through port " + std::to_string(gate.port) + " reached the browser (101) while fetch of /json/version was made to fail";
        }
    });
    std::error_code ec;
    fs::remove(preload, ec);
    return result;
}

namespace {

void seed_profile_caches(const fs::path& workspace) {
    const fs::path profile = workspace / ".playwriter" / "browser-profile" / "Default";
    for (const char* name : {"Cache", "Code Cache"}) {
        fs::create_directories(profile / name);
        std::ofstream(profile / name / "old-entry", std::ios::binary) << std::string(1536 * 1024, 'c');
    }
    std::ofstream(profile / "kept-state", std::ios::binary) << "login state";
}

CheckResult profile_cache_case(const std::string& label, const std::string& limit_mb, bool expect_trim) {
    return with_started_gate(label, {"PLAYWRITER_CACHE_LIMIT_MB=" + limit_mb}, [expect_trim, limit_mb](const StartedGate&, const Context& context, CheckResult& inner) {
        const fs::path profile = context.workspace / ".playwriter" / "browser-profile" / "Default";
        const bool entry_kept = fs::exists(profile / "Cache" / "old-entry") && fs::exists(profile / "Code Cache" / "old-entry");
        const bool state_kept = read_text(profile / "kept-state") == "login state";
        const std::string log = read_text(context.workspace / ".playwriter" / "gate.log");
        if (!state_kept) inner.failures.push_back("a file of the profile outside the caches was removed by the cache trim");
        if (expect_trim && entry_kept) inner.failures.push_back("3 MB of cache against a limit of " + limit_mb + " MB was still there after the browser started; gate log: " + support::tail_of(log, 500));
        if (expect_trim && log.find("profile caches were") == std::string::npos) inner.failures.push_back("the gate log does not say the caches were trimmed: " + support::tail_of(log, 500));
        if (!expect_trim && !entry_kept) inner.failures.push_back("3 MB of cache under a limit of " + limit_mb + " MB was removed");
    }, seed_profile_caches);
}

}

CheckResult check_browser_profile_cache(const std::string&) {
    CheckResult result = profile_cache_case("cache-over", "1", true);
    CheckResult under = profile_cache_case("cache-under", "100", false);
    for (const std::string& failure : under.failures) result.failures.push_back(failure);
    if (result.failures.empty()) result.summary = "a browser start removes the profile's Cache and Code Cache when they exceed PLAYWRITER_CACHE_LIMIT_MB (3 MB against 1 MB) and leaves them under it (3 MB against 100 MB), and never touches a profile file outside the caches";
    return result;
}

namespace {

std::string debug_port_of(const Context& context) {
    std::string text = read_text(context.workspace / ".playwriter" / "debug-port");
    while (!text.empty() && (text.back() == '\n' || text.back() == '\r' || text.back() == ' ')) text.pop_back();
    return text;
}

const char* const kCdpScript =
    "const http = require('http');"
    "const port = process.argv[1]; const mode = process.argv[2];"
    "const get = (path, method) => new Promise((resolve, reject) => { const r = http.request({ host: '127.0.0.1', port, path, method: method || 'GET' }, (q) => { let b = ''; q.on('data', (c) => { b += c; }); q.on('end', () => resolve(b)); }); r.on('error', reject); r.end(); });"
    "(async () => {"
    "  if (mode === 'page') { await get('/json/new?http://127.0.0.1:' + port + '/json/version', 'PUT'); process.exit(0); }"
    "  const info = JSON.parse(await get('/json/version'));"
    "  const ws = new WebSocket(info.webSocketDebuggerUrl); let id = 0; const pending = new Map();"
    "  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };"
    "  await new Promise((r) => { ws.onopen = r; });"
    "  const call = (method, params) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });"
    "  if (mode === 'hold') {"
    "    const pid = Number(process.argv[3]);"
    "    ws.send(JSON.stringify({ id: ++id, method: 'Browser.close' }));"
    "    process.kill(pid, 'SIGSTOP');"
    "    let alive = true; try { process.kill(pid, 0); } catch { alive = false; }"
    "    console.log('held ' + alive); process.exit(0);"
    "  }"
    "  if (mode === 'set') {"
    "    await call('Storage.setCookies', { cookies: [{ name: 'persistent', value: 'p', url: 'http://127.0.0.1/', expires: Math.floor(Date.now() / 1000) + 86400 }, { name: 'sess', value: 's', url: 'http://127.0.0.1/' }] });"
    "    await get('/json/new?http://127.0.0.1:' + port + '/json/version', 'PUT');"
    "    await new Promise((r) => setTimeout(r, 1500));"
    "    ws.send(JSON.stringify({ id: ++id, method: 'Browser.close' }));"
    "    await new Promise((r) => setTimeout(r, 300));"
    "  } else { const r = await call('Storage.getCookies', {}); console.log('cookies ' + (r.result?.cookies ?? []).map((c) => c.name).sort().join(',')); ws.close(); }"
    "  process.exit(0);"
    "})().catch((e) => { console.log('error ' + e.message); process.exit(1); });";

std::string cdp(const Context& context, const std::string& mode, const std::string& extra = {}) {
    std::vector<std::string> argv{"node", "-e", kCdpScript, debug_port_of(context), mode};
    if (!extra.empty()) argv.push_back(extra);
    const auto reply = proc::run(argv, context.workspace, {}, 60000);
    return reply.out + reply.err;
}

bool page_listed(const Context& context) {
    const auto reply = proc::run({"node", "-e", "fetch('http://127.0.0.1:' + process.argv[1] + '/json/list').then((r) => r.text()).then((t) => console.log(t)).catch(() => console.log('unreachable'))", debug_port_of(context)}, context.workspace, {}, 20000);
    return reply.out.find("/json/version") != std::string::npos;
}

}

CheckResult check_browser_keeps_pages(const std::string&) {
    CheckResult result = with_started_gate("keeps-pages", {}, [](const StartedGate& gate, const Context& context, CheckResult& inner) {
        cdp(context, "page");
        std::this_thread::sleep_for(std::chrono::seconds(7));
        const bool listed_before = page_listed(context);
        ::kill(static_cast<pid_t>(gate.browser_pid), SIGSTOP);
        std::this_thread::sleep_for(std::chrono::seconds(20));
        ::kill(static_cast<pid_t>(gate.browser_pid), SIGCONT);
        std::this_thread::sleep_for(std::chrono::seconds(10));
        const bool alive = proc::start_time_of(gate.browser_pid) == gate.browser_started;
        const bool listed = alive && page_listed(context);
        const std::string log = read_text(context.workspace / ".playwriter" / "gate.log");
        if (!listed_before) inner.failures.push_back("the page the check opened was not listed by the browser");
        if (!alive) inner.failures.push_back("the browser (pid " + std::to_string(gate.browser_pid) + ") with an open page was stopped while it did not answer for 20 s and no lease was held; gate log: " + support::tail_of(log, 700));
        else if (!listed) inner.failures.push_back("the browser is up but its page is gone; gate log: " + support::tail_of(log, 500));
    });
    CheckResult idle = with_started_gate("idle-stops", {"PLAYWRITER_IDLE_MS=8000"}, [](const StartedGate& gate, const Context& context, CheckResult& inner) {
        cdp(context, "page");
        bool gone = false;
        for (int second = 0; second < 40 && !gone; ++second) {
            std::this_thread::sleep_for(std::chrono::seconds(1));
            gone = proc::start_time_of(gate.browser_pid) != gate.browser_started;
        }
        if (!gone) inner.failures.push_back("the idle timeout of 8 s did not stop a browser with an open page and no lease within 40 s");
    });
    for (const std::string& failure : idle.failures) result.failures.push_back(failure);
    if (result.failures.empty()) result.summary = "a browser with an open page and no lease survives 20 s in which it does not answer (SIGSTOP), grace period included, with its page; the idle timeout (8 s here) still stops a browser with an open page";
    return result;
}

CheckResult check_browser_start_closing(const std::string&) {
    CheckResult result = with_started_gate("start-closing", {}, [](const StartedGate& gate, const Context& context, CheckResult& inner) {
        const std::string held = cdp(context, "hold", std::to_string(gate.browser_pid));
        if (held.find("held true") == std::string::npos) {
            inner.failures.push_back("the browser was not caught alive after Browser.close, so the start was not tested: " + support::tail_of(held, 200));
            return;
        }
        std::thread resume([pid = gate.browser_pid] {
            std::this_thread::sleep_for(std::chrono::seconds(3));
            ::kill(static_cast<pid_t>(pid), SIGCONT);
        });
        const auto restarted = context.run("start", 120000);
        resume.join();
        if (restarted.exit_code != 0 || restarted.err.find("browser ready") == std::string::npos) inner.failures.push_back("start while the closing browser was still exiting did not report a ready browser: " + restarted.err.substr(0, 300));
        if (cdp(context, "get").find("cookies ") == std::string::npos) inner.failures.push_back("the browser started after a closing one does not answer the debug port");
    });
    if (result.failures.empty()) result.summary = "a start while the browser of the profile is still closing (stopped for 3 s right after Browser.close) waits for the exit and then reports ready only for a browser that answers";
    return result;
}

const char* const kCloseOwnScript = R"JS(
const http = require('http');
const port = Number(process.argv[1]);
const req = (method, path) => new Promise((resolve, reject) => {
  const r = http.request({ host: '127.0.0.1', port, path, method, timeout: 3000 }, (q) => { let b = ''; q.on('data', (c) => { b += c; }); q.on('end', () => resolve(b)); });
  r.on('error', reject);
  r.on('timeout', () => { r.destroy(); reject(new Error('timeout')); });
  r.end();
});
const pages = async () => JSON.parse(await req('GET', '/json/list')).filter((t) => t.type === 'page');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  await req('PUT', '/json/new?http://127.0.0.1:' + port + '/json/version');
  let own = null;
  for (let i = 0; i < 20 && !own; i++) {
    own = (await pages()).find((t) => t.url.includes('/json/version')) ?? null;
    if (!own) await sleep(200);
  }
  const closed = new Set();
  for (const page of (await pages()).filter((t) => t.url === 'about:blank')) {
    closed.add(page.id);
    await req('GET', '/json/close/' + page.id);
  }
  for (let i = 0; i < 30 && !(await pages()).some((t) => t.url === 'about:blank' && !closed.has(t.id)); i++) await sleep(500);
  if (own) await req('GET', '/json/close/' + own.id);
  await sleep(3000);
  console.log('closed own page ' + (own !== null));
  process.exit(0);
})().catch((e) => { console.log('error ' + e.message); process.exit(1); });
)JS";

const char* const kHttpStatusScript = R"JS(
const http = require('http');
const port = Number(process.argv[1]);
http.get({ host: '127.0.0.1', port, path: process.argv[2], timeout: 3000 }, (res) => { res.resume(); res.on('end', () => console.log('status ' + res.statusCode)); }).on('error', (e) => console.log('error ' + e.code));
)JS";

int lease_socket(int port, long long& lease_id) {
    const int fd = ::socket(AF_INET, SOCK_STREAM, 0);
    if (fd < 0) return -1;
    timeval timeout{};
    timeout.tv_sec = 3;
    ::setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof timeout);
    sockaddr_in address{};
    address.sin_family = AF_INET;
    address.sin_port = htons(static_cast<std::uint16_t>(port));
    ::inet_pton(AF_INET, "127.0.0.1", &address.sin_addr);
    if (::connect(fd, reinterpret_cast<sockaddr*>(&address), sizeof address) != 0) {
        ::close(fd);
        return -1;
    }
    const std::string request = "GET /__pwp/lease HTTP/1.1\r\nHost: 127.0.0.1\r\nX-Pwp-Pid: 1\r\n\r\n";
    ::send(fd, request.data(), request.size(), 0);
    std::string text;
    char buffer[256];
    for (int tries = 0; tries < 20 && text.find("leased ") == std::string::npos; ++tries) {
        const ssize_t got = ::recv(fd, buffer, sizeof buffer, 0);
        if (got <= 0) break;
        text.append(buffer, static_cast<std::size_t>(got));
    }
    const std::size_t at = text.find("leased ");
    if (at == std::string::npos) {
        ::close(fd);
        return -1;
    }
    lease_id = std::stoll(text.substr(at + 7));
    return fd;
}

CheckResult check_browser_idle_handover(const std::string&) {
    const auto status_of = [](const Context& context, int port, const std::string& path) {
        const auto reply = proc::run({"node", "-e", kHttpStatusScript, std::to_string(port), path}, context.workspace, {}, 20000);
        return reply.out + reply.err;
    };
    CheckResult idle = with_started_gate("handover-idle", {"PLAYWRITER_HANDOVER_IDLE_MS=2000"}, [&](const StartedGate& gate, const Context& context, CheckResult& inner) {
        long long lease = 0;
        const int fd = lease_socket(gate.port, lease);
        if (fd < 0) {
            inner.failures.push_back("the gate did not grant a lease");
            return;
        }
        std::this_thread::sleep_for(std::chrono::seconds(4));
        const std::string reply = status_of(context, gate.port, "/__pwp/handoff?loaded=9999999999999");
        if (reply.find("status 200") == std::string::npos) {
            inner.failures.push_back("a lease with no call for 4 s (bound 2 s) blocked the handover: " + reply);
        } else {
            bool gone = false;
            for (int tenth = 0; tenth < 150 && !gone; ++tenth) {
                gone = proc::start_time_of(gate.gate_pid) == 0;
                if (!gone) std::this_thread::sleep_for(std::chrono::milliseconds(100));
            }
            if (!gone) inner.failures.push_back("the handed-over gate (pid " + std::to_string(gate.gate_pid) + ") did not exit");
            if (proc::start_time_of(gate.browser_pid) != gate.browser_started) inner.failures.push_back("the handover stopped the browser (pid " + std::to_string(gate.browser_pid) + ")");
        }
        ::close(fd);
    });
    CheckResult busy = with_started_gate("handover-busy", {"PLAYWRITER_HANDOVER_IDLE_MS=2000"}, [&](const StartedGate& gate, const Context& context, CheckResult& inner) {
        long long lease = 0;
        const int fd = lease_socket(gate.port, lease);
        if (fd < 0) {
            inner.failures.push_back("the gate did not grant a lease for the busy case");
            return;
        }
        status_of(context, gate.port, "/__pwp/busy?id=" + std::to_string(lease) + "&delta=1");
        std::this_thread::sleep_for(std::chrono::seconds(4));
        const std::string reply = status_of(context, gate.port, "/__pwp/handoff?loaded=9999999999999");
        if (reply.find("status 409") == std::string::npos) inner.failures.push_back("a lease with a call in flight did not block the handover: " + reply);
        ::close(fd);
    });
    CheckResult older = with_started_gate("handover-older", {"PLAYWRITER_HANDOVER_IDLE_MS=2000"}, [&](const StartedGate& gate, const Context& context, CheckResult& inner) {
        const std::string reply = status_of(context, gate.port, "/__pwp/handoff");
        if (reply.find("status 409") == std::string::npos) inner.failures.push_back("a handoff from a caller that is not newer than the gate was accepted: " + reply);
        if (proc::start_time_of(gate.gate_pid) == 0) inner.failures.push_back("the gate exited on an older caller's handoff");
    });
    for (const std::string& failure : busy.failures) idle.failures.push_back(failure);
    for (const std::string& failure : older.failures) idle.failures.push_back(failure);
    if (idle.failures.empty()) idle.summary = "an idle lease (no call for 2 s here) hands the gate over with its browser kept; a lease with a call in flight blocks the handover; a handoff from a caller that is not newer than the gate is refused";
    return idle;
}

CheckResult check_browser_last_window(const std::string&) {
    if (std::getenv("DISPLAY") == nullptr) {
        CheckResult skipped;
        skipped.summary = "skipped: needs a display, since the launcher starts a headless browser without one";
        return skipped;
    }
    CheckResult result = with_started_gate("last-window", {}, [](const StartedGate& gate, const Context& context, CheckResult& inner) {
        const auto reply = proc::run({"node", "-e", kCloseOwnScript, debug_port_of(context)}, context.workspace, {}, 90000);
        if (reply.out.find("closed own page true") == std::string::npos) inner.failures.push_back("the client's own page was not closed: " + support::tail_of(reply.out + reply.err, 200));
        if (proc::start_time_of(gate.browser_pid) != gate.browser_started) inner.failures.push_back("closing a client's own page, the last one in the project browser, stopped the browser (pid " + std::to_string(gate.browser_pid) + "); gate log: " + support::tail_of(read_text(context.workspace / ".playwriter" / "gate.log"), 300));
        else if (cdp(context, "get").find("cookies ") == std::string::npos) inner.failures.push_back("the browser is up but no longer answers after a client closed its own page");
    });
    if (result.failures.empty()) result.summary = "closing the client's own page leaves the project browser running: the browser keeps a window the client does not own, so the last page closing does not exit a headful Chromium";
    return result;
}

CheckResult check_browser_fingerprint_mismatch(const std::string&) {
    const auto mismatched_start = [](const Context& context) {
        const fs::path launcher = context.sandbox / ".gmnew" / "pw" / "bin" / "playwriter-project";
        return proc::run({"env", "HOME=" + context.sandbox.string(), "PLAYWRITER_PROJECT_DIR=" + context.workspace.string(), "PLAYWRITER_TELEMETRY=0", "PLAYWRITER_IDLE_MS=60000", "node", launcher.string(), "start"}, context.workspace, {}, 120000);
    };
    CheckResult replaced = with_started_gate("fingerprint-replace", {}, [&mismatched_start](const StartedGate& gate, const Context& context, CheckResult& inner) {
        cdp(context, "page");
        const long long gate_started = proc::start_time_of(gate.gate_pid);
        const auto reply = mismatched_start(context);
        if (proc::start_time_of(gate.gate_pid) != gate_started) inner.failures.push_back("a start from a caller that computes another browser fingerprint replaced the gate (pid " + std::to_string(gate.gate_pid) + ") that held a browser with a page; gate log: " + support::tail_of(read_text(context.workspace / ".playwriter" / "gate.log"), 400) + " start said: " + support::tail_of(reply.err, 200));
        if (proc::start_time_of(gate.browser_pid) != gate.browser_started) inner.failures.push_back("the browser (pid " + std::to_string(gate.browser_pid) + ") with a page was stopped by a start whose browser fingerprint differed");
        if (!page_listed(context)) inner.failures.push_back("the page is gone after a start whose browser fingerprint differed");
    });
    CheckResult adopted = with_started_gate("fingerprint-adopt", {}, [&mismatched_start](const StartedGate& gate, const Context& context, CheckResult& inner) {
        cdp(context, "page");
        ::kill(static_cast<pid_t>(gate.gate_pid), SIGUSR2);
        bool handed_over = false;
        for (int tenth = 0; tenth < 150 && !handed_over; ++tenth) {
            handed_over = proc::start_time_of(gate.gate_pid) == 0;
            if (!handed_over) std::this_thread::sleep_for(std::chrono::milliseconds(100));
        }
        if (!handed_over) {
            inner.failures.push_back("the gate (pid " + std::to_string(gate.gate_pid) + ") did not exit on SIGUSR2 within 15 s");
            return;
        }
        const auto reply = mismatched_start(context);
        if (reply.exit_code != 0 || reply.err.find("browser ready") == std::string::npos) inner.failures.push_back("a new gate for a caller whose browser fingerprint differed did not report a ready browser: " + support::tail_of(reply.err, 200));
        if (proc::start_time_of(gate.browser_pid) != gate.browser_started) inner.failures.push_back("a new gate for a caller whose browser fingerprint differed stopped the adopted browser (pid " + std::to_string(gate.browser_pid) + ") that had a page");
        if (!page_listed(context)) inner.failures.push_back("the page is gone after a new gate adopted the browser under a different fingerprint");
    });
    for (const std::string& failure : adopted.failures) replaced.failures.push_back(failure);
    if (replaced.failures.empty()) replaced.summary = "a start from a caller whose browser fingerprint differs leaves a gate with a page and its browser running, and an adopting gate keeps a browser with a page";
    return replaced;
}

CheckResult check_browser_log_bounds(const std::string&) {
    const std::string big(3 * 1048576, 'x');
    const auto seed = [&big](const fs::path& workspace) {
        fs::create_directories(workspace / ".playwriter");
        std::ofstream(workspace / ".playwriter" / "browser.log") << big;
        std::ofstream(workspace / ".playwriter" / "gate.log") << big;
    };
    CheckResult result = with_started_gate("log-bounds", {"PLAYWRITER_LOG_LIMIT_MB=1"}, [](const StartedGate&, const Context& context, CheckResult& inner) {
        const fs::path state = context.workspace / ".playwriter";
        for (const char* name : {"browser.log", "gate.log"}) {
            std::error_code live_ec;
            std::error_code old_ec;
            const auto live = fs::file_size(state / name, live_ec);
            const auto old = fs::file_size(state / (std::string(name) + ".1"), old_ec);
            if (old_ec || old < 3 * 1048576) inner.failures.push_back(std::string(name) + " past its limit was not kept as " + name + ".1 (the 3 MB seed was not moved)");
            if (live_ec || live >= 1048576) inner.failures.push_back(std::string(name) + " is " + std::to_string(live) + " bytes after a start with a 1 MB limit");
        }
    }, seed);
    if (result.failures.empty()) result.summary = "a browser log and a gate log past PLAYWRITER_LOG_LIMIT_MB (1 MB here) move to .1 when a gate or a browser starts, so each keeps at most two sizes";
    return result;
}

std::set<std::string> cookie_names_of(const std::string& reply) {
    std::set<std::string> names;
    const std::size_t at = reply.find("cookies ");
    if (at == std::string::npos) return names;
    std::istringstream line(reply.substr(at + 8));
    std::string list;
    std::getline(line, list);
    std::istringstream items(list);
    for (std::string name; std::getline(items, name, ',');) {
        while (!name.empty() && (name.back() == '\r' || name.back() == ' ')) name.pop_back();
        if (!name.empty()) names.insert(name);
    }
    return names;
}

CheckResult check_browser_session_default(const std::string&) {
    CheckResult result = with_started_gate("session-default", {}, [](const StartedGate& gate, const Context& context, CheckResult& inner) {
        cdp(context, "set");
        bool closed = false;
        for (int tenth = 0; tenth < 600 && !closed; ++tenth) {
            closed = proc::start_time_of(gate.browser_pid) != gate.browser_started;
            if (!closed) std::this_thread::sleep_for(std::chrono::milliseconds(100));
        }
        if (!closed) {
            inner.failures.push_back("the browser (pid " + std::to_string(gate.browser_pid) + ") was still running 60 s after Browser.close");
            return;
        }
        const auto restarted = context.run("start", 120000);
        if (restarted.exit_code != 0) inner.failures.push_back("start after the browser closed did not report a ready browser: " + restarted.err.substr(0, 300));
        const std::set<std::string> names = cookie_names_of(cdp(context, "get"));
        if (!names.count("sess")) inner.failures.push_back("with PLAYWRITER_RESTORE_SESSION unset a session cookie did not survive a stop and start: the launcher must restore the last session by default (a caller's envDefaults are not applied by Claude Code, so the variable is not set there)");
    });
    if (result.failures.empty()) result.summary = "with PLAYWRITER_RESTORE_SESSION unset a session cookie survives a stop and start, because the launcher restores the last session by default";
    return result;
}

CheckResult check_browser_session_restore(const std::string&) {
    const auto names_in = [](const std::string& reply) { return cookie_names_of(reply); };
    const auto run_case = [&names_in](const std::string& label, const std::string& restore, const std::vector<std::string>& required, const std::vector<std::string>& absent) {
        return with_started_gate(label, {"PLAYWRITER_RESTORE_SESSION=" + restore}, [restore, required, absent, &names_in](const StartedGate& gate, const Context& context, CheckResult& inner) {
            cdp(context, "set");
            bool closed = false;
            for (int tenth = 0; tenth < 600 && !closed; ++tenth) {
                closed = proc::start_time_of(gate.browser_pid) != gate.browser_started;
                if (!closed) std::this_thread::sleep_for(std::chrono::milliseconds(100));
            }
            if (!closed) {
                inner.failures.push_back("the browser (pid " + std::to_string(gate.browser_pid) + ") was still running 60 s after Browser.close");
                return;
            }
            const auto restarted = context.run("start", 120000);
            if (restarted.exit_code != 0) inner.failures.push_back("start after the browser closed did not report a ready browser: " + restarted.err.substr(0, 300));
            const std::string reply = cdp(context, "get");
            const std::set<std::string> names = names_in(reply);
            for (const std::string& name : required) {
                if (!names.count(name)) inner.failures.push_back("with PLAYWRITER_RESTORE_SESSION=" + restore + " the cookies after a stop and start do not include " + name + " (got " + std::to_string(names.size()) + " names: " + support::tail_of(reply, 200) + ")");
            }
            for (const std::string& name : absent) {
                if (names.count(name)) inner.failures.push_back("with PLAYWRITER_RESTORE_SESSION=" + restore + " the cookie " + name + " survived a stop and start, which needs PLAYWRITER_RESTORE_SESSION=1");
            }
        });
    };
    CheckResult result = run_case("session-restore", "1", {"persistent", "sess"}, {});
    CheckResult plain = run_case("session-plain", "0", {"persistent"}, {"sess"});
    for (const std::string& failure : plain.failures) result.failures.push_back(failure);
    if (result.failures.empty()) result.summary = "a persistent cookie survives a stop and start of the project browser either way; a session cookie survives only with PLAYWRITER_RESTORE_SESSION=1 (the browser is started with --restore-last-session), which also reopens the tabs";
    return result;
}
}
#else

namespace gm::tool {

CheckResult check_browser_second_gate(const std::string&) {
    CheckResult result;
    result.summary = "skipped: POSIX-only check, runs on Linux and macOS";
    return result;
}

CheckResult check_browser_ws_address(const std::string&) {
    CheckResult result;
    result.summary = "skipped: POSIX-only check, runs on Linux and macOS";
    return result;
}

CheckResult check_gate_handoff(const std::string&) {
    CheckResult result;
    result.summary = "skipped: POSIX-only check, runs on Linux and macOS";
    return result;
}

CheckResult check_browser_profile_cache(const std::string&) {
    CheckResult result;
    result.summary = "skipped: POSIX-only check, runs on Linux and macOS";
    return result;
}

CheckResult check_browser_keeps_pages(const std::string&) {
    CheckResult result;
    result.summary = "skipped: POSIX-only check, runs on Linux and macOS";
    return result;
}

CheckResult check_browser_start_closing(const std::string&) {
    CheckResult result;
    result.summary = "skipped: POSIX-only check, runs on Linux and macOS";
    return result;
}

CheckResult check_browser_idle_handover(const std::string&) {
    CheckResult result;
    result.summary = "skipped: POSIX-only check, runs on Linux and macOS";
    return result;
}

CheckResult check_browser_last_window(const std::string&) {
    CheckResult result;
    result.summary = "skipped: POSIX-only check, runs on Linux and macOS";
    return result;
}

CheckResult check_browser_fingerprint_mismatch(const std::string&) {
    CheckResult result;
    result.summary = "skipped: POSIX-only check, runs on Linux and macOS";
    return result;
}

CheckResult check_browser_log_bounds(const std::string&) {
    CheckResult result;
    result.summary = "skipped: POSIX-only check, runs on Linux and macOS";
    return result;
}

CheckResult check_browser_session_default(const std::string&) {
    CheckResult result;
    result.summary = "skipped: POSIX-only check, runs on Linux and macOS";
    return result;
}

CheckResult check_browser_session_restore(const std::string&) {
    CheckResult result;
    result.summary = "skipped: POSIX-only check, runs on Linux and macOS";
    return result;
}

}
#endif
