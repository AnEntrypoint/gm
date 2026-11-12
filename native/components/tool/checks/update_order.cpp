#include "gm/tool.hpp"

#include <chrono>
#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <optional>
#include <string>
#include <system_error>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;
using Clock = std::chrono::steady_clock;

constexpr long long kRunLimitMs = 60000;
constexpr long long kStampLimitMs = 30000;
constexpr std::size_t kMinStamp = 8;
constexpr const char* kInstalledSerial = "15";
constexpr const char* kOlderSerial = "14";
constexpr const char* kNewerSerial = "16";
constexpr const char* kKeptWord = "older";

#if defined(__aarch64__)
constexpr const char* kPlatformTarget = "arm64-linux";
#else
constexpr const char* kPlatformTarget = "x64-linux";
#endif

std::string first_word(const std::string& text) {
    const auto start = text.find_first_not_of(" \t\r\n");
    if (start == std::string::npos) return {};
    const auto end = text.find_first_of(" \t\r\n", start);
    return text.substr(start, end == std::string::npos ? std::string::npos : end - start);
}

std::string read_bytes(const fs::path& file) {
    std::ifstream in(file, std::ios::binary);
    return std::string(std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>());
}

std::string replace_all(std::string text, const std::string& from, const std::string& to) {
    for (std::size_t at = text.find(from); at != std::string::npos; at = text.find(from, at + to.size())) text.replace(at, from.size(), to);
    return text;
}

void make_executable(const fs::path& file) {
    std::error_code ec;
    fs::permissions(file, fs::perms::owner_all | fs::perms::group_read | fs::perms::group_exec | fs::perms::others_read | fs::perms::others_exec, fs::perm_options::replace, ec);
}

bool succeeded(const proc::Outcome& outcome) {
    return outcome.started && !outcome.timed_out && outcome.exit_code == 0;
}

std::string serial_version(std::size_t length, char fill, const char* serial) {
    const std::string suffix = std::string("-") + serial;
    return std::string(length - suffix.size(), fill) + suffix;
}

std::string text_of(const json::Value& object, const char* key) {
    const json::Value* value = object.find(key);
    return value != nullptr && value->is_string() ? value->as_string() : std::string{};
}

bool flag_of(const json::Value& object, const char* key) {
    const json::Value* value = object.find(key);
    return value != nullptr && value->is_bool() && value->as_bool();
}

std::optional<json::Value> reply_of(const std::string& text) {
    auto parsed = json::parse(text);
    if (!parsed || !parsed->is_object()) return std::nullopt;
    return *parsed;
}

std::string linked_to(const fs::path& install) {
    std::error_code ec;
    if (!fs::is_symlink(install / "current", ec)) return {};
    return fs::read_symlink(install / "current", ec).filename().string();
}

struct Scratch {
    fs::path path;
    ~Scratch() {
        std::error_code ignored;
        fs::remove_all(path, ignored);
    }
};

}

CheckResult check_update_order(const std::string& binary) {
    CheckResult result;
#if !defined(__linux__)
    result.summary = "skipped (the check stages the install with env, tar and sha256sum, which this platform's check does not use)";
    return result;
#else
    const auto started = Clock::now();
    const std::string stamp = first_word(proc::run({binary, "--version"}, {}, {}, kStampLimitMs).out);
    if (stamp.size() < kMinStamp) {
        result.failures.push_back("the build stamp '" + stamp + "' is too short to replace in the staged copy");
        return result;
    }
    const std::size_t length = stamp.size();
    const std::string installed = serial_version(length, 'a', kInstalledSerial);
    const std::string older = serial_version(length, 'b', kOlderSerial);
    const std::string newer = serial_version(length, 'c', kNewerSerial);
    const std::string archive_name = std::string("gmnew-") + kPlatformTarget + ".tar.gz";
    const fs::path scratch = fs::temp_directory_path() / ("gm-update-order-" + std::to_string(started.time_since_epoch().count()));
    const Scratch guard{scratch};
    const fs::path install = scratch / "install";
    const fs::path published = scratch / "published";
    const fs::path pack = scratch / "pack";
    const fs::path staged = pack / ("gmnew-" + std::string(kPlatformTarget));
    const fs::path archive = published / archive_name;
    const fs::path manifest_path = published / "manifest.json";
    std::error_code ec;
    fs::create_directories(install / "versions" / installed, ec);
    fs::create_directories(published, ec);
    for (const char* name : {"leaves", "skills", "defaults"}) fs::create_directories(staged / name, ec);
    std::ofstream(staged / "gm") << "placeholder\n";
    std::ofstream(staged / "gm-core") << "placeholder\n";
    if (!succeeded(proc::run({"tar", "-czf", archive.string(), "-C", pack.string(), staged.filename().string()}, {}, {}, kRunLimitMs))) {
        result.failures.push_back("could not pack the placeholder archive " + archive.string());
        return result;
    }
    const std::string digest = first_word(proc::run({"sha256sum", archive.string()}, {}, {}, kRunLimitMs).out);
    const std::uintmax_t size = fs::file_size(archive, ec);
    if (digest.empty() || ec) {
        result.failures.push_back("could not hash the placeholder archive " + archive.string());
        return result;
    }

    const fs::path installed_gm = install / "versions" / installed / "gm";
    std::ofstream(installed_gm, std::ios::binary) << replace_all(read_bytes(binary), stamp, installed);
    make_executable(installed_gm);
    fs::create_directory_symlink(fs::path("versions") / installed, install / "current", ec);

    const std::string manifest_url = "file://" + manifest_path.string();
    const auto publish = [&](const std::string& version) {
        json::Value manifest = json::Object{
            {"version", version},
            {"commit", std::string(40, 'd')},
            {"built", "2026-11-13T00:00:00Z"},
            {"repo", "AnEntrypoint/gm"},
            {"assets", json::Object{{kPlatformTarget, json::Object{{"file", archive_name}, {"sha256", digest}, {"size", static_cast<std::uint64_t>(size)}, {"version", version}}}}}};
        std::ofstream(manifest_path) << json::dump(manifest);
    };
    const auto run_update = [&] {
        return proc::run({"env", "GMNEW_UPDATE_URL=" + manifest_url, (install / "current" / "gm").string(), "update"}, {}, {}, kRunLimitMs);
    };

    publish(older);
    const proc::Outcome older_run = run_update();
    const std::optional<json::Value> older_reply = reply_of(older_run.out);
    std::string kept_status;
    if (!older_reply) {
        result.failures.push_back("gm update printed no JSON reply for the older published " + older + ": " + older_run.out.substr(0, 300) + older_run.err.substr(0, 300));
    } else {
        kept_status = text_of(*older_reply, "status");
        if (!flag_of(*older_reply, "ok")) result.failures.push_back("the older published " + older + " was not a clean refusal: " + json::dump(*older_reply).substr(0, 300));
        if (flag_of(*older_reply, "updated")) result.failures.push_back("gm update took the older published " + older + " over the installed " + installed);
        if (kept_status.find(kKeptWord) == std::string::npos) result.failures.push_back("the older published " + older + " was not reported as kept: '" + kept_status + "'");
    }
    if (linked_to(install) != installed) result.failures.push_back("the install points at " + linked_to(install) + " after the older published build; it should stay on " + installed);

    publish(newer);
    const proc::Outcome newer_run = run_update();
    const std::optional<json::Value> newer_reply = reply_of(newer_run.out);
    if (!newer_reply) {
        result.failures.push_back("gm update printed no JSON reply for the newer published " + newer + ": " + newer_run.out.substr(0, 300) + newer_run.err.substr(0, 300));
    } else if (!flag_of(*newer_reply, "ok") || !flag_of(*newer_reply, "updated") || text_of(*newer_reply, "to") != newer) {
        result.failures.push_back("the newer published " + newer + " was not taken: " + json::dump(*newer_reply).substr(0, 300));
    }
    if (linked_to(install) != newer) result.failures.push_back("the install points at " + linked_to(install) + ", not the newer published " + newer);

    const double wall = std::chrono::duration<double>(Clock::now() - started).count();
    if (result.failures.empty()) {
        result.summary = installed + " (serial " + kInstalledSerial + "): the older published " + older + " (serial " + kOlderSerial + ") was kept out ('" + kept_status +
                         "'), and the newer published " + newer + " (serial " + kNewerSerial + ") was taken, the install now points at " + newer + " (wall " + std::to_string(wall) + " s)";
    }
    return result;
#endif
}

}
