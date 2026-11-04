#pragma once

#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <string>

#include "cxxmcp/client/client.hpp"
#include "gmnew/proc.hpp"

namespace gmnew::mcpclient {

class CallBudget {
public:
    explicit CallBudget(std::chrono::milliseconds limit);
    ~CallBudget();
    CallBudget(const CallBudget&) = delete;
    CallBudget& operator=(const CallBudget&) = delete;

private:
    std::optional<std::chrono::milliseconds> previous_;
};

class ChildTransport final : public mcp::client::Transport {
public:
    ChildTransport(std::string server, std::shared_ptr<proc::Child> child);

    mcp::core::Result<mcp::protocol::JsonRpcResponse> send(const mcp::protocol::JsonRpcRequest& request) override;
    mcp::core::Result<mcp::core::Unit> send_notification(const mcp::protocol::JsonRpcNotification& notification) override;
    mcp::core::Result<mcp::core::Unit> start(mcp::client::TransportRequestHandler request_handler,
                                             mcp::client::TransportNotificationHandler notification_handler) override;
    void stop() noexcept override;

    void dispatch(const std::string& line);
    void abort(const std::string& reason);
    bool alive() const;

private:
    bool write(const std::string& line);
    mcp::core::Error not_running() const;
    void forget(std::int64_t id);
    void cancel(std::int64_t id, std::chrono::milliseconds limit);

    std::string server_;
    std::shared_ptr<proc::Child> child_;
    std::mutex write_mutex_;
    mutable std::mutex mutex_;
    std::condition_variable changed_;
    bool alive_ = true;
    std::string lost_;
    std::int64_t last_id_ = 0;
    std::map<std::int64_t, std::optional<mcp::protocol::JsonRpcResponse>> pending_;
    mcp::client::TransportRequestHandler request_handler_;
    mcp::client::TransportNotificationHandler notification_handler_;
};

}
