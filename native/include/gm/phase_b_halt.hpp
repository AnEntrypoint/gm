#pragma once

namespace gm::tool {

inline bool phase_b_exit_is_error(bool started, bool timed_out, int exit_code) {
    return started && !timed_out && exit_code == 2;
}

}
