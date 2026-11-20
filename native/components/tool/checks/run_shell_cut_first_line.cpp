#include "gm/tool.hpp"
#include "support.hpp"

#include <filesystem>
#include <fstream>
#include <sstream>
#include <system_error>

namespace gm::tool {

namespace {

struct Reply {
    std::string output;
    std::string path;
    std::string file_text;
};

Reply run_shell_body(Session& session, const std::string& command) {
    Reply reply;
    const std::string body = "const s = await gm.run_shell({ command: \"" + command + "\" }); return { output: s.output, outputPath: s.outputPath ?? null };";
    const json::Value answer = output_value(tool_json(session, "run_code", json::Object{{"body", body}}));
    if (const json::Value* text = answer.find("output"); text != nullptr && text->is_string()) reply.output = text->as_string();
    if (const json::Value* where = answer.find("outputPath"); where != nullptr && where->is_string()) reply.path = where->as_string();
    if (!reply.path.empty()) {
        std::ifstream in(reply.path, std::ios::binary);
        std::ostringstream all;
        all << in.rdbuf();
        reply.file_text = all.str();
    }
    return reply;
}

void check_cut_first(CheckResult& result, const std::string& label, const Reply& reply, std::size_t bound) {
    const std::string cut_prefix = std::string("<<") + "<gm-cut omitted=";
    const std::size_t newline = reply.output.find('\n');
    const std::string first_line = newline == std::string::npos ? reply.output : reply.output.substr(0, newline);
    if (first_line.rfind(cut_prefix, 0) != 0) result.failures.push_back(label + ": the first line is not the cut line: " + first_line.substr(0, 120));
    if (!reply.path.empty() && first_line.find("outputPath=" + reply.path + " ") == std::string::npos) result.failures.push_back(label + ": the cut line does not carry the complete outputPath");
    if (reply.output.size() > bound) result.failures.push_back(label + ": the preview is " + std::to_string(reply.output.size()) + " bytes, expected at most " + std::to_string(bound));
    if (reply.file_text.rfind("L1 ", 0) != 0 && label == "long") result.failures.push_back(label + ": the outputPath file does not hold the full output");
}

}

CheckResult check_run_shell_cut_first_line(const std::string& binary) {
    CheckResult result;
    const std::filesystem::path sandbox = support::fresh_sandbox("run-shell-cut-first-line");
    Reply long_reply;
    Reply short_reply;
    bool started = false;
    {
        Session session(binary, sandbox / "ws", sandbox, 300000, true);
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + binary);
        } else {
            started = true;
            support::start_session(session, "check-run-shell-cut-first-line");
            long_reply = run_shell_body(session, "seq 1 40 | while read -r l; do printf 'L%s ' $l; printf 'x%.0s' $(seq 3000); echo; done");
            short_reply = run_shell_body(session, "seq 1 3000");
        }
    }
    std::error_code ec;
    std::filesystem::remove_all(sandbox, ec);
    if (!started) return result;
    check_cut_first(result, "long", long_reply, 8000);
    check_cut_first(result, "condensed", short_reply, 8000);
    result.summary = "a cut run_shell output, long or condensed, begins with its cut line carrying the complete outputPath, then a bounded preview";
    return result;
}

}
