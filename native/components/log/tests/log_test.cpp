#include <algorithm>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <set>
#include <string>
#include <thread>
#include <vector>

#include "gm/log.hpp"

using namespace gm;

static int failures = 0;

#define CHECK(cond)                                                      \
    do {                                                                 \
        if (!(cond)) {                                                   \
            std::fprintf(stderr, "FAIL line %d: %s\n", __LINE__, #cond); \
            ++failures;                                                  \
        }                                                                \
    } while (0)

static std::uint64_t seq_of(const json::Value& event) {
    const json::Value* s = event.find("seq");
    return s != nullptr && s->is_number() ? static_cast<std::uint64_t>(s->as_number()) : 0;
}

static bool same_window(const LogWindow& got, const std::vector<json::Value>& all, std::uint64_t after, std::size_t max_events, std::size_t max_bytes, const LogMatch& match) {
    std::vector<json::Value> events;
    std::uint64_t scanned_last = after;
    std::size_t bytes_read = 0;
    for (const json::Value& event : all) {
        std::uint64_t seq = seq_of(event);
        if (seq <= after) continue;
        if (events.size() >= max_events) break;
        if (bytes_read >= max_bytes && scanned_last != after) break;
        bytes_read += json::dump(event).size() + 1;
        scanned_last = seq;
        if (!match || match(event)) events.push_back(event);
    }
    std::uint64_t expected_count = all.empty() ? 0 : seq_of(all.back());
    if (got.count != expected_count || got.scanned_last != scanned_last || got.bytes_read != bytes_read || got.events.size() != events.size()) return false;
    for (std::size_t i = 0; i < events.size(); ++i) {
        if (json::dump(got.events[i]) != json::dump(events[i])) return false;
    }
    return true;
}

static bool same_last(const std::vector<json::Value>& got, const std::vector<json::Value>& all, std::size_t n, std::uint64_t after, const LogMatch& match) {
    std::vector<json::Value> events;
    for (auto it = all.rbegin(); it != all.rend() && events.size() < n; ++it) {
        if (seq_of(*it) <= after) break;
        if (!match || match(*it)) events.push_back(*it);
    }
    std::reverse(events.begin(), events.end());
    if (got.size() != events.size()) return false;
    for (std::size_t i = 0; i < events.size(); ++i) {
        if (json::dump(got[i]) != json::dump(events[i])) return false;
    }
    return true;
}

int main() {
    auto dir = std::filesystem::temp_directory_path() / "gm_log_test_run";
    std::filesystem::remove_all(dir);
    double last_mono = 0;
    {
        auto log = RunLog::open(dir);
        CHECK(log.has_value());
        json::Value f;
        f.set("tool", "run_code").set("startMono", 0.0);
        CHECK(log->append("call", f) == 1);
        CHECK(log->append("result", json::Value(json::Object{})) == 2);
        auto all = log->read_all();
        CHECK(all && all->size() == 2);
        CHECK((*all)[0].find("seq")->as_number() == 1);
        CHECK((*all)[0].find("kind")->as_string() == "call");
        CHECK((*all)[0].find("tool")->as_string() == "run_code");
        CHECK((*all)[0].find("durMs") != nullptr);
        CHECK((*all)[0].find("t")->as_string().size() == 24);
        CHECK((*all)[1].find("durMs") == nullptr);
        last_mono = (*all)[1].find("mono")->as_number();
    }
    CHECK(std::filesystem::file_size(dir / "log.index") == 32);
    {
        auto log = RunLog::open(dir);
        CHECK(log.has_value());
        CHECK(log->append("again", json::Value("not an object")) == 3);
        auto all = log->read_all();
        CHECK(all && all->size() == 3);
        CHECK((*all)[2].find("mono")->as_number() >= last_mono);
        CHECK((*all)[2].find("kind")->as_string() == "again");
    }
    std::filesystem::remove(dir / "log.index");
    {
        auto log = RunLog::open(dir);
        CHECK(log && log->append("x", json::Value()) == 4);
    }
    CHECK(std::filesystem::file_size(dir / "log.index") == 64);
    {
        auto log = RunLog::open(dir);
        CHECK(log.has_value());
        double before = log->now_ms();
        std::vector<std::thread> threads;
        std::vector<std::vector<std::uint64_t>> got(4);
        for (int t = 0; t < 4; ++t) {
            threads.emplace_back([&, t] {
                for (int i = 0; i < 100; ++i) got[t].push_back(log->append("thread", json::Value(json::Object{})));
            });
        }
        for (auto& th : threads) th.join();
        std::set<std::uint64_t> seqs;
        for (auto& g : got) seqs.insert(g.begin(), g.end());
        CHECK(seqs.size() == 400);
        auto all = log->read_all();
        CHECK(all && all->size() == 404);
        CHECK(log->now_ms() >= before);
        CHECK(log->count() == 404);
        auto tail = log->read_from(400);
        CHECK(tail && tail->size() == 4 && (*tail)[0].find("seq")->as_number() == 401);
        auto none = log->read_from(404);
        CHECK(none && none->empty());
        auto everything = log->read_from(0);
        CHECK(everything && everything->size() == 404);
        auto mid = log->read_from(2);
        CHECK(mid && mid->size() == 402 && (*mid)[0].find("seq")->as_number() == 3);
        CHECK(std::filesystem::file_size(dir / "log.index") == 404 * 16);
    }
    {
        auto long_dir = std::filesystem::temp_directory_path() / "gm_log_long_run";
        std::filesystem::remove_all(long_dir);
        auto long_log = RunLog::open(long_dir);
        CHECK(long_log.has_value());
        if (long_log) {
            constexpr std::uint64_t total = 2205;
            constexpr std::size_t window_bytes = 4 * 1024 * 1024;
            constexpr std::size_t unlimited_bytes = 1u << 30;
            for (std::uint64_t i = 1; i <= total; ++i) {
                json::Value fields;
                fields.set("pad", std::string(4096, 'x')).set("even", i % 2 == 0);
                long_log->append(i % 2 == 0 ? "even" : "odd", fields);
            }
            auto all = long_log->read_all();
            CHECK(all && all->size() == total);
            auto first = long_log->read_window(0, 1000, unlimited_bytes);
            CHECK(first && first->events.size() == 1000 && first->scanned_last == 1000);
            CHECK(first && all && same_window(*first, *all, 0, 1000, unlimited_bytes, {}));
            auto byte_bound = long_log->read_window(0, 10000, window_bytes);
            CHECK(byte_bound && byte_bound->events.size() < total && byte_bound->bytes_read >= window_bytes);
            CHECK(byte_bound && all && same_window(*byte_bound, *all, 0, 10000, window_bytes, {}));
            LogMatch even = [](const json::Value& event) {
                const json::Value* kind = event.find("kind");
                return kind != nullptr && kind->is_string() && kind->as_string() == "even";
            };
            auto filtered = long_log->read_window(0, 1000, unlimited_bytes, even);
            CHECK(filtered && filtered->events.size() == 1000 && filtered->scanned_last < total);
            CHECK(filtered && all && same_window(*filtered, *all, 0, 1000, unlimited_bytes, even));
            std::uint64_t filtered_last = filtered ? filtered->scanned_last : 0;
            auto paged = long_log->read_window(filtered_last, 1000, unlimited_bytes, even);
            CHECK(paged && paged->events.size() == static_cast<std::size_t>(total / 2 - 1000));
            CHECK(paged && all && same_window(*paged, *all, filtered_last, 1000, unlimited_bytes, even));
            auto newest = long_log->read_last(50, 1000, even);
            CHECK(newest && newest->size() == 50);
            CHECK(newest && all && same_last(*newest, *all, 50, 1000, even));
            auto one = long_log->read_last(1);
            CHECK(one && one->size() == 1 && seq_of(one->back()) == total);
            {
                std::ofstream out(long_dir / "log.jsonl", std::ios::binary | std::ios::app);
                out << "{\"seq\":9999,\"kind\":\"partial\"";
            }
            CHECK(!long_log->read_all());
            CHECK(!long_log->read_window(0, 1000, window_bytes));
            CHECK(!long_log->read_last(1));
        }
        std::filesystem::remove_all(long_dir);
    }
    std::filesystem::remove_all(dir);
    if (failures == 0) std::puts("log_test ok");
    return failures == 0 ? 0 : 1;
}
