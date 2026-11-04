#pragma once

#include <cstddef>
#include <filesystem>
#include <memory>
#include <set>
#include <string>
#include <vector>

#include "gmnew/verbs.hpp"

namespace gmnew::playwriter {

struct ConfigFile {
    std::filesystem::path path;
    bool required = false;
};

struct Options {
    std::filesystem::path workspace;
    std::vector<ConfigFile> config_files;
    std::set<std::string, std::less<>> reserved;
    std::size_t depth = 0;
};

std::size_t depth_from_environment();

class PlaywriterVerbs final : public VerbTable {
public:
    explicit PlaywriterVerbs(Options options);
    ~PlaywriterVerbs() override;

    PlaywriterVerbs(const PlaywriterVerbs&) = delete;
    PlaywriterVerbs& operator=(const PlaywriterVerbs&) = delete;

    std::vector<VerbInfo> list() const override;
    json::Value call(std::string_view name, const json::Value& args) override;

private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
};

}
