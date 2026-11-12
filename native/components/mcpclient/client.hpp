#pragma once

#include <cstddef>
#include <cstdint>
#include <memory>
#include <mutex>
#include <optional>
#include <shared_mutex>
#include <string>
#include <vector>

#include "config.hpp"
#include "gm/json.hpp"

namespace gm::mcpclient {

struct Core;

class StdioClient {
public:
    StdioClient(ServerSpec spec, std::size_t depth, Emit emit);
    ~StdioClient();
    StdioClient(const StdioClient&) = delete;
    StdioClient& operator=(const StdioClient&) = delete;

    std::optional<std::string> connect(bool again);
    const ServerSpec& spec() const;
    const std::vector<json::Value>& tools() const { return tools_; }
    json::Value call_tool(const std::string& tool, const json::Value& args);
    void preload_tools(std::vector<json::Value> tools);
    bool preloaded() const { return preloaded_; }
    void stop();
    bool release(const std::string& reason);

private:
    std::shared_ptr<Core> core_;
    std::mutex start_mutex_;
    std::shared_mutex use_;
    std::vector<json::Value> tools_;
    bool preloaded_ = false;
};

}
