#pragma once

#include <filesystem>
#include <map>
#include <memory>
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
    std::filesystem::path workspace_;
    std::map<std::filesystem::path, std::unique_ptr<search::Searcher>> searchers_;
};

}
