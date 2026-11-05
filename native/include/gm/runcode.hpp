#pragma once

#include <atomic>
#include <chrono>
#include <cstdint>
#include <filesystem>
#include <memory>
#include <string>
#include <string_view>
#include <utility>

#include "deoxidene/result.hpp"
#include "gm/json.hpp"
#include "gm/verbs.hpp"

namespace gm {

struct BodyControls {
    std::atomic<bool> stopped{false};
    std::chrono::milliseconds js_budget{60000};
};

using BodyControlsPtr = std::shared_ptr<BodyControls>;

inline BodyControlsPtr& thread_body_controls() {
    static thread_local BodyControlsPtr controls;
    return controls;
}

class BodyControlsScope {
public:
    explicit BodyControlsScope(BodyControlsPtr controls)
        : previous_(std::move(thread_body_controls())) {
        thread_body_controls() = std::move(controls);
    }
    ~BodyControlsScope() { thread_body_controls() = std::move(previous_); }
    BodyControlsScope(const BodyControlsScope&) = delete;
    BodyControlsScope& operator=(const BodyControlsScope&) = delete;

private:
    BodyControlsPtr previous_;
};

deoxidene::Result<json::Value, std::string> run_body(VerbTable& verbs, std::string_view body,
                                                     const std::filesystem::path& project_root, std::string_view format = "cjs",
                                                     BodyControlsPtr controls = nullptr);

}
