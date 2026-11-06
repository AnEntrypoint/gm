#pragma once

#include <cstdint>
#include <filesystem>
#include <map>
#include <memory>
#include <mutex>
#include <string_view>
#include <vector>

#include "gm/verbs.hpp"

namespace gm::search {
class Searcher;
}

namespace gm {

class SearchVerbs : public VerbTable {
public:
    explicit SearchVerbs(std::filesystem::path workspace);
    ~SearchVerbs() override;

    std::vector<VerbInfo> list() const override;
    json::Value call(std::string_view name, const json::Value& args) override;

private:
    struct Root {
        std::mutex scan;
        std::unique_ptr<search::Searcher> searcher;
        std::uint64_t used = 0;
    };

    std::mutex mutex_;
    std::uint64_t clock_ = 0;
    std::filesystem::path workspace_;
    std::map<std::filesystem::path, std::shared_ptr<Root>> searchers_;

    void evict_least_used();
};

}
