#pragma once

#include <cstddef>
#include <cstdint>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

#include "config.hpp"
#include "deoxidene/result.hpp"
#include "gmnew/json.hpp"
#include "gmnew/proc.hpp"

namespace gmnew::playwriter {

struct Session;

class StdioClient {
public:
    StdioClient(ServerSpec spec, std::size_t depth);
    ~StdioClient();
    StdioClient(const StdioClient&) = delete;
    StdioClient& operator=(const StdioClient&) = delete;

    std::optional<std::string> ensure_running();
    const std::vector<json::Value>& tools() const { return tools_; }
    json::Value call_tool(const std::string& tool, const json::Value& args);
    void stop();

private:
    struct Snapshot {
        std::shared_ptr<proc::Child> child;
        std::shared_ptr<Session> session;
    };

    Snapshot snapshot() const;
    bool running() const;
    std::optional<std::string> start();
    std::optional<std::string> handshake();
    std::optional<std::string> list_tools();
    deoxidene::Result<json::Value, std::string> request(const std::string& method, const json::Value& params,
                                                        std::uint64_t timeout_ms);
    void notify(const std::string& method, const json::Value& params);
    void kill_current();

    ServerSpec spec_;
    std::size_t depth_;
    mutable std::mutex mutex_;
    std::mutex start_mutex_;
    std::shared_ptr<proc::Child> child_;
    std::shared_ptr<Session> session_;
    std::vector<json::Value> tools_;
};

}
