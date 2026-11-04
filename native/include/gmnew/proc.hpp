#pragma once

#include <cstdint>
#include <filesystem>
#include <string>
#include <string_view>
#include <vector>

namespace gmnew::proc {

struct Outcome {
    bool started = false;
    int exit_code = -1;
    bool timed_out = false;
    std::string out;
    std::string err;
};

Outcome run(const std::vector<std::string>& argv, const std::filesystem::path& cwd = {},
            std::string_view stdin_text = {}, std::uint64_t timeout_ms = 0);

Outcome shell(std::string_view command, const std::filesystem::path& cwd = {}, std::uint64_t timeout_ms = 0);

}
