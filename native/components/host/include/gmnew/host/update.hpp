#pragma once

#include <chrono>
#include <cstdint>
#include <filesystem>
#include <functional>
#include <map>
#include <optional>
#include <string>
#include <string_view>

#include "deoxidene/result.hpp"
#include "gmnew/json.hpp"

namespace gmnew::host {

inline constexpr std::string_view kBuildVersion = GMNEW_BUILD_VERSION;
inline constexpr std::string_view kDefaultUpdateUrl =
    "https://github.com/AnEntrypoint/gmc/releases/download/latest/manifest.json";

struct ManifestAsset {
    std::string file;
    std::string sha256;
    std::uintmax_t size = 0;
};

struct Manifest {
    std::string version;
    std::string commit;
    std::string built;
    std::string repo;
    std::map<std::string, ManifestAsset> assets;
};

struct UpdatePolicy {
    std::string url = std::string(kDefaultUpdateUrl);
    std::filesystem::path install_dir;
    std::string current_version = std::string(kBuildVersion);
    std::chrono::hours interval{6};
    bool enabled = true;
};

struct UpdateResult {
    bool ok = false;
    bool updated = false;
    std::string from;
    std::string to;
    std::string commit;
    std::string error;

    json::Value to_json() const;
};

std::string target_name();
std::string executable_name();
deoxidene::Result<Manifest, std::string> parse_manifest(std::string_view text);
bool is_newer(const Manifest& manifest, std::string_view current_version);
UpdatePolicy policy_from_environment(const std::filesystem::path& install_dir);
UpdateResult update_now(const UpdatePolicy& policy);
std::optional<std::string> install_staged(const std::filesystem::path& staged_root,
                                          const std::filesystem::path& install_dir,
                                          const std::function<bool(std::string_view)>& allow = {});
void remove_retired_executable(const std::filesystem::path& install_dir);
int run_update_command();

}
