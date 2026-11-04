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

// argv[0] is the program, found on PATH. An empty cwd keeps the current directory. A timeout of 0 waits without limit;
// on timeout the child and its process group are killed and timed_out is set.
Outcome run(const std::vector<std::string>& argv, const std::filesystem::path& cwd = {},
            std::string_view stdin_text = {}, std::uint64_t timeout_ms = 0);

// The platform shell: /bin/sh -c on POSIX, cmd /c on Windows.
Outcome shell(std::string_view command, const std::filesystem::path& cwd = {}, std::uint64_t timeout_ms = 0);

}  // namespace gmnew::proc
