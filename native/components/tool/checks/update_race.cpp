#include "gm/tool.hpp"

#include <chrono>
#include <filesystem>
#include <string>
#include <system_error>
#include <thread>

namespace gm::tool {

#if !defined(_WIN32)
CheckResult check_update_race(const std::string& binary) {
    namespace fs = std::filesystem;
    CheckResult result;
    const auto stamp = std::chrono::steady_clock::now().time_since_epoch().count();
    const fs::path sandbox = fs::temp_directory_path() / ("gm-update-race-" + std::to_string(stamp));
    const fs::path install = sandbox / "install";
    fs::create_directories(install);
    const fs::path gm = install / "gm";
    std::error_code ec;
    fs::copy_file(binary, gm, fs::copy_options::overwrite_existing, ec);
    if (ec) {
        result.failures.push_back("cannot copy " + binary + " into the scratch install: " + ec.message());
        fs::remove_all(sandbox, ec);
        return result;
    }
    fs::permissions(gm, fs::perms::owner_all, fs::perm_options::add, ec);
    {
        HoldServer server(std::chrono::milliseconds(3000), "{}");
        if (server.port() == 0) {
            result.failures.push_back("the local manifest server did not start");
        } else {
            const std::string base = "http://127.0.0.1:" + std::to_string(server.port());
            const std::string home = "HOME=" + sandbox.string();
            proc::Outcome holder;
            std::thread first([&] { holder = proc::run({"env", home, "GMNEW_UPDATE_URL=" + base + "/hold/manifest.json", gm.string(), "update"}, sandbox, {}, 30000); });
            const auto began = std::chrono::steady_clock::now();
            while (!server.requested() && std::chrono::steady_clock::now() - began < std::chrono::seconds(10)) std::this_thread::sleep_for(std::chrono::milliseconds(20));
            if (!server.requested()) result.failures.push_back("the first update never fetched the manifest");
            const proc::Outcome second = proc::run({"env", home, "GMNEW_UPDATE_URL=" + base + "/fast/manifest.json", gm.string(), "update"}, sandbox, {}, 30000);
            first.join();
            if (second.out.find("another update is running") == std::string::npos)
                result.failures.push_back("the second update did not find the first one's lock: " + second.out.substr(0, 240) + second.err.substr(0, 240));
            const std::string held = holder.out + holder.err;
            if (held.find("Failed writing") != std::string::npos || held.find("Failed to open") != std::string::npos || held.find("(23)") != std::string::npos)
                result.failures.push_back("the update holding the lock lost its staging directory to the second update: " + held.substr(0, 300));
            if (held.find("\"from\"") == std::string::npos) result.failures.push_back("the first update printed no result: " + held.substr(0, 300));
        }
    }
    result.summary = "two gm update passes on one install: the second finds the lock held and returns, and the first one's manifest fetch keeps its staging directory and finishes without a curl write error";
    fs::remove_all(sandbox, ec);
    return result;
}
#else
CheckResult check_update_race(const std::string&) {
    CheckResult result;
    result.summary = "skipped: POSIX-only check, it uses the local HoldServer";
    return result;
}
#endif

}
