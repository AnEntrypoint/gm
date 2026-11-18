#include "gm/tool.hpp"

#include <chrono>
#include <filesystem>
#include <fstream>
#include <string>
#include <system_error>

namespace gm::tool {
namespace {

constexpr std::uint64_t kWatchdogMs = 120000;
constexpr std::string_view expected = "root-import,sub-default,feature-alpha-import,legacy-main,refused";

constexpr std::string_view probe_body = R"JS(
const root = await import('@acme/pkg');
const sub = await import('@acme/pkg/sub');
const feature = await import('@acme/pkg/feature/alpha');
const legacy = await import('legacy-pkg');
let hidden = 'resolved';
try {
  await import('@acme/pkg/hidden');
} catch (err) {
  hidden = 'refused';
}
return [root.label, sub.label, feature.label, legacy.label, hidden].join(',');
)JS";

void write_file(const std::filesystem::path& file, const std::string& text) {
    std::filesystem::create_directories(file.parent_path());
    std::ofstream(file) << text;
}

void write_package(const std::filesystem::path& workspace) {
    const std::filesystem::path acme = workspace / "node_modules" / "@acme" / "pkg";
    write_file(acme / "package.json", R"({"name":"@acme/pkg","version":"1.0.0","main":"./main.js","exports":{".":{"import":"./esm/root.js","default":"./cjs/root.js"},"./sub":{"require":"./cjs/sub.js","default":"./esm/sub.js"},"./feature/*":{"import":"./esm/feature/*.js"}}})");
    write_file(acme / "main.js", "export const label = 'main-unexported';\n");
    write_file(acme / "esm" / "root.js", "export const label = 'root-import';\n");
    write_file(acme / "cjs" / "root.js", "export const label = 'root-default';\n");
    write_file(acme / "esm" / "sub.js", "export const label = 'sub-default';\n");
    write_file(acme / "cjs" / "sub.js", "export const label = 'sub-require';\n");
    write_file(acme / "esm" / "feature" / "alpha.js", "export const label = 'feature-alpha-import';\n");
    write_file(acme / "esm" / "hidden.js", "export const label = 'hidden-unexported';\n");
    write_file(workspace / "node_modules" / "legacy-pkg" / "package.json", R"({"name":"legacy-pkg","version":"1.0.0","main":"./lib/entry.js"})");
    write_file(workspace / "node_modules" / "legacy-pkg" / "lib" / "entry.js", "export const label = 'legacy-main';\n");
}

}

CheckResult check_module_exports(const std::string& binary) {
    CheckResult result;
    const auto stamp = std::chrono::steady_clock::now().time_since_epoch().count();
    const auto sandbox = std::filesystem::temp_directory_path() / ("gm-module-exports-" + std::to_string(stamp));
    const auto workspace = sandbox / "ws";
    write_package(workspace);
    std::string reply;
    {
        Session session(binary, workspace, sandbox, kWatchdogMs);
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + binary);
        } else {
            session.rpc("initialize", json::Object{{"protocolVersion", "2025-06-18"}, {"capabilities", json::Object{}},
                                                  {"clientInfo", json::Object{{"name", "gm-tool"}, {"version", "1"}}}});
            session.notify("notifications/initialized", json::Object{});
            session.rpc("resources/read", json::Object{{"uri", "skill://gm/SKILL.md"}});
            session.rpc("tools/call", json::Object{{"name", "next_context"}, {"arguments", json::Object{}}});
            reply = session.body(std::string(probe_body));
            if (reply.find(expected) == std::string::npos) {
                result.failures.push_back("a bare package name and its exports subpaths did not resolve: the body returned " + reply.substr(0, 400) +
                                          ", expected " + std::string(expected));
            }
        }
        session.stop();
    }
    std::error_code ignored;
    std::filesystem::remove_all(sandbox, ignored);
    result.summary = "bare package names resolve from node_modules: exports exact subpath with import and default conditions, exports pattern, main where exports is absent, and an unexported subpath refused; reply: " + reply.substr(0, 200);
    return result;
}

}
