#include "gm/tool.hpp"

#include <chrono>
#include <filesystem>
#include <fstream>
#include <memory>
#include <system_error>
#include <thread>

namespace gm::tool {
namespace {

const std::string kBody = R"js(
const out = {};
out.plain = await gm.fetch({ url: 'data:text/plain,hello%20world' });
out.cut = await gm.fetch({ url: 'data:text/plain,abcdefghij', maxBytes: 4 });
out.match = await gm.fetch({ url: 'data:text/plain,a%0Ab%0Aa2', match: '^a' });
const large = await gm.fetch({ url: 'data:text/html,<script>' + 'a'.repeat(120000) + '</script><p>visible</p>' });
const long = await gm.fetch({ url: 'data:text/html,<!--' + 'b'.repeat(120000) + '--><p>after</p>' });
out.largehtml = large.ok && String(large.output).includes('visible') && long.ok && String(long.output).includes('after') ? 'kept' : 'failed';
out.base64 = await gm.fetch({ url: 'data:text/plain;base64,aGk=' });
out.invalid = await gm.fetch({ url: 'not a url' });
out.timeout = await gm.fetch({ url: 'data:text/plain,x', timeoutMs: 0 });
out.refused = await gm.fetch({ url: 'http://127.0.0.1:1/' });
return JSON.stringify(out);
)js";

bool contains(const std::string& text, const std::string& word) { return text.find(word) != std::string::npos; }

const std::string kServerScript = R"js(
import { createServer } from 'node:https';
import { readFileSync, writeFileSync } from 'node:fs';
const [key, cert, portFile] = process.argv.slice(2);
const text = (res, body) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end(body); };
const bytes = (res, size) => { res.writeHead(200, { 'content-type': 'text/plain', 'content-length': size }); res.end(Buffer.alloc(size, 97)); };
const server = createServer({ key: readFileSync(key), cert: readFileSync(cert) }, (req, res) => {
    const path = new URL(req.url, 'https://127.0.0.1').pathname;
    const chain = /^\/chain\/(\d+)$/.exec(path);
    const loop = /^\/loop\/(\d+)$/.exec(path);
    if (chain) {
        const hop = Number(chain[1]);
        if (hop < 3) {
            res.writeHead(302, { location: '/chain/' + (hop + 1) });
            res.end();
            return;
        }
        text(res, 'landed after ' + hop);
        return;
    }
    if (loop) {
        res.writeHead(302, { location: '/loop/' + (Number(loop[1]) + 1) });
        res.end();
        return;
    }
    if (path === '/plain') return text(res, 'secure over https');
    if (path === '/edge') return bytes(res, 16777216);
    if (path === '/big') return bytes(res, 17825792);
    res.writeHead(404);
    res.end();
});
server.listen(0, '127.0.0.1', () => writeFileSync(portFile, String(server.address().port)));
)js";

std::string transport_body(const std::string& origin) {
    return "const origin = '" + origin + "';\n" + R"js(
const out = {};
out.https = await gm.fetch({ url: origin + '/plain' });
out.chain = await gm.fetch({ url: origin + '/chain/0' });
out.loop = await gm.fetch({ url: origin + '/loop/0' });
out.edge = await gm.fetch({ url: origin + '/edge', maxBytes: 16 });
out.big = await gm.fetch({ url: origin + '/big', maxBytes: 16 });
out.file = await gm.fetch({ url: 'file:///etc/hostname' });
return JSON.stringify(out);
)js";
}

}

CheckResult check_fetch(const std::string& binary) {
    CheckResult result;
    const auto stamp = std::chrono::steady_clock::now().time_since_epoch().count();
    const auto sandbox = std::filesystem::temp_directory_path() / ("gm-fetch-" + std::to_string(stamp));
    const auto workspace = sandbox / "ws";
    std::filesystem::create_directories(workspace);
    std::string text;
    {
        Session session(binary, workspace, sandbox);
        if (!session.started()) result.failures.push_back("gm serve did not start from " + binary);
        if (session.started()) {
            session.rpc("initialize", json::Object{{"protocolVersion", "2025-06-18"}, {"capabilities", json::Object{}},
                                                  {"clientInfo", json::Object{{"name", "gm-tool"}, {"version", "1"}}}});
            session.notify("notifications/initialized", json::Object{});
            session.rpc("resources/read", json::Object{{"uri", "skill://gm/SKILL.md"}});
            session.rpc("tools/call", json::Object{{"name", "next_context"}, {"arguments", json::Object{}}});
            text = session.body(kBody);
        }
        session.stop();
    }
    auto expect = [&](bool condition, const std::string& what) {
        if (!condition) result.failures.push_back(what + ": " + text.substr(0, 400));
    };
    expect(contains(text, "200 11 bytes data:text/plain,hello%20world\\nhello world"), "a data URL was not returned as its text body");
    expect(contains(text, "body truncated to 4 bytes of 10 bytes"), "maxBytes did not cut the body with its marker");
    expect(contains(text, "a\\na2"), "match did not keep only the lines that match, in order");
    expect(contains(text, "\"largehtml\":\"kept\""), "large text/html data URLs did not convert their script block and long comment without crashing the worker");
    expect(contains(text, "base64 data URLs are not supported"), "a base64 data URL was not refused");
    expect(contains(text, "url is not a valid URL"), "an invalid url was not refused");
    expect(contains(text, "timeoutMs must be an integer from 1 to 60000"), "timeoutMs 0 was not refused");
    expect(contains(text, "\"attempts\":4") && contains(text, "\"exhausted\":true"), "an unreachable host did not make 4 attempts (1 + 3 retries) and report exhaustion");
    expect(contains(text, "ECONNREFUSED"), "an unreachable host did not report ECONNREFUSED");
    std::error_code ignored;
    std::filesystem::remove_all(sandbox, ignored);
    result.summary = "data URLs return their text, cut and match, large text/html bodies convert without crashing the worker, base64 and bad input are refused, and an unreachable host retries 3 times then reports exhaustion";
    return result;
}

CheckResult check_fetch_transport(const std::string& binary) {
    CheckResult result;
#if defined(_WIN32)
    result.summary = "skipped (platform: the transport check needs openssl and node on PATH; it runs on linux and macOS)";
    return result;
#else
    const auto started = std::chrono::steady_clock::now();
    const auto sandbox = std::filesystem::temp_directory_path() / ("gm-fetch-transport-" + std::to_string(started.time_since_epoch().count()));
    const auto workspace = sandbox / "ws";
    const auto script = sandbox / "server.mjs";
    const auto key = sandbox / "key.pem";
    const auto cert = sandbox / "cert.pem";
    const auto port_file = sandbox / "port.txt";
    std::filesystem::create_directories(workspace);
    std::ofstream(script) << kServerScript;
    std::string text;
    std::string port;
    std::shared_ptr<proc::Child> server;
    const auto made = proc::run({"openssl", "req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-keyout", key.string(), "-out", cert.string(), "-days", "1", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"}, sandbox, {}, 60000);
    if (!made.started || made.exit_code != 0) result.failures.push_back("openssl could not make the test certificate: " + made.err.substr(0, 300));
    if (result.failures.empty()) {
        if (auto spawned = proc::Child::spawn({"node", script.string(), key.string(), cert.string(), port_file.string()}, proc::SpawnOptions(sandbox))) server = *spawned;
    }
    const auto began = std::chrono::steady_clock::now();
    while (server && port.empty() && std::chrono::steady_clock::now() - began < std::chrono::seconds(10)) {
        std::ifstream in(port_file);
        in >> port;
        if (port.empty()) std::this_thread::sleep_for(std::chrono::milliseconds(50));
    }
    if (result.failures.empty() && port.empty()) result.failures.push_back("the local https server did not write its port: node with its https module is needed on PATH");
    if (!port.empty()) {
        Session session(binary, workspace, sandbox, 240000, true, {}, std::vector<std::pair<std::string, std::string>>{{"CURL_CA_BUNDLE", cert.string()}});
        if (!session.started()) result.failures.push_back("gm serve did not start from " + binary);
        if (session.started()) {
            session.rpc("initialize", json::Object{{"protocolVersion", "2025-06-18"}, {"capabilities", json::Object{}},
                                                  {"clientInfo", json::Object{{"name", "gm-tool"}, {"version", "1"}}}});
            session.notify("notifications/initialized", json::Object{});
            session.rpc("resources/read", json::Object{{"uri", "skill://gm/SKILL.md"}});
            session.rpc("tools/call", json::Object{{"name", "next_context"}, {"arguments", json::Object{}}});
            text = session.body(transport_body("https://127.0.0.1:" + port));
        }
        session.stop();
    }
    if (server) server->kill();
    auto expect = [&](bool condition, const std::string& what) {
        if (!condition) result.failures.push_back(what + ": " + text.substr(0, 400));
    };
    expect(contains(text, "secure over https") && contains(text, "\"status\":200"), "an https URL was not fetched from the local https server with its certificate taken from CURL_CA_BUNDLE");
    expect(contains(text, "landed after 3") && contains(text, "\"redirects\":3"), "a three-hop redirect chain was not followed to its end with redirects reported as 3");
    expect(contains(text, "\"code\":\"ETOOMANYREDIRECTS\""), "a redirect loop longer than the 30-redirect limit was not refused with ETOOMANYREDIRECTS");
    expect(contains(text, "\"bytes\":16777216") && contains(text, "\"ok\":true"), "a body of exactly 16777216 bytes was not accepted");
    expect(contains(text, "\"code\":\"EFBIG\""), "a body of 17825792 bytes, over the 16 MiB cap, was not refused with EFBIG");
    expect(contains(text, "url must be an http, https or data URL"), "a file: URL was not refused as a scheme that is not fetched");
    std::error_code ignored;
    std::filesystem::remove_all(sandbox, ignored);
    const double wall = std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count();
    result.summary = "over https with a local certificate a three-hop redirect chain is followed, a 31-hop loop is refused as ETOOMANYREDIRECTS, a 16777216-byte body is accepted, a 17825792-byte body is refused as EFBIG, and file: is refused (wall " + std::to_string(wall) + " s)";
    return result;
#endif
}

}
