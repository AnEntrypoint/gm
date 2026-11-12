#pragma once

#include <map>
#include <memory>
#include <optional>
#include <shared_mutex>
#include <string>
#include <string_view>
#include <vector>

#include "deoxidene/result.hpp"
#include "gm/verbs.hpp"

namespace gm::host {

class ComposedVerbs final : public VerbTable {
public:
    static deoxidene::Result<std::unique_ptr<ComposedVerbs>, std::string> compose(std::vector<VerbTable*> tables);

    std::vector<VerbInfo> list() const override;
    json::Value call(std::string_view name, const json::Value& args) override;
    json::Value call_sibling(std::string_view sibling, std::string_view tool, const json::Value& args) override;

private:
    explicit ComposedVerbs(std::vector<VerbTable*> tables);
    VerbTable* route(std::string_view name) const;
    void reindex() const;

    std::vector<VerbTable*> tables_;
    mutable std::shared_mutex index_mutex_;
    mutable std::map<std::string, VerbTable*, std::less<>> index_;
};

std::optional<json::Value> refuse_unknown_keys(const VerbTable& verbs, std::string_view name, const json::Value& args);

}
