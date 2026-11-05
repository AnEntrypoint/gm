#include <iostream>

#include "gm/host/options.hpp"

namespace gm::host {

namespace {

int unavailable(std::string_view mode) {
    std::cerr << "gm " << mode << ": this build has no " << GMNEW_HOST_MISSING_TARGETS
              << "; configure again once those components build\n";
    return 1;
}

}

int run_worker(const HostArgs&) { return unavailable("worker"); }

int run_doctor(const HostArgs&) { return unavailable("doctor"); }

}
