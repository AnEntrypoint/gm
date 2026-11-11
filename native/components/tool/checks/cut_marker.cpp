#include "gm/tool.hpp"

#include <chrono>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <system_error>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

constexpr const char* kBody = R"JS(
  await gm.write_file({ path: 'src.txt', content: 'line of source text\n'.repeat(500) });
  await gm.write_file({ path: 'small.txt', content: 'short\n' });
  const bounded = await gm.read_file({ path: 'src.txt' });
  const refusedCopy = await gm.write_file({ path: 'copy.txt', content: bounded.output });
  const copyAfterRefusal = await gm.stat_file({ path: 'copy.txt' });
  const full = await gm.read_file({ path: 'src.txt', full: true });
  const fullCopy = await gm.write_file({ path: 'copy.txt', content: full.output });
  await gm.read_file({ path: 'small.txt' });
  const pointer = await gm.read_file({ path: 'small.txt' });
  const refusedPointer = await gm.write_file({ path: 'pointer.txt', content: pointer.output });
  const refusedEdit = await gm.edit_file({ path: 'copy.txt', old: 'line of source text', new: bounded.output });
  return { bounded: { truncated: bounded.truncated, complete: bounded.complete, outputPath: bounded.outputPath, chars: String(bounded.output).length, output: bounded.output }, refusedCopy, copyAfterRefusal, full: { truncated: full.truncated, complete: full.complete }, fullCopy, pointer: { pointer: pointer.pointer, complete: pointer.complete, output: pointer.output }, refusedPointer, refusedEdit };
)JS";

std::string repeat_line() {
    std::string text;
    for (int i = 0; i < 500; ++i) text += "line of source text\n";
    return text;
}

std::string read_text(const fs::path& file) {
    std::ifstream in(file, std::ios::binary);
    std::ostringstream text;
    text << in.rdbuf();
    return text.str();
}

std::string text_of(const json::Value& value, const std::string& dotted) {
    const json::Value* found = value_at(value, dotted);
    if (found == nullptr) return {};
    return found->is_string() ? found->as_string() : json::dump(*found);
}

bool bool_at(const json::Value& value, const std::string& dotted, bool expected) {
    const json::Value* found = value_at(value, dotted);
    return found != nullptr && found->is_bool() && found->as_bool() == expected;
}

bool has(const std::string& text, const std::string& needle) {
    return text.find(needle) != std::string::npos;
}

}

CheckResult check_cut_marker(const std::string& binary) {
    CheckResult result;
    const auto started = std::chrono::steady_clock::now();
    const auto stamp = started.time_since_epoch().count();
    const fs::path sandbox = fs::temp_directory_path() / ("gm-cut-marker-" + std::to_string(stamp));
    const fs::path workspace = sandbox / "ws";
    fs::create_directories(workspace);
    {
        Session session(binary, workspace, sandbox, 180000, true);
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + binary);
        } else {
            session.rpc("initialize", json::Object{{"protocolVersion", "2025-06-18"}, {"capabilities", json::Object{}},
                                                  {"clientInfo", json::Object{{"name", "check-cut-marker"}, {"version", "1"}}}});
            session.notify("notifications/initialized", json::Object{});
            session.rpc("resources/read", json::Object{{"uri", "skill://gm/SKILL.md"}});
            tool_text(session, "next_context", json::Object{});
            const json::Value result_reply = tool_json(session, "run_code", json::Object{{"body", kBody}});
            const json::Value r = output_value(result_reply);

            if (fs::exists(workspace / "pointer.txt")) result.failures.push_back("a refused pointer write reached disk");
            if (read_text(workspace / "copy.txt") != repeat_line()) result.failures.push_back("copy.txt must hold the full text, not a cut");
            if (value_at(r, "bounded") == nullptr) {
                result.failures.push_back("the body did not return its results: " + json::dump(result_reply).substr(0, 300));
            } else {
                const std::string output_path = text_of(r, "bounded.outputPath");
                if (!bool_at(r, "bounded.truncated", true)) result.failures.push_back("a bounded read must say truncated: " + json::dump(*value_at(r, "bounded")).substr(0, 200));
                if (!bool_at(r, "bounded.complete", false)) result.failures.push_back("a bounded read must say complete: false, in its JSON: " + json::dump(*value_at(r, "bounded")).substr(0, 200));
                if (output_path.empty()) result.failures.push_back("a bounded read must name its outputPath");
                const std::string cut_output = text_of(r, "bounded.output");
                if (!has(cut_output, "<<<gm-cut omitted=")) result.failures.push_back("the cut must be an unmistakable <<<gm-cut marker, not an ellipsis");
                if (has(cut_output, "\n...\n")) result.failures.push_back("the cut must not be shaped like content (no ellipsis line)");
                if (!bool_at(r, "refusedCopy.ok", false)) result.failures.push_back("a write whose content carries the cut marker must be refused: " + json::dump(*value_at(r, "refusedCopy")).substr(0, 200));
                const std::string refused = text_of(r, "refusedCopy.error");
                if (!has(refused, "outputPath") || !has(refused, "full: true") || (!output_path.empty() && !has(refused, output_path)))
                    result.failures.push_back("the refusal must name outputPath and full: true: " + refused.substr(0, 300));
                if (has(json::dump(value_at(r, "copyAfterRefusal") != nullptr ? *value_at(r, "copyAfterRefusal") : json::Value()), "\"exists\":true"))
                    result.failures.push_back("a refused write must leave no copy.txt behind");
                const json::Value* full = value_at(r, "full");
                if (!(full != nullptr && (bool_at(*full, "complete", true) || bool_at(*full, "truncated", false)))) result.failures.push_back("a full read must not be bounded");
                if (!bool_at(r, "fullCopy.ok", true)) result.failures.push_back("a write of a full read must succeed: " + json::dump(*value_at(r, "fullCopy")).substr(0, 200));
                if (!bool_at(r, "pointer.pointer", true) || !bool_at(r, "pointer.complete", false)) result.failures.push_back("a repeat read must answer a pointer that says complete: false: " + json::dump(*value_at(r, "pointer")).substr(0, 200));
                if (!has(text_of(r, "pointer.output"), "<<<gm-pointer")) result.failures.push_back("the repeat read must answer the pointer marker");
                if (!bool_at(r, "refusedPointer.ok", false) || !has(text_of(r, "refusedPointer.error"), "fresh: true"))
                    result.failures.push_back("a write of a pointer reply must be refused and name fresh: true: " + json::dump(*value_at(r, "refusedPointer")).substr(0, 300));
                if (!bool_at(r, "refusedEdit.ok", false) || !has(text_of(r, "refusedEdit.error"), "outputPath"))
                    result.failures.push_back("an edit whose new text carries the cut marker must be refused: " + json::dump(*value_at(r, "refusedEdit")).substr(0, 300));
            }
        }
        session.stop();
    }
    std::error_code ignored;
    fs::remove_all(sandbox, ignored);
    const double wall = std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count();
    result.summary = "a bounded read says truncated and complete false with an outputPath and a <<<gm-cut marker; a write or edit carrying the cut is refused naming outputPath and full: true, and nothing reaches disk; a repeat read answers a <<<gm-pointer that is refused as file text and names fresh: true; a full read writes (wall " +
                     std::to_string(wall) + " s)";
    return result;
}

}
