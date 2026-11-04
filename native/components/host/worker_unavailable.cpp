#include <iostream>

#include "gmnew/host/options.hpp"

namespace gmnew::host {

namespace {

int unavailable(std::string_view mode) {
    std::cerr << "gmnew " << mode << ": this build has no " << GMNEW_HOST_MISSING_TARGETS
              << "; configure again once those components build\n";
    return 1;
}

}  // namespace

int run_worker(const HostArgs&) { return unavailable("worker"); }

int run_doctor(const HostArgs&) { return unavailable("doctor"); }

}  // namespace gmnew::host
