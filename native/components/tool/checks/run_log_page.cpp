#include "gm/tool.hpp"
#include "support.hpp"

#include <sstream>
#include <system_error>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

constexpr const char* kLogMeta = "com.anentrypoint.gmnew/log";
constexpr const char* kRunMeta = "com.anentrypoint.gmnew/run";
constexpr std::size_t kPageEvents = 50;
constexpr std::size_t kPageBytes = 16384;
constexpr std::size_t kFillerEvents = 100;

const json::Value* first_item(const json::Value* list) {
    return list != nullptr && list->is_array() && !list->as_array().empty() ? &list->as_array().front() : nullptr;
}

}

CheckResult check_run_log_page(const std::string& binary) {
    CheckResult result;
    const fs::path sandbox = support::fresh_sandbox("run-log-page");
    std::size_t pages = 0;
    std::size_t collected = 0;
    bool contiguous = true;
    bool ended_with_null = false;
    bool pages_within_bounds = true;
    std::string stray;
    bool started = false;
    {
        Session session(binary, sandbox / "ws", sandbox, 300000, true);
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + binary);
        } else {
            started = true;
            support::start_session(session, "check-run-log-page");
            const json::Value next = session.rpc("tools/call", json::Object{{"name", "next_context"}, {"arguments", json::Object{}}});
            const json::Value* meta = value_at(next, "result._meta");
            const json::Value* run = meta != nullptr ? meta->find(kRunMeta) : nullptr;
            const std::string run_id = run != nullptr && run->is_string() ? run->as_string() : std::string();
            const std::string filler = "for (let i = 0; i < 60; i += 1) await gm.read_file({ path: 'skill://gm/SKILL.md' }); return 'filled';";
            tool_json(session, "run_code", json::Object{{"body", filler}});
            std::string uri = "run://" + run_id + "/log?after=0&limit=50";
            std::uint64_t expect_seq = 1;
            for (int page = 0; page < 200 && !uri.empty(); ++page) {
                const json::Value read = session.rpc("resources/read", json::Object{{"uri", uri}});
                const json::Value* item = first_item(value_at(read, "result.contents"));
                const json::Value* text = item != nullptr ? value_at(*item, "text") : nullptr;
                const json::Value* page_meta = item != nullptr ? item->find("_meta") : nullptr;
                const json::Value* log_meta = page_meta != nullptr ? page_meta->find(kLogMeta) : nullptr;
                const json::Value* next_uri = log_meta != nullptr ? log_meta->find("next") : nullptr;
                if (text == nullptr || !text->is_string()) {
                    stray = "a log page had no text: " + json::dump(read).substr(0, 240);
                    break;
                }
                std::size_t lines_here = 0;
                std::istringstream lines(text->as_string());
                for (std::string line; std::getline(lines, line);) {
                    auto event = json::parse(line);
                    const json::Value* seq_value = event ? value_at(*event, "seq") : nullptr;
                    const auto seq = seq_value != nullptr && seq_value->is_number() ? static_cast<std::uint64_t>(seq_value->as_number()) : std::uint64_t{0};
                    if (seq != expect_seq) contiguous = false;
                    expect_seq += 1;
                    lines_here += 1;
                    collected += 1;
                }
                if (lines_here > kPageEvents || (lines_here > 1 && text->as_string().size() > kPageBytes)) pages_within_bounds = false;
                pages += 1;
                if (next_uri == nullptr || next_uri->is_null()) {
                    ended_with_null = true;
                    uri.clear();
                } else if (next_uri->is_string()) {
                    uri = next_uri->as_string();
                } else {
                    stray = "a log page carried a next that is not a uri: " + json::dump(read).substr(0, 240);
                    uri.clear();
                }
            }
        }
    }
    std::error_code ec;
    fs::remove_all(sandbox, ec);
    if (!started) return result;
    if (!stray.empty()) result.failures.push_back(stray);
    if (collected < kFillerEvents) result.failures.push_back("the pages held " + std::to_string(collected) + " events, expected at least " + std::to_string(kFillerEvents));
    if (!pages_within_bounds) result.failures.push_back("a log page exceeded " + std::to_string(kPageEvents) + " events or " + std::to_string(kPageBytes) + " bytes");
    if (!contiguous) result.failures.push_back("the pages do not hold contiguous seq numbers from 1");
    if (!ended_with_null) result.failures.push_back("paging did not end with _meta.next null");
    result.summary = "the run log pages " + std::to_string(collected) + " events in " + std::to_string(pages) + " pages of at most " + std::to_string(kPageEvents) + " events or " + std::to_string(kPageBytes) + " bytes, contiguous from seq 1";
    return result;
}

}
