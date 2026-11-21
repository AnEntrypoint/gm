#include "gm/tool.hpp"
#include "support.hpp"

#include <filesystem>
#include <string>
#include <system_error>
#include <vector>

namespace gm::tool {

CheckResult check_txiki_extras_standalone(const std::string&) {
    CheckResult result;
    const std::filesystem::path root = support::checkout_root();
    if (root.empty()) {
        result.failures.push_back("run from the checkout: no skills/gm/SKILL.md in the working directory or its parents");
        return result;
    }
    const std::filesystem::path sandbox = support::fresh_sandbox("ex");
    const std::filesystem::path extras = sandbox / "extras";
    const std::filesystem::path vendored = root / "native" / "third_party" / "txiki";
    std::error_code ec;
    std::filesystem::copy(root / "tools" / "txiki" / "extras", extras, std::filesystem::copy_options::recursive, ec);
    if (ec) {
        result.failures.push_back("copying tools/txiki/extras failed: " + ec.message());
        return result;
    }
    const std::vector<std::string> flags = {"-std=c++17", "-fsyntax-only", "-Wall", "-Werror", "-I", extras.string(), "-I", (vendored / "quickjs").string(), "-I", (vendored / "zstd" / "lib").string(), "-I", (vendored / "brotli" / "c" / "include").string(), (extras / "core_extras.cpp").string()};
    proc::Outcome compiled;
    for (const char* compiler : {"c++", "g++", "clang++"}) {
        std::vector<std::string> command{compiler};
        command.insert(command.end(), flags.begin(), flags.end());
        compiled = proc::run(command, sandbox, {}, 300000);
        if (compiled.started) break;
    }
    if (!compiled.started) result.failures.push_back("no C++ compiler (c++, g++ or clang++) could be started");
    else if (compiled.exit_code != 0) result.failures.push_back("core_extras.cpp does not compile with only quickjs, zstd and brotli on the include path: " + compiled.err.substr(0, 400));
    std::filesystem::remove_all(sandbox, ec);
    if (result.failures.empty()) result.summary = "tools/txiki/extras/core_extras.cpp compiles with -Wall -Werror and only the quickjs, zstd and brotli headers on the include path, so fx and thebird can build it without any gm header";
    return result;
}

}
