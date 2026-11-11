#include "gm/tool.hpp"

#include <chrono>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <system_error>
#include <thread>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

constexpr const char* kUri = "skill://gm-continue/SKILL.md";
constexpr const char* kUpdated = "notifications/resources/updated";

std::string read_text(const fs::path& file) {
    std::ifstream in(file, std::ios::binary);
    std::ostringstream text;
    text << in.rdbuf();
    return text.str();
}

std::size_t updates_for(const std::vector<json::Value>& notes, const std::string& uri) {
    std::size_t count = 0;
    for (const json::Value& note : notes) {
        if (text_at(note, "method") == kUpdated && text_at(note, "params.uri") == uri) ++count;
    }
    return count;
}

bool is_empty_object(const json::Value* value) {
    return value != nullptr && value->is_object() && value->as_object().empty();
}

}

CheckResult check_resources_subscribe(const std::string& binary) {
    CheckResult result;
    const auto started = std::chrono::steady_clock::now();
    const auto stamp = started.time_since_epoch().count();
    const fs::path sandbox = fs::temp_directory_path() / ("gm-resources-subscribe-" + std::to_string(stamp));
    const fs::path workspace = sandbox / "workspace";
    const fs::path skills = sandbox / "skills";
    fs::create_directories(workspace);
    fs::create_directories(sandbox);
    fs::path repo;
    for (fs::path dir = fs::current_path();; dir = dir.parent_path()) {
        std::error_code exists_ec;
        if (fs::exists(dir / "skills" / "gm" / "SKILL.md", exists_ec)) {
            repo = dir;
            break;
        }
        if (dir == dir.parent_path()) break;
    }
    if (repo.empty()) {
        result.failures.push_back("run from the checkout: no skills/gm/SKILL.md in the working directory or its parents");
        return result;
    }
    fs::copy(repo / "skills", skills, fs::copy_options::recursive);
    const fs::path served = skills / "gm-continue" / "SKILL.md";
    std::string original;
    int edits = 0;
    long long arrived_ms = -1;
    {
        Session session(binary, workspace, sandbox, 180000, true, {"--skills", skills.string()});
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + binary);
        } else {
            original = read_text(served);
            const json::Value init = session.rpc("initialize", json::Object{{"protocolVersion", "2025-11-25"}, {"capabilities", json::Object{}},
                                                                            {"clientInfo", json::Object{{"name", "gm-resources-subscribe-check"}, {"version", "1"}}}});
            const json::Value* subscribe = value_at(init, "result.capabilities.resources.subscribe");
            if (subscribe == nullptr || !subscribe->is_bool() || !subscribe->as_bool()) result.failures.push_back("initialize: resources.subscribe is not advertised");
            session.notify("notifications/initialized", json::Object{});

            const json::Value sub = session.rpc("resources/subscribe", json::Object{{"uri", kUri}});
            if (value_at(sub, "error") != nullptr || !is_empty_object(value_at(sub, "result"))) result.failures.push_back("resources/subscribe " + std::string(kUri) + ": expected an ok {} result, got " + json::dump(sub).substr(0, 240));

            auto change = [&] {
                ++edits;
                std::ofstream(served, std::ios::binary | std::ios::trunc) << original << "\nresources-subscribe-check edit " << edits << "\n";
            };
            change();
            const auto change_at = std::chrono::steady_clock::now();
            bool arrived = false;
            while (std::chrono::steady_clock::now() - change_at < std::chrono::seconds(5)) {
                if (updates_for(session.notes(), kUri) > 0) {
                    arrived = true;
                    break;
                }
                std::this_thread::sleep_for(std::chrono::milliseconds(50));
            }
            arrived_ms = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - change_at).count();
            if (!arrived) {
                result.failures.push_back("a change to " + std::string(kUri) + " on disk sent no notifications/resources/updated within 5000 ms");
            } else {
                json::Value params;
                for (const json::Value& note : session.notes()) {
                    if (text_at(note, "method") == kUpdated && text_at(note, "params.uri") == kUri) {
                        if (const json::Value* found = value_at(note, "params")) params = *found;
                        break;
                    }
                }
                if (!params.is_object() || params.as_object().size() != 1 || text_at(params, "uri") != kUri)
                    result.failures.push_back("the update notification params are " + json::dump(params).substr(0, 240) + ", expected {\"uri\":\"" + kUri + "\"}");
            }

            const json::Value unsub = session.rpc("resources/unsubscribe", json::Object{{"uri", kUri}});
            if (value_at(unsub, "error") != nullptr || !is_empty_object(value_at(unsub, "result")))
                result.failures.push_back("resources/unsubscribe " + std::string(kUri) + ": expected an ok {} result, got " + json::dump(unsub).substr(0, 240));
            const std::size_t seen = updates_for(session.notes(), kUri);
            change();
            std::this_thread::sleep_for(std::chrono::milliseconds(1500));
            if (updates_for(session.notes(), kUri) != seen) result.failures.push_back("after resources/unsubscribe a change to " + std::string(kUri) + " still sent notifications/resources/updated");

            const json::Value bad = session.rpc("resources/subscribe", json::Object{{"uri", "skill://nope/SKILL.md"}});
            const bool code_ok = value_at(bad, "error.code") != nullptr && value_at(bad, "error.code")->is_number() && value_at(bad, "error.code")->as_number() == -32002;
            if (!code_ok || text_at(bad, "error.message") != "resource not found: skill://nope/SKILL.md" || text_at(bad, "error.data.uri") != "skill://nope/SKILL.md")
                result.failures.push_back("resources/subscribe to an unknown uri: expected -32002 resource not found, got " + json::dump(bad).substr(0, 240));
        }
        session.stop();
    }
    std::error_code ignored;
    fs::remove_all(sandbox, ignored);
    const double wall = std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count();
    result.summary = "initialize advertises resources.subscribe; resources/subscribe to " + std::string(kUri) + " answers {}; a change on disk sent notifications/resources/updated with params {\"uri\":\"" + kUri + "\"} in " +
                     std::to_string(arrived_ms) + " ms; resources/unsubscribe answers {} and stops the updates; an unknown uri answers -32002 (wall " + std::to_string(wall) + " s)";
    return result;
}

}
