#pragma once

#include <atomic>
#include <chrono>
#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <memory>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "deoxidene/result.hpp"
#include "gm/json.hpp"
#include "gm/verbs.hpp"

namespace gm {

struct ConsoleBuffer {
    static constexpr std::size_t kLines = 200;
    static constexpr std::size_t kBytes = 8192;
    static constexpr std::size_t kLineBytes = 512;

    std::vector<std::string> lines;
    std::size_t bytes = 0;
    std::size_t dropped = 0;

    void add(std::string_view text);
};

struct BodyControls {
    std::atomic<bool> stopped{false};
    std::chrono::milliseconds js_budget{60000};
    ConsoleBuffer console;
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
