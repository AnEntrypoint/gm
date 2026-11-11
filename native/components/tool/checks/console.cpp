#include "gm/tool.hpp"

#include <chrono>
#include <cstddef>
#include <filesystem>
#include <fstream>
#include <optional>
#include <stdexcept>
#include <system_error>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

constexpr std::size_t kLines = 200;
constexpr double kBytes = 8192;
constexpr std::size_t kLineBytes = 512;
constexpr std::size_t kCutBytes = 510;
constexpr double kCounted = 301;

const std::string kFlood =
    "for (let i = 0; i < 300; i += 1) console.log('line ' + String(i).padStart(3, '0') + ' ' + 'x'.repeat(100)); console.error('an error line'); return 1;";
const std::string kFormat = "console.log({ a: 1 }, 'x', 2, true); console.warn('\\u20ac'.repeat(200)); return 1;";
const std::string kQuery = "return await gm.query_log({ kind: 'body-console' });";
const std::string kEuro = "\xE2\x82\xAC";

json::Value run(Session& session, const std::string& body) {
    json::Value reply = tool_json(session, "run_code", json::Object{{"body", body}});
    const json::Value* ok = reply.find("ok");
    if (ok == nullptr || !ok->is_bool() || !ok->as_bool()) {
        const std::string error = text_at(reply, "error");
        throw std::runtime_error("run_code refused: " + (error.empty() ? json::dump(reply).substr(0, 200) : error));
    }
    return reply;
}

bool returned_one(const json::Value& reply) {
    const json::Value* output = reply.find("output");
    if (output == nullptr) return false;
    if (output->is_string()) return output->as_string() == "1";
    return output->is_number() && output->as_number() == 1;
}

std::string shown(const json::Value& reply) {
    const json::Value* output = reply.find("output");
    if (output == nullptr) return "undefined";
    return output->is_string() ? output->as_string() : json::dump(*output);
}

json::Value events_of(const json::Value& reply) {
    const json::Value outer = output_value(reply);
    const json::Value* inner = outer.find("output");
    if (inner == nullptr) throw std::runtime_error("query_log returned no output field: " + json::dump(outer).substr(0, 200));
    if (inner->is_string()) {
        auto parsed = json::parse(inner->as_string());
        if (!parsed) throw std::runtime_error("query_log output was not JSON: " + inner->as_string().substr(0, 200));
        return *parsed;
    }
    return *inner;
}

double number_at(const json::Value& value, const std::string& key) {
    const json::Value* found = value.find(key);
    return found != nullptr && found->is_number() ? found->as_number() : 0;
}

json::Array lines_of(const json::Value& event) {
    const json::Value* found = event.find("lines");
    return found != nullptr && found->is_array() ? found->as_array() : json::Array{};
}

std::optional<std::string> line_at(const json::Array& lines, std::size_t index) {
    if (index >= lines.size() || !lines[index].is_string()) return std::nullopt;
    return lines[index].as_string();
}

std::string count(double value) {
    return std::to_string(static_cast<long long>(value));
}

bool whole_euros(const std::string& text) {
    if (text.empty() || text.size() % kEuro.size() != 0) return false;
    for (std::size_t at = 0; at < text.size(); at += kEuro.size())
        if (text.compare(at, kEuro.size(), kEuro) != 0) return false;
    return true;
}

}

CheckResult check_console(const std::string& binary) {
    CheckResult result;
    const std::string label = "native";
    const auto started = std::chrono::steady_clock::now();
    const auto stamp = started.time_since_epoch().count();
    const fs::path sandbox = fs::temp_directory_path() / ("gm-console-check-" + std::to_string(stamp));
    const fs::path workspace = sandbox / "ws";
    fs::create_directories(workspace);
    std::ofstream(sandbox / "quiet.json") << R"({"mcpServers":{"playwriter":{"disabled":true}}})";
    std::ofstream(workspace / "a.txt") << "probe\n";
    std::string flood_fact = "no flood event";
    std::string format_fact = "no format event";
    {
        Session session(binary, workspace, sandbox, 180000, true);
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + binary);
        } else {
            try {
                session.rpc("initialize", json::Object{{"protocolVersion", "2025-06-18"}, {"capabilities", json::Object{}},
                                                      {"clientInfo", json::Object{{"name", "console-check"}, {"version", "1"}}}});
                session.notify("notifications/initialized", json::Object{});
                session.rpc("resources/read", json::Object{{"uri", "skill://gm/SKILL.md"}});
                tool_json(session, "next_context", json::Object{{"task", "console check"}});
                const json::Value flood = run(session, kFlood);
                if (!returned_one(flood)) result.failures.push_back(label + ": a body that logs returned " + shown(flood) + ", not 1");
                const json::Value format = run(session, kFormat);
                if (!returned_one(format)) result.failures.push_back(label + ": a body with objects and a long line returned " + shown(format) + ", not 1");
                const json::Value events = events_of(run(session, kQuery));
                const json::Array list = events.is_array() ? events.as_array() : json::Array{};
                if (list.size() != 2) result.failures.push_back(label + ": " + std::to_string(list.size()) + " body-console events, expected one per logging body");
                if (!list.empty()) {
                    const json::Value first = list[0];
                    const json::Array lines = lines_of(first);
                    const double dropped = number_at(first, "dropped");
                    const double bytes = number_at(first, "bytes");
                    const double total = static_cast<double>(lines.size()) + dropped;
                    if (lines.size() > kLines) result.failures.push_back(label + ": " + std::to_string(lines.size()) + " lines kept, over the " + std::to_string(kLines) + " cap");
                    if (bytes > kBytes) result.failures.push_back(label + ": " + count(bytes) + " bytes kept, over the " + count(kBytes) + " cap");
                    if (dropped <= 0) result.failures.push_back(label + ": no dropped count for a body over the cap");
                    if (total != kCounted) result.failures.push_back(label + ": " + count(total) + " lines counted, expected 301 (300 logs and one error)");
                    if (line_at(lines, 0) != "line 000 " + std::string(100, 'x')) result.failures.push_back(label + ": the first kept line is not the first log");
                    flood_fact = "flood kept " + std::to_string(lines.size()) + " lines, " + count(bytes) + " bytes, dropped " + count(dropped);
                }
                if (list.size() > 1) {
                    const json::Value second = list[1];
                    const json::Array lines = lines_of(second);
                    const std::optional<std::string> first_line = line_at(lines, 0);
                    if (first_line != "{\"a\":1} x 2 true")
                        result.failures.push_back(label + ": objects and primitives format as " + (first_line ? json::quote(*first_line) : std::string("undefined")));
                    const std::string euro = line_at(lines, 1).value_or("");
                    if (euro.size() > kLineBytes) result.failures.push_back(label + ": a long line is " + std::to_string(euro.size()) + " bytes, over the " + std::to_string(kLineBytes) + " cap");
                    if (euro.size() != kCutBytes)
                        result.failures.push_back(label + ": a 600-byte line of three-byte characters is " + std::to_string(euro.size()) + " bytes, expected 510 on a character boundary");
                    if (!whole_euros(euro)) result.failures.push_back(label + ": the cut long line is not whole euro signs");
                    format_fact = "format kept " + std::to_string(lines.size()) + " lines, first " + json::quote(first_line.value_or("")) + ", cut line " + std::to_string(euro.size()) + " bytes";
                }
            } catch (const std::exception& error) {
                result.failures.push_back(label + ": " + error.what());
            }
            const std::vector<std::string> strays = session.stray_lines();
            for (const std::string& line : strays) result.failures.push_back(label + ": a non-JSON line on stdout: " + line.substr(0, 120));
        }
        session.stop();
    }
    std::error_code ignored;
    fs::remove_all(sandbox, ignored);
    const double wall = std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count();
    result.summary = "a body with 300 logs keeps 200 lines or 8 KiB with a dropped count, formats objects, cuts a long line on a character boundary, keeps the reply and stdout intact (" + flood_fact +
                     "; " + format_fact + "; wall " + std::to_string(wall) + " s)";
    return result;
}

}
