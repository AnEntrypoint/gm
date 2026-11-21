#pragma once
#include <quickjs.h>

#include <cstdint>
#include <optional>
#include <string>
#include <vector>

namespace gm::core_extras {

struct SpawnRequest {
    std::vector<std::string> command;
    std::optional<std::string> cwd;
    std::optional<std::vector<std::string>> env;
    std::string stdin_text;
    int kill_signal = 0;
    std::uint64_t timeout_ms = 0;
};

struct SpawnOutcome {
    bool started = false;
    bool timed_out = false;
    std::int64_t pid = 0;
    int exit_code = -1;
    int signal = 0;
    std::string out;
    std::string err;
};

using SpawnSync = SpawnOutcome (*)(const SpawnRequest&);

void install(JSContext* ctx, JSValueConst core, SpawnSync spawn);

}
