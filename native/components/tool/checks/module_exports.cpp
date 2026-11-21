#include "gm/tool.hpp"
#include "support.hpp"

#include <chrono>
#include <filesystem>
#include <fstream>
#include <string>
#include <system_error>

namespace gm::tool {
namespace {

constexpr std::uint64_t kWatchdogMs = 120000;
constexpr std::string_view expected = "root-import,sub-default,feature-alpha-import,legacy-main,refused,sub-require,cjs-main,file-only,refused,util-import,sub-default,feature-beta,refused,refused,util-require,sub-require,refused";

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
const cjsSub = require('@acme/pkg/sub');
const cjsMain = require('cjs-pkg');
const single = require('file-only');
let requireHidden = 'resolved';
try {
  require('@acme/pkg/hidden');
} catch (err) {
  requireHidden = 'refused';
}
const util = await import('#util');
const dep = await import('#dep');
const beta = await import('#feature/beta');
let mapMissing = 'resolved';
try {
  await import('#nope');
} catch (err) {
  mapMissing = 'refused';
}
let mapHidden = 'resolved';
try {
  await import('#hidden-target');
} catch (err) {
  mapHidden = 'refused';
}
const cjsUtil = require('#util');
const cjsDep = require('#dep');
let requireMissing = 'resolved';
try {
  require('#nope');
} catch (err) {
  requireMissing = 'refused';
}
return [root.label, sub.label, feature.label, legacy.label, hidden, cjsSub.label, cjsMain.label, single.label, requireHidden, util.label, dep.label, beta.label, mapMissing, mapHidden, cjsUtil.label, cjsDep.label, requireMissing].join(',');
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
    write_file(acme / "cjs" / "root.js", "module.exports = { label: 'root-default' };\n");
    write_file(acme / "esm" / "sub.js", "export const label = 'sub-default';\n");
    write_file(acme / "cjs" / "sub.js", "module.exports = { label: 'sub-require' };\n");
    write_file(acme / "esm" / "feature" / "alpha.js", "export const label = 'feature-alpha-import';\n");
    write_file(acme / "esm" / "hidden.js", "export const label = 'hidden-unexported';\n");
    write_file(workspace / "node_modules" / "legacy-pkg" / "package.json", R"({"name":"legacy-pkg","version":"1.0.0","main":"./lib/entry.js"})");
    write_file(workspace / "node_modules" / "legacy-pkg" / "lib" / "entry.js", "export const label = 'legacy-main';\n");
    write_file(workspace / "node_modules" / "cjs-pkg" / "package.json", R"({"name":"cjs-pkg","version":"1.0.0","main":"./index.js"})");
    write_file(workspace / "node_modules" / "cjs-pkg" / "index.js", "module.exports = { label: 'cjs-main' };\n");
    write_file(workspace / "node_modules" / "file-only.js", "module.exports = { label: 'file-only' };\n");
    write_file(workspace / "package.json", R"({"name":"app","version":"1.0.0","imports":{"#util":{"import":"./src/util-esm.js","require":"./src/util-cjs.cjs","default":"./src/util-esm.js"},"#dep":"@acme/pkg/sub","#feature/*":"./src/feature/*.js","#hidden-target":"@acme/pkg/hidden"}})");
    write_file(workspace / "src" / "util-esm.js", "export const label = 'util-import';\n");
    write_file(workspace / "src" / "util-cjs.cjs", "module.exports = { label: 'util-require' };\n");
    write_file(workspace / "src" / "feature" / "beta.js", "export const label = 'feature-beta';\n");
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
            initialize_session(session, "gm-tool");
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
    result.summary = "bare package names resolve from node_modules: exports exact subpath with import and default conditions, exports pattern, main where exports is absent, and an unexported subpath refused; require uses the require condition, a main-only package, a file-only module, and refuses an unexported subpath; the imports (#) map resolves a conditioned target, a bare target, a pattern for import and require, and refuses an unmapped name and a target that exports refuses";
    return result;
}

}
