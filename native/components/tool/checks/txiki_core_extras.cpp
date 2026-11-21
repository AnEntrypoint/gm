#include "gm/tool.hpp"
#include "support.hpp"

#include <system_error>

namespace gm::tool {
namespace {

struct Case {
    const char* name;
    const char* body;
    const char* expected;
};

constexpr const char* prelude = "const core = (await import('tjs:internal/core')).default; const text = (bytes) => new TextDecoder().decode(bytes); ";

const Case cases[] = {
    {"spawnSync returns status, stdout, stderr and a pid",
     "const r = core.spawnSync('/bin/sh', ['-c', 'printf out; printf err >&2; exit 3']); return { status: r.status, signal: r.signal, out: text(r.stdout), err: text(r.stderr), pid: r.pid > 0, error: r.error ?? null };",
     R"({"status":3,"signal":null,"out":"out","err":"err","pid":true,"error":null})"},
    {"spawnSync passes input, env and cwd",
     "const r = core.spawnSync('/bin/sh', ['-c', 'cat; printf %s \"$K\"; pwd'], { input: 'in ', env: { K: 'v', PATH: '/usr/bin:/bin' }, cwd: '/tmp' }); return { status: r.status, out: text(r.stdout) };",
     R"({"status":0,"out":"in v/tmp\n"})"},
    {"spawnSync stops a child at its timeout with the kill signal",
     "const r = core.spawnSync('/bin/sh', ['-c', 'sleep 5'], { timeout: 300, killSignal: 'SIGTERM' }); return { status: r.status, signal: r.signal, code: r.error?.code };",
     R"({"status":null,"signal":"SIGTERM","code":"ETIMEDOUT"})"},
    {"spawnSync names a missing file ENOENT",
     "const r = core.spawnSync('/nonexistent/gm-spawn-sync'); return { status: r.status, code: r.error?.code, out: r.stdout.length };",
     R"({"status":null,"code":"ENOENT","out":0})"},
    {"spawnSync reports the signal that ended a child",
     "const r = core.spawnSync('/bin/sh', ['-c', 'kill -9 $$']); return { status: r.status, signal: r.signal };",
     R"({"status":null,"signal":"SIGKILL"})"},
    {"spawnSync with shell joins the file and its arguments",
     "const r = core.spawnSync('echo hi && echo', ['there'], { shell: true }); return { status: r.status, out: text(r.stdout) };",
     R"({"status":0,"out":"hi\nthere\n"})"},
    {"spawnSync cuts output at maxBuffer and says ENOBUFS",
     "const r = core.spawnSync('/bin/sh', ['-c', 'head -c 5000 /dev/zero'], { maxBuffer: 100 }); return { code: r.error?.code, length: r.stdout.length };",
     R"({"code":"ENOBUFS","length":100})"},
    {"a context runs code against its sandbox and not the caller's globals",
     "const realm = core.vmCreateContext(); const sandbox = { a: 2 }; const result = core.vmRunInContext(realm, sandbox, 'var b = a * 21; a = 5; typeof globalThis.callerMarker', 'one.js'); globalThis.callerMarker = 1; return { result, a: sandbox.a, b: sandbox.b, leaked: typeof globalThis.b };",
     R"({"result":"undefined","a":5,"b":42,"leaked":"undefined"})"},
    {"a context keeps its state between runs and runs its own functions",
     "const realm = core.vmCreateContext(); const sandbox = {}; core.vmRunInContext(realm, sandbox, 'function inc() { n += 1; return n }; n = 1;', 'a.js'); const second = core.vmRunInContext(realm, sandbox, 'inc()', 'b.js'); return { second, n: sandbox.n, kind: typeof sandbox.inc };",
     R"({"second":2,"n":2,"kind":"function"})"},
    {"a context throws what its code throws",
     "const realm = core.vmCreateContext(); try { core.vmRunInContext(realm, {}, 'throw new Error(\"boom\")', 'c.js'); return 'no throw'; } catch (error) { return error.message; }",
     R"("boom")"},
    {"a worker reads the workerData its constructor was given, with nested values",
     "const worker = new core.Worker('worker-data.mjs', 'self.postMessage(globalThis.workerData)', { workerData: { n: 1, list: [1, 2, 3], nested: { ok: true } } }); const pipe = worker.messagePipe; const got = await new Promise((resolve) => { pipe.onmessage = (event) => resolve(event.data); pipe.start(); }); worker.terminate(); return got;",
     R"({"n":1,"list":[1,2,3],"nested":{"ok":true}})"},
    {"a worker started without workerData sees none",
     "const worker = new core.Worker('no-data.mjs', 'self.postMessage(typeof globalThis.workerData)'); const pipe = worker.messagePipe; const got = await new Promise((resolve) => { pipe.onmessage = (event) => resolve(event.data); pipe.start(); }); worker.terminate(); return got;",
     R"("undefined")"},
    {"the async frame survives awaits, timers and promise chains, and stays apart between concurrent runs",
     "const run = (frame, fn) => { const previous = core.asyncFrame; core.asyncFrame = frame; try { return fn(); } finally { core.asyncFrame = previous; } }; const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)); const both = await Promise.all([run('A', async () => { await pause(20); await null; return core.asyncFrame; }), run('B', async () => { await pause(5); return core.asyncFrame; }), run('C', () => Promise.resolve().then(() => core.asyncFrame))]); return { both, after: core.asyncFrame };",
     R"({"both":["A","B","C"],"after":null})"},
};

}

CheckResult check_txiki_core_extras(const std::string& binary) {
    CheckResult result;
    const std::filesystem::path sandbox = support::fresh_sandbox("txiki-core-extras");
    {
        Session session(binary, sandbox / "ws", sandbox, 300000, true);
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + binary);
        } else {
            support::start_session(session, "check-txiki-core-extras");
            for (const Case& entry : cases) {
                const json::Value reply = tool_json(session, "run_code", json::Object{{"body", std::string(prelude) + entry.body}, {"timeoutMs", 30000}});
                const std::string answer = json::dump(output_value(reply));
                if (answer != entry.expected) result.failures.push_back(std::string(entry.name) + ": expected " + entry.expected + ", got " + answer.substr(0, 400) + (answer == "null" ? " (reply " + json::dump(reply).substr(0, 300) + ")" : ""));
            }
        }
    }
    std::error_code ec;
    std::filesystem::remove_all(sandbox, ec);
    if (result.failures.empty()) result.summary = std::to_string(sizeof(cases) / sizeof(cases[0])) + " cases on the core binding: spawnSync, vm contexts, async frames and workerData";
    return result;
}

}
