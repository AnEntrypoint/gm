#pragma once

#include <cstdint>
#include <filesystem>
#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "gm/json.hpp"
#include "gm/log.hpp"
#include "gm/verbs.hpp"

namespace gm {

struct CoreVerbsOptions {
    std::filesystem::path workspace;
    std::uint64_t job_lifetime_ms = 1800000;
    std::uint64_t job_stuck_ms = 180000;
    std::function<std::optional<std::string>(const std::string& uri)> serve_skill;
    std::function<void(const RunLog& log, std::string_view kind, std::uint64_t seq)> on_append;
};

class CoreVerbs : public VerbTable {
public:
    CoreVerbs(CoreVerbsOptions options, RunLog& log);
    explicit CoreVerbs(CoreVerbsOptions options);
    ~CoreVerbs() override;

    CoreVerbs(const CoreVerbs&) = delete;
    CoreVerbs& operator=(const CoreVerbs&) = delete;

    std::vector<VerbInfo> list() const override;
    json::Value call(std::string_view name, const json::Value& args) override;

    void close(std::string_view reason = "run-ended");
    void bind_run(std::shared_ptr<RunLog> log);
    json::Value job_snapshot();
    void flush_job_events();

private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
};

}
