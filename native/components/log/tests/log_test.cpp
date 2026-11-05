#include <cstdio>
#include <filesystem>
#include <set>
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
    std::filesystem::remove_all(dir);
    if (failures == 0) std::puts("log_test ok");
    return failures == 0 ? 0 : 1;
}
