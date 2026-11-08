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
#include "gm/json.hpp"

namespace gm::host {

inline constexpr std::string_view kBuildVersion = GMNEW_BUILD_VERSION;
inline constexpr std::string_view kBuildCommit = GMNEW_BUILD_COMMIT;
inline constexpr bool is_dev_version(std::string_view version) {
    return version == "dev" ||
           (version.size() >= 4 && version.substr(version.size() - 4) == "-dev");
}
inline constexpr std::string_view kDefaultUpdateUrl =
    "https://github.com/AnEntrypoint/gm/releases/download/latest/manifest.json";
inline constexpr std::chrono::minutes kUpdateInterval{15};

struct ManifestAsset {
    std::string file;
    std::string sha256;
    std::string version;
    std::uintmax_t size = 0;
};

struct Manifest {
    std::string version;
    std::string commit;
    std::string built;
    std::string repo;
    std::map<std::string, ManifestAsset> assets;
};

struct ManifestReply {
    bool not_modified = false;
    std::string body;
    std::string etag;
};

using ManifestFetcher = std::function<deoxidene::Result<ManifestReply, std::string>(
    const std::string& url, const std::string& etag, const std::filesystem::path& scratch)>;

deoxidene::Result<ManifestReply, std::string> fetch_manifest_over_http(const std::string& url, const std::string& etag,
                                                                       const std::filesystem::path& scratch);

struct UpdatePolicy {
    std::string url = std::string(kDefaultUpdateUrl);
    std::filesystem::path install_dir;
    std::string current_version = std::string(kBuildVersion);
    std::chrono::minutes interval = kUpdateInterval;
    bool enabled = true;
    bool force = false;
    ManifestFetcher fetch = fetch_manifest_over_http;
};

struct UpdateState {
    std::int64_t checked_ms = 0;
    std::string etag;
    std::string version;
    std::string asset_sha;
};

struct UpdateResult {
    bool ok = false;
    bool updated = false;
    std::string from;
    std::string to;
    std::string commit;
    std::string status;
    std::string error;

    json::Value to_json() const;
};

std::string target_name();
std::string executable_name();
std::string core_executable_name();
deoxidene::Result<Manifest, std::string> parse_manifest(std::string_view text);
UpdatePolicy policy_from_environment(const std::filesystem::path& install_dir);
UpdateResult update_now(const UpdatePolicy& policy);
UpdateState read_update_state(const std::filesystem::path& install_dir);
bool write_update_state(const std::filesystem::path& install_dir, const UpdateState& state);
bool checked_recently(const UpdateState& state, std::int64_t now_ms, std::chrono::minutes interval);
std::chrono::milliseconds next_check_delay(const UpdatePolicy& policy);
std::optional<std::string> etag_from_headers(std::string_view headers);
bool acquire_update_lock(const std::filesystem::path& install_dir);
std::optional<std::string> install_staged(const std::filesystem::path& staged_root,
                                          const std::filesystem::path& install_dir,
                                          const std::function<bool(std::string_view)>& allow = {});
int run_update_command();

}
