#pragma once

#include <cstdint>
#include <filesystem>
#include <memory>
#include <string_view>
#include <vector>

#include "gmnew/host.hpp"
#include "gmnew/verbs.hpp"

namespace gmnew {

class LeafVerbs final : public VerbTable {
public:
    LeafVerbs(std::filesystem::path leaves_dir, const HostServices& host);
    ~LeafVerbs() override;
    LeafVerbs(const LeafVerbs&) = delete;
    LeafVerbs& operator=(const LeafVerbs&) = delete;

    std::vector<VerbInfo> list() const override;
    json::Value call(std::string_view name, const json::Value& args) override;
    std::uint64_t generation() const;
    void set_run_dir(std::filesystem::path run_dir);

private:
    struct State;
    std::unique_ptr<State> state_;
};

}
