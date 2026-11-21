#include "core_extras_host.hpp"

#include <utility>

#include "core_extras.hpp"
#include "gm/proc.hpp"
#include "txiki_shim.h"

namespace gm::core_extras {
namespace {

SpawnOutcome spawn_with_proc(const SpawnRequest& request) {
    proc::RunOptions options;
    if (request.cwd) options.cwd = *request.cwd;
    options.env = request.env;
    options.stdin_text = request.stdin_text;
    options.kill_signal = request.kill_signal;
    options.timeout_ms = request.timeout_ms;
    proc::Outcome done = proc::run(request.command, options);
    SpawnOutcome outcome;
    outcome.started = done.started;
    outcome.timed_out = done.timed_out;
    outcome.pid = done.pid;
    outcome.exit_code = done.exit_code;
    outcome.signal = done.signal;
    outcome.out = std::move(done.out);
    outcome.err = std::move(done.err);
    return outcome;
}

struct Core {
    JSContext* ctx;
    JSValue value;
    ~Core() { JS_FreeValue(ctx, value); }
};

}

void install_with_proc(JSContext* ctx) {
    const Core core{ctx, gm_txiki_core(ctx)};
    install(ctx, core.value, spawn_with_proc);
}

}
