#pragma once

#include <cstdint>
#include <string>

namespace gm::jobs {

inline std::string kill_statement(const std::string& name, const std::string& reason, std::uint64_t timeout_ms, std::uint64_t lifetime_ms) {
    if (reason == "timeout") return "job " + name + " stopped: timeout after " + std::to_string(timeout_ms) + " ms";
    if (reason == "lifetime") return "job " + name + " stopped: the job lifetime of " + std::to_string(lifetime_ms) + " ms ended before it finished";
    if (reason == "cancelled") return "job " + name + " stopped by job_stop";
    if (reason == "restart") return "job " + name + " killed: the gm worker restarted while it ran, and a restart kills the process group of every job that was running";
    if (reason == "run-ended") return "job " + name + " killed: its run ended while it ran (the run finished or its host closed), and ending a run kills the process group of every running job";
    return "job " + name + " killed: " + reason;
}

}
