#include "transport.hpp"

#include <string>
#include <utility>

namespace gm::mcpclient {

namespace {

constexpr int INTERNAL_ERROR = -32603;

thread_local std::optional<std::chrono::milliseconds> budget_on_thread;

std::string limit_text(std::chrono::milliseconds limit) { return std::to_string(limit.count()) + " ms"; }

}

CallBudget::CallBudget(std::chrono::milliseconds limit) : previous_(budget_on_thread) { budget_on_thread = limit; }

CallBudget::~CallBudget() { budget_on_thread = previous_; }

ChildTransport::ChildTransport(std::string server, std::shared_ptr<proc::Child> child) : server_(std::move(server)), child_(std::move(child)) {}

mcp::core::Result<mcp::core::Unit> ChildTransport::start(mcp::client::TransportRequestHandler request_handler,
                                                         mcp::client::TransportNotificationHandler notification_handler) {
    std::lock_guard lock(mutex_);
    request_handler_ = std::move(request_handler);
    notification_handler_ = std::move(notification_handler);
    return mcp::core::Unit{};
}

void ChildTransport::stop() noexcept { abort("stopped by gm"); }

bool ChildTransport::alive() const {
    std::lock_guard lock(mutex_);
    return alive_;
}

void ChildTransport::abort(const std::string& reason) {
    {
        std::lock_guard lock(mutex_);
        if (!alive_) return;
        alive_ = false;
        lost_ = reason;
    }
    changed_.notify_all();
}

mcp::core::Error ChildTransport::not_running() const {
    return mcp::core::Error{INTERNAL_ERROR, "MCP server " + server_ + " is not running", "", "transport"};
}

bool ChildTransport::write(const std::string& line) {
    std::lock_guard lock(write_mutex_);
    return child_->write_line(line);
}

void ChildTransport::forget(std::int64_t id) {
    std::lock_guard lock(mutex_);
    pending_.erase(id);
}

void ChildTransport::cancel(std::int64_t id, std::chrono::milliseconds limit) {
    mcp::protocol::CancelledNotificationParams params;
    params.request_id = id;
    params.reason = "timed out after " + limit_text(limit);
    (void)send_notification(mcp::protocol::make_notification("notifications/cancelled", mcp::protocol::cancelled_notification_params_to_json(params)));
}

mcp::core::Result<mcp::protocol::JsonRpcResponse> ChildTransport::send(const mcp::protocol::JsonRpcRequest& request) {
    const std::optional<std::chrono::milliseconds> limit = budget_on_thread;
    std::int64_t id = 0;
    {
        std::lock_guard lock(mutex_);
        if (!alive_) return mcp::core::unexpected(not_running());
        id = ++last_id_;
        pending_.emplace(id, std::nullopt);
    }
    mcp::protocol::JsonRpcRequest outbound = request;
    outbound.id = id;
    const auto serialized = mcp::protocol::serialize_request(outbound);
    if (!serialized) {
        forget(id);
        return mcp::core::unexpected(serialized.error());
    }
    if (!write(*serialized)) {
        forget(id);
        return mcp::core::unexpected(not_running());
    }

    std::unique_lock lock(mutex_);
    const auto answered = [this, id] {
        const auto found = pending_.find(id);
        return !alive_ || (found != pending_.end() && found->second.has_value());
    };
    if (limit) {
        changed_.wait_for(lock, *limit, answered);
    } else {
        changed_.wait(lock, answered);
    }
    const auto found = pending_.find(id);
    if (found != pending_.end() && found->second.has_value()) {
        mcp::protocol::JsonRpcResponse response = std::move(*found->second);
        pending_.erase(found);
        response.id = request.id;
        return response;
    }
    const bool timed_out = alive_ && limit.has_value();
    pending_.erase(id);
    if (!alive_) {
        return mcp::core::unexpected(mcp::core::Error{INTERNAL_ERROR, "MCP server " + server_ + " " + lost_, "", "transport"});
    }
    lock.unlock();
    if (!timed_out) return mcp::core::unexpected(not_running());
    cancel(id, *limit);
    return mcp::core::unexpected(mcp::core::Error{INTERNAL_ERROR, request.method + " timed out after " + limit_text(*limit), "", "timeout"});
}

mcp::core::Result<mcp::core::Unit> ChildTransport::send_notification(const mcp::protocol::JsonRpcNotification& notification) {
    const auto serialized = mcp::protocol::serialize_notification(notification);
    if (!serialized) return mcp::core::unexpected(serialized.error());
    if (!write(*serialized)) return mcp::core::unexpected(not_running());
    return mcp::core::Unit{};
}

void ChildTransport::dispatch(const std::string& line) {
    const auto message = mcp::protocol::parse_message(line);
    if (!message) return;

    mcp::client::TransportRequestHandler on_request;
    mcp::client::TransportNotificationHandler on_notification;
    {
        std::lock_guard lock(mutex_);
        on_request = request_handler_;
        on_notification = notification_handler_;
    }

    if (const auto* notification = std::get_if<mcp::protocol::JsonRpcNotification>(&*message)) {
        if (on_notification) (void)on_notification(*notification);
        return;
    }
    if (const auto* incoming = std::get_if<mcp::protocol::JsonRpcRequest>(&*message)) {
        if (!on_request) return;
        auto handled = on_request(*incoming);
        if (!handled) {
            handled = mcp::protocol::make_error_response(
                std::optional<mcp::protocol::RequestId>{incoming->id},
                mcp::protocol::make_error(handled.error().code, handled.error().message,
                                          handled.error().detail.empty() ? std::nullopt : std::optional<mcp::protocol::Json>{handled.error().detail}));
        }
        const auto serialized = mcp::protocol::serialize_response(*handled);
        if (serialized) (void)write(*serialized);
        return;
    }

    const auto* response = std::get_if<mcp::protocol::JsonRpcResponse>(&*message);
    if (response == nullptr || !response->id.has_value()) return;
    const auto* key = std::get_if<std::int64_t>(&*response->id);
    if (key == nullptr) return;
    {
        std::lock_guard lock(mutex_);
        const auto found = pending_.find(*key);
        if (found == pending_.end()) return;
        found->second = *response;
    }
    changed_.notify_all();
}

}
