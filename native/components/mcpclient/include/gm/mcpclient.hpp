#pragma once

#include <chrono>
#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <functional>
#include <memory>
#include <optional>
#include <set>
#include <string>
#include <string_view>
#include <vector>

#include "gm/json.hpp"
#include "gm/verbs.hpp"

namespace gm::mcpclient {

struct ConfigFile {
    std::filesystem::path path;
    bool required = false;
};

using Emit = std::function<void(std::string_view kind, json::Value fields)>;

struct Options {
    std::filesystem::path workspace;
    std::vector<ConfigFile> config_files;
    std::set<std::string, std::less<>> reserved;
    std::size_t depth = 0;
    std::filesystem::path tool_cache;
    Emit emit;
};

std::size_t depth_from_environment();

class McpVerbs final : public VerbTable {
public:
    explicit McpVerbs(Options options);
    ~McpVerbs() override;

    McpVerbs(const McpVerbs&) = delete;
    McpVerbs& operator=(const McpVerbs&) = delete;

    std::vector<VerbInfo> list() const override;
    json::Value call(std::string_view name, const json::Value& args) override;
    json::Value call_sibling(std::string_view sibling, std::string_view tool, const json::Value& args) override;
    void wait_for(std::string_view name) const;
    void wait_ready() const;
    void wait_ready_for(std::chrono::milliseconds budget) const;
    void release_leases(const std::string& reason, bool run_end);
    bool serves(std::string_view name) const;

private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
};

}
