#include "gm/tool.hpp"
#include "support.hpp"

#include <filesystem>
#include <string>
#include <system_error>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;
using namespace support;

constexpr const char* kHint = "belongs in run_code's data argument";

std::string text_at(const json::Value& reply, const char* key) {
    const json::Value* field = reply.find(key);
    if (field == nullptr) return {};
    return field->is_string() ? field->as_string() : json::dump(*field);
}

}

CheckResult check_retry_hints(const std::string& binary) {
    CheckResult result;
    const fs::path sandbox = fresh_sandbox("dt");
    {
        Session session(binary, sandbox / "ws", sandbox);
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + binary);
            return result;
        }
        initialize_session(session, "gm-tool");
        session.rpc("resources/read", json::Object{{"uri", "skill://gm/SKILL.md"}});
        session.rpc("tools/call", json::Object{{"name", "next_context"}, {"arguments", json::Object{}}});
        const std::string script = "echo ${HOME} `date`";
        const json::Value carried = tool_json(session, "run_code", json::Object{{"body", "return data.script + '|' + typeof data.n;"}, {"data", json::Object{{"script", script}, {"n", 3}}}});
        if (text_at(carried, "output") != script + "|number") result.failures.push_back("data did not reach the body verbatim: " + json::dump(carried).substr(0, 300));
        const json::Value unloadable = tool_json(session, "run_code", json::Object{{"body", "return `${`;"}});
        if (!contains(text_at(unloadable, "error"), "the body does not load") || !contains(text_at(unloadable, "error"), kHint)) result.failures.push_back("a body that cannot load because of inline template text does not name the data argument: " + text_at(unloadable, "error").substr(0, 300));
        const json::Value interpolated = tool_json(session, "run_code", json::Object{{"body", "return `${MISSING_SHELL_NAME}`;"}});
        if (!contains(text_at(interpolated, "error"), "MISSING_SHELL_NAME is not defined") || !contains(text_at(interpolated, "error"), kHint)) result.failures.push_back("a shell name interpolated by mistake does not name the data argument: " + text_at(interpolated, "error").substr(0, 300));
        const json::Value plain = tool_json(session, "run_code", json::Object{{"body", "return (;"}});
        if (!contains(text_at(plain, "error"), "the body does not load") || contains(text_at(plain, "error"), kHint)) result.failures.push_back("a plain syntax error should not carry the data hint: " + text_at(plain, "error").substr(0, 300));
        const json::Value dumped = tool_json(session, "run_code", json::Object{{"body", "await gm.write_file({ path: 'big.txt', content: ('x'.repeat(99) + '\\n').repeat(100) }); const cut = await gm.run_shell({ command: 'cat big.txt' }); return { hint: cut.hint, head: String(cut.output).slice(0, 400) };"}});
        const std::string dump = json::dump(dumped);
        if (!contains(dump, "with full: true returns the whole output in one reply") || contains(dump, "offset and limit gives the same lines")) result.failures.push_back("a cut dump does not point at full: true: " + dump.substr(0, 400));
        session.stop();
    }
    std::error_code ec;
    fs::remove_all(sandbox, ec);
    if (result.failures.empty()) result.summary = "run_code's data argument reaches the body verbatim (a shell line with a dollar brace and backticks), and a body that fails to load on inline template text, or names an undefined shell variable through a dollar brace, is told to use data; a plain syntax error is not; a cut cat of a file points at full: true for the whole output in one reply instead of ranged rereads";
    return result;
}

}
