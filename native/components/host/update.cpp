#include "gm/host/update.hpp"

#include <algorithm>
#include <cctype>
#include <cerrno>
#include <chrono>
#include <cstdlib>
#include <exception>
#include <fstream>
#include <iostream>
#include <iterator>
#include <optional>
#include <system_error>
#include <vector>

#include "gm/host/child.hpp"
#include "gm/mcp.hpp"
#include "gm/proc.hpp"

#if !defined(_WIN32)
#include <signal.h>
#include <sys/types.h>
#include <unistd.h>
#endif

namespace gm::host {

namespace {

namespace fs = std::filesystem;

constexpr std::uint64_t kManifestTimeoutMs = 90000;
constexpr std::uint64_t kArchiveTimeoutMs = 900000;
constexpr std::string_view kStagingName = ".gmnew-staging";
constexpr std::string_view kPreviousName = ".gmnew-previous";
constexpr std::string_view kRetiredSuffix = ".old";
constexpr std::string_view kStateName = ".gmnew-update.json";
constexpr std::string_view kLockName = ".gmnew-update.lock";
constexpr std::string_view kOwnerName = "owner";
constexpr std::chrono::minutes kLockStale{30};
constexpr std::string_view kEtagHeader = "etag:";
constexpr std::string_view kSharedDirectories[] = {"leaves", "skills", "defaults"};

struct Rename {
    fs::path from;
    fs::path to;
};

class ScopedRemoval {
public:
    explicit ScopedRemoval(fs::path path) : path_(std::move(path)) {}
    ~ScopedRemoval() {
        std::error_code ignored;
        fs::remove_all(path_, ignored);
    }
    ScopedRemoval(const ScopedRemoval&) = delete;
    ScopedRemoval& operator=(const ScopedRemoval&) = delete;

private:
    fs::path path_;
};

std::string lower(std::string text) {
    std::transform(text.begin(), text.end(), text.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return text;
}

std::string text_member(const json::Value& object, std::string_view key) {
    const json::Value* value = object.find(key);
    return value != nullptr && value->is_string() ? value->as_string() : std::string{};
}

std::string url_base(const std::string& url) {
    const std::size_t slash = url.rfind('/');
    return slash == std::string::npos ? url : url.substr(0, slash);
}

bool plain_file_name(std::string_view name) {
    return !name.empty() && name != "." && name != ".." && name.find_first_of("/\\") == std::string_view::npos;
}

std::string failure_of(const std::string& what, const proc::Outcome& outcome) {
    if (!outcome.started) return what + ": the tool did not start";
    if (outcome.timed_out) return what + ": timed out";
    std::string detail = outcome.err.empty() ? outcome.out : outcome.err;
    while (!detail.empty() && std::isspace(static_cast<unsigned char>(detail.back()))) detail.pop_back();
    if (detail.size() > 240) detail.resize(240);
    return what + " failed (exit " + std::to_string(outcome.exit_code) + ")" + (detail.empty() ? std::string{} : ": " + detail);
}

std::string read_bytes(const fs::path& path) {
    std::ifstream in(path, std::ios::binary);
    return std::string((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
}

std::string_view trimmed(std::string_view text) {
    const std::size_t first = text.find_first_not_of(" \t\r\n");
    if (first == std::string_view::npos) return {};
    const std::size_t last = text.find_last_not_of(" \t\r\n");
    return text.substr(first, last - first + 1);
}

std::int64_t now_ms() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count();
}

std::optional<std::string> download(const std::string& url, const fs::path& destination) {
    const proc::Outcome outcome =
        proc::run({"curl", "-fsSL", "--max-time", "900", "-o", destination.string(), url}, {}, {}, kArchiveTimeoutMs);
    if (!outcome.started || outcome.timed_out || outcome.exit_code != 0) return failure_of("download " + url, outcome);
    return std::nullopt;
}

std::optional<std::string> verify_archive(const fs::path& archive, const ManifestAsset& asset) {
    std::error_code ec;
    const std::uintmax_t size = fs::file_size(archive, ec);
    if (ec) return "the archive " + asset.file + " is missing";
    if (asset.size != 0 && size != asset.size)
        return "the archive " + asset.file + " is " + std::to_string(size) + " bytes, the manifest says " +
               std::to_string(asset.size);
    const std::string bytes = read_bytes(archive);
    if (asset.sha256.empty() || lower(mcp::sha256_hex(bytes)) != lower(asset.sha256))
        return "sha256 of " + asset.file + " does not match the manifest; the installed build is kept";
    return std::nullopt;
}

std::optional<std::string> unpack(const fs::path& archive, const fs::path& destination) {
    fs::create_directories(destination);
    const proc::Outcome outcome =
        proc::run({"tar", "-xf", archive.string(), "-C", destination.string()}, {}, {}, kArchiveTimeoutMs);
    if (!outcome.started || outcome.timed_out || outcome.exit_code != 0) return failure_of("unpack " + archive.filename().string(), outcome);
    return std::nullopt;
}

std::optional<long long> build_number(std::string_view version) {
    const std::size_t dash = version.rfind('-');
    if (dash == std::string_view::npos || dash + 1 >= version.size() || version.size() - dash - 1 > 15) return std::nullopt;
    const std::string_view digits = version.substr(dash + 1);
    if (!std::all_of(digits.begin(), digits.end(), [](unsigned char c) { return std::isdigit(c); })) return std::nullopt;
    return std::stoll(std::string(digits));
}

std::string_view commit_prefix(std::string_view version) {
    const std::size_t dash = version.rfind('-');
    return dash == std::string_view::npos ? version : version.substr(0, dash);
}

bool newer_build(std::string_view offered, std::string_view current_version) {
    const auto offered_build = build_number(offered);
    if (!offered_build) return false;
    const auto have = build_number(current_version);
    return !have || *offered_build > *have;
}

bool superseded(const UpdateState& state, std::string_view current_version) {
    return !state.version.empty() && state.version != current_version && newer_build(state.version, current_version);
}

std::optional<std::string> move_recorded(const fs::path& from, const fs::path& to, std::vector<Rename>& done) {
    std::error_code ec;
    fs::rename(from, to, ec);
    if (ec) return "rename " + from.string() + " to " + to.string() + " failed: " + ec.message();
    done.push_back({from, to});
    return std::nullopt;
}

void undo_renames(std::vector<Rename>& done) {
    for (auto step = done.rbegin(); step != done.rend(); ++step) {
        std::error_code ignored;
        fs::rename(step->to, step->from, ignored);
    }
    done.clear();
}

fs::path retired_path([[maybe_unused]] const fs::path& install_dir, const fs::path& previous_dir, const std::string& name) {
#if defined(_WIN32)
    if (name == executable_name() || name == core_executable_name()) return install_dir / (name + std::string(kRetiredSuffix));
#endif
    return previous_dir / name;
}

}

json::Value UpdateResult::to_json() const {
    json::Value out(json::Object{});
    out.set("ok", ok).set("updated", updated).set("from", from).set("to", to).set("commit", commit).set("target", target_name());
    if (!status.empty()) out.set("status", status);
    if (!error.empty()) out.set("error", error);
    return out;
}

std::string target_name() {
#if defined(_WIN32)
    const char* os = "windows";
#elif defined(__APPLE__)
    const char* os = "macos";
#else
    const char* os = "linux";
#endif
#if defined(__x86_64__) || defined(_M_X64)
    const char* arch = "x64";
#elif defined(__aarch64__) || defined(_M_ARM64)
    const char* arch = "arm64";
#else
    const char* arch = "unknown";
#endif
    return std::string(arch) + "-" + os;
}

std::string executable_name() {
#if defined(_WIN32)
    return "gm.exe";
#else
    return "gm";
#endif
}

std::string core_executable_name() {
#if defined(_WIN32)
    return "gm-core.exe";
#else
    return "gm-core";
#endif
}

deoxidene::Result<Manifest, std::string> parse_manifest(std::string_view text) {
    auto parsed = json::parse(text);
    if (!parsed) return deoxidene::Err<std::string>("the manifest is not JSON: " + parsed.error());
    if (!parsed->is_object()) return deoxidene::Err<std::string>("the manifest is not an object");
    Manifest manifest;
    manifest.version = text_member(*parsed, "version");
    manifest.commit = text_member(*parsed, "commit");
    manifest.built = text_member(*parsed, "built");
    manifest.repo = text_member(*parsed, "repo");
    if (manifest.version.empty()) return deoxidene::Err<std::string>("the manifest has no version");
    const json::Value* assets = parsed->find("assets");
    if (assets == nullptr || !assets->is_object()) return deoxidene::Err<std::string>("the manifest has no assets");
    for (const auto& [target, entry] : assets->as_object()) {
        if (!entry.is_object()) continue;
        ManifestAsset asset;
        asset.file = text_member(entry, "file");
        asset.sha256 = text_member(entry, "sha256");
        const json::Value* size = entry.find("size");
        if (size != nullptr && size->is_number()) asset.size = static_cast<std::uintmax_t>(size->as_number());
        manifest.assets[target] = std::move(asset);
    }
    return manifest;
}

bool is_newer(const Manifest& manifest, std::string_view current_version) {
    if (manifest.version == current_version) return false;
    const std::string_view current_commit = commit_prefix(current_version);
    if (!current_commit.empty() && manifest.commit.starts_with(current_commit)) return false;
    return newer_build(manifest.version, current_version);
}

deoxidene::Result<ManifestReply, std::string> fetch_manifest_over_http(const std::string& url, const std::string& etag,
                                                                       const fs::path& scratch) {
    std::error_code ec;
    fs::create_directories(scratch, ec);
    const fs::path headers = scratch / "manifest.headers";
    const fs::path body = scratch / "manifest.json";
    std::vector<std::string> argv = {"curl", "-fsSL", "--max-time", "60", "-D", headers.string(),
                                     "-o", body.string(), "-w", "%{http_code}"};
    if (!etag.empty()) argv.insert(argv.end(), {"-H", "If-None-Match: " + etag});
    argv.push_back(url);
    const proc::Outcome outcome = proc::run(argv, {}, {}, kManifestTimeoutMs);
    if (!outcome.started || outcome.timed_out || outcome.exit_code != 0)
        return deoxidene::Err<std::string>(failure_of("fetch " + url, outcome));
    ManifestReply reply;
    reply.not_modified = trimmed(outcome.out) == "304";
    if (reply.not_modified) return reply;
    reply.body = read_bytes(body);
    reply.etag = etag_from_headers(read_bytes(headers)).value_or("");
    return reply;
}

UpdateState read_update_state(const fs::path& install_dir) {
    UpdateState state;
    const auto parsed = json::parse(read_bytes(install_dir / kStateName));
    if (!parsed || !parsed->is_object()) return state;
    const json::Value* checked = parsed->find("checked_ms");
    if (checked != nullptr && checked->is_number()) state.checked_ms = static_cast<std::int64_t>(checked->as_number());
    state.etag = text_member(*parsed, "etag");
    state.version = text_member(*parsed, "version");
    return state;
}

bool write_update_state(const fs::path& install_dir, const UpdateState& state) {
    json::Value out(json::Object{});
    out.set("checked_ms", state.checked_ms).set("etag", state.etag).set("version", state.version);
    const fs::path target = install_dir / kStateName;
    const fs::path temp = install_dir / (std::string(kStateName) + ".tmp");
    {
        std::ofstream file(temp, std::ios::binary | std::ios::trunc);
        file << json::dump(out);
        file.close();
        if (!file) {
            std::error_code ignored;
            fs::remove(temp, ignored);
            return false;
        }
    }
    std::error_code ec;
    fs::rename(temp, target, ec);
    if (ec) {
        std::error_code ignored;
        fs::remove(temp, ignored);
    }
    return !ec;
}

bool checked_recently(const UpdateState& state, std::int64_t now, std::chrono::hours interval) {
    const std::int64_t age = now - state.checked_ms;
    return state.checked_ms > 0 && age >= 0 && age < std::chrono::duration_cast<std::chrono::milliseconds>(interval).count();
}

std::optional<std::string> etag_from_headers(std::string_view headers) {
    std::optional<std::string> etag;
    while (!headers.empty()) {
        const std::size_t end = headers.find('\n');
        const std::string_view line = trimmed(headers.substr(0, end));
        headers = end == std::string_view::npos ? std::string_view{} : headers.substr(end + 1);
        if (line.starts_with("HTTP/")) {
            etag.reset();
        } else if (lower(std::string(line.substr(0, kEtagHeader.size()))) == kEtagHeader) {
            etag = std::string(trimmed(line.substr(kEtagHeader.size())));
        }
    }
    return etag;
}

void record_lock_owner([[maybe_unused]] const fs::path& lock) {
#if !defined(_WIN32)
    std::ofstream(lock / kOwnerName) << ::getpid() << '\n';
#endif
}

bool lock_owner_is_gone([[maybe_unused]] const fs::path& lock) {
#if defined(_WIN32)
    return false;
#else
    long pid = 0;
    if (!(std::ifstream(lock / kOwnerName) >> pid) || pid <= 0) return false;
    return ::kill(static_cast<pid_t>(pid), 0) == -1 && errno == ESRCH;
#endif
}

bool acquire_update_lock(const fs::path& install_dir) {
    const fs::path lock = install_dir / kLockName;
    std::error_code ec;
    if (!fs::create_directory(lock, ec)) {
        const fs::file_time_type modified = fs::last_write_time(lock, ec);
        const bool aged_out = !ec && fs::file_time_type::clock::now() - modified >= kLockStale;
        if (!aged_out && !lock_owner_is_gone(lock)) return false;
        fs::remove_all(lock, ec);
        if (ec || !fs::create_directory(lock, ec)) return false;
    }
    record_lock_owner(lock);
    return true;
}

UpdatePolicy policy_from_environment(const fs::path& install_dir) {
    UpdatePolicy policy;
    policy.install_dir = install_dir;
    const char* url = std::getenv("GMNEW_UPDATE_URL");
    if (url != nullptr && *url != '\0') policy.url = url;
    const char* auto_update = std::getenv("GMNEW_AUTO_UPDATE");
    policy.enabled = kBuildVersion != "dev" && !(auto_update != nullptr && std::string_view(auto_update) == "0");
    return policy;
}

std::optional<std::string> install_staged(const fs::path& staged_root, const fs::path& install_dir,
                                          const std::function<bool(std::string_view)>& allow) {
    std::vector<std::string> names = {executable_name(), core_executable_name()};
    for (std::string_view name : kSharedDirectories) names.emplace_back(name);
    for (const std::string& name : names) {
        std::error_code ec;
        if (!fs::exists(staged_root / name, ec)) return "the build has no " + name;
    }

    const fs::path previous = install_dir / kPreviousName;
    std::error_code ec;
    fs::remove_all(previous, ec);
    fs::create_directories(previous, ec);
    if (ec) return "cannot create " + previous.string() + ": " + ec.message();

    std::vector<Rename> done;
    for (const std::string& name : names) {
        const fs::path installed = install_dir / name;
        if (!fs::exists(installed, ec)) continue;
        const fs::path retired = retired_path(install_dir, previous, name);
        fs::remove_all(retired, ec);
        if (auto error = move_recorded(installed, retired, done)) {
            undo_renames(done);
            return error;
        }
    }
    for (const std::string& name : names) {
        if (allow && !allow(name)) {
            undo_renames(done);
            return "the swap stopped before " + name;
        }
        if (auto error = move_recorded(staged_root / name, install_dir / name, done)) {
            undo_renames(done);
            return error;
        }
    }
    return std::nullopt;
}

void remove_retired_executable([[maybe_unused]] const fs::path& install_dir) {
#if defined(_WIN32)
    std::error_code ignored;
    fs::remove(install_dir / (executable_name() + std::string(kRetiredSuffix)), ignored);
    fs::remove(install_dir / (core_executable_name() + std::string(kRetiredSuffix)), ignored);
#endif
}

namespace {

UpdateResult failed(UpdateResult result, std::string error) {
    result.ok = false;
    result.error = std::move(error);
    return result;
}

UpdateResult current_build(UpdateResult result, const UpdatePolicy& policy, std::string status) {
    result.ok = true;
    result.to = policy.current_version;
    result.status = std::move(status);
    return result;
}

UpdateResult update_once(const UpdatePolicy& policy, UpdateResult result) {
    const fs::path staging = policy.install_dir / kStagingName;
    const ScopedRemoval cleanup(staging);

    UpdateState state = read_update_state(policy.install_dir);
    if (checked_recently(state, now_ms(), policy.interval)) return current_build(std::move(result), policy, "already current");
    if (!acquire_update_lock(policy.install_dir))
        return current_build(std::move(result), policy, "another update is running");
    const ScopedRemoval unlock(policy.install_dir / kLockName);

    state = read_update_state(policy.install_dir);
    if (checked_recently(state, now_ms(), policy.interval)) return current_build(std::move(result), policy, "already current");
    if (superseded(state, policy.current_version)) {
        result = current_build(std::move(result), policy, "installed by another process");
        result.to = state.version;
        return result;
    }

    auto reply = policy.fetch(policy.url, state.etag, staging);
    if (!reply) return failed(std::move(result), reply.error());
    if (reply->not_modified) {
        state.checked_ms = now_ms();
        write_update_state(policy.install_dir, state);
        return current_build(std::move(result), policy, "already current");
    }
    auto manifest = parse_manifest(reply->body);
    if (!manifest) return failed(std::move(result), manifest.error());
    result.to = manifest->version;
    result.commit = manifest->commit;
    result.ok = true;
    state.etag = reply->etag;
    if (!is_newer(*manifest, policy.current_version)) {
        state.checked_ms = now_ms();
        state.version = manifest->version;
        write_update_state(policy.install_dir, state);
        result.status = "already current";
        return result;
    }

    const std::string target = target_name();
    const auto asset = manifest->assets.find(target);
    if (asset == manifest->assets.end()) return failed(std::move(result), "the manifest has no build for " + target);
    if (!plain_file_name(asset->second.file))
        return failed(std::move(result), "the manifest names " + asset->second.file + ", which is not a file name");

    fs::create_directories(staging);
    const fs::path archive = staging / asset->second.file;
    if (auto error = download(url_base(policy.url) + "/" + asset->second.file, archive)) return failed(std::move(result), *error);
    if (auto error = verify_archive(archive, asset->second)) return failed(std::move(result), *error);
    const fs::path unpacked = staging / "unpacked";
    if (auto error = unpack(archive, unpacked)) return failed(std::move(result), *error);
    if (auto error = install_staged(unpacked / ("gm-" + target), policy.install_dir))
        return failed(std::move(result), *error);
    state.checked_ms = now_ms();
    state.version = manifest->version;
    write_update_state(policy.install_dir, state);
    result.updated = true;
    result.status = "updated";
    return result;
}

}

UpdateResult update_now(const UpdatePolicy& policy) {
    UpdateResult result;
    result.from = policy.current_version;
    try {
        return update_once(policy, result);
    } catch (const std::exception& error) {
        return failed(std::move(result), error.what());
    }
}

int run_update_command() {
    const UpdatePolicy policy = policy_from_environment(current_executable().parent_path());
    remove_retired_executable(policy.install_dir);
    const UpdateResult result = update_now(policy);
    std::cout << json::dump(result.to_json()) << '\n';
    return result.ok ? 0 : 1;
}

}
