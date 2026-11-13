#include "gm/tool.hpp"

#include <chrono>
#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <optional>
#include <sstream>
#include <string>
#include <system_error>
#include <vector>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;
using Clock = std::chrono::steady_clock;

constexpr long long kRunLimitMs = 60000;
constexpr long long kStampLimitMs = 30000;
constexpr std::int64_t kCommitStep = 1000;

#if defined(__aarch64__)
constexpr const char* kPlatformTarget = "arm64-linux";
#else
constexpr const char* kPlatformTarget = "x64-linux";
#endif

enum class Commit { Older, Equal, Newer, Absent };

struct Leg {
    const char* label;
    const char* offered;
    Commit commit;
    const char* expect;
};

constexpr Leg kLegs[] = {
    {"older commit, higher serial", "ffff333-99", Commit::Older, "kept"},
    {"equal commit, lower serial", "ffff333-0", Commit::Equal, "taken"},
    {"newer commit, lower serial", "ffff333-0", Commit::Newer, "taken"},
    {"no commit time, serial not numeric", "ffff333-x", Commit::Absent, "refused"},
};

std::string first_word(const std::string& text) {
    const auto start = text.find_first_not_of(" \t\r\n");
    if (start == std::string::npos) return {};
    const auto end = text.find_first_of(" \t\r\n", start);
    return text.substr(start, end == std::string::npos ? std::string::npos : end - start);
}

std::optional<std::int64_t> whole_number(const std::string& text) {
    if (text.empty() || text.size() > 18 || text.find_first_not_of("0123456789") != std::string::npos) return std::nullopt;
    return std::stoll(text);
}

std::optional<std::int64_t> commit_time_of(const std::string& commit) {
    const auto kind = git_output(fs::current_path(), {"cat-file", "-t", commit});
    if (!kind || first_word(*kind) != "commit") return std::nullopt;
    const auto logged = git_output(fs::current_path(), {"log", "-1", "--format=%ct", commit});
    return logged ? whole_number(first_word(*logged)) : std::nullopt;
}

void make_executable(const fs::path& file) {
    std::error_code ec;
    fs::permissions(file, fs::perms::owner_all | fs::perms::group_read | fs::perms::group_exec | fs::perms::others_read | fs::perms::others_exec, fs::perm_options::replace, ec);
}

bool succeeded(const proc::Outcome& outcome) {
    return outcome.started && !outcome.timed_out && outcome.exit_code == 0;
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
    result.summary = "skipped (not on this platform: the check stages the install with tar and sha256sum and runs it through env)";
    return result;
#else
    const auto started = Clock::now();
    const std::string version_line = proc::run({binary, "--version"}, {}, {}, kStampLimitMs).out;
    std::istringstream words(version_line);
    std::vector<std::string> fields;
    for (std::string field; words >> field;) fields.push_back(field);
    if (fields.empty()) {
        result.failures.push_back("the build reports no stamp: " + version_line.substr(0, 200));
        return result;
    }
    const std::string stamp = fields.front();
    std::string commit = fields.size() >= 2 ? fields[1] : std::string{};
    if (commit.size() >= 2 && commit.front() == '(' && commit.back() == ')') commit = commit.substr(1, commit.size() - 2);
    std::optional<std::int64_t> built = fields.size() >= 3 ? whole_number(fields.back()) : std::nullopt;
    if (!built && !commit.empty()) built = commit_time_of(commit);
    if (!built) {
        const std::string cause = commit.empty() ? std::string("the build prints neither a commit nor a commit time")
                                                 : "the build prints '" + commit + "', which git does not know as a commit in this checkout (a tree digest prints this way), and no commit time";
        result.failures.push_back("the update order cannot be checked: " + cause + ": " + version_line.substr(0, 200));
        return result;
    }
    const std::string archive_name = std::string("gmnew-") + kPlatformTarget + ".tar.gz";
    const fs::path scratch = fs::temp_directory_path() / ("gm-update-order-" + std::to_string(started.time_since_epoch().count()));
    const Scratch guard{scratch};
    const fs::path pack = scratch / "pack";
    const fs::path staged = pack / ("gmnew-" + std::string(kPlatformTarget));
    const fs::path archive = scratch / archive_name;
    std::error_code ec;
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

    std::vector<std::string> outcomes;
    for (std::size_t index = 0; index < std::size(kLegs); ++index) {
        const Leg& leg = kLegs[index];
        const fs::path leg_root = scratch / ("leg-" + std::to_string(index));
        const fs::path install = leg_root / "install";
        const fs::path published = leg_root / "published";
        const fs::path manifest_path = published / "manifest.json";
        const std::string label = leg.label;
        fs::create_directories(install / "versions" / stamp, ec);
        fs::create_directories(published, ec);
        fs::copy_file(archive, published / archive_name, fs::copy_options::overwrite_existing, ec);
        const fs::path installed_gm = install / "versions" / stamp / "gm";
        fs::create_hard_link(binary, installed_gm, ec);
        if (ec) {
            ec.clear();
            fs::copy_file(binary, installed_gm, fs::copy_options::overwrite_existing, ec);
        }
        make_executable(installed_gm);
        fs::create_directory_symlink(fs::path("versions") / stamp, install / "current", ec);

        json::Object asset{{"file", archive_name}, {"sha256", digest}, {"size", static_cast<std::uint64_t>(size)}, {"version", leg.offered}};
        if (leg.commit == Commit::Older) asset.push_back({"committed", static_cast<std::uint64_t>(*built - kCommitStep)});
        if (leg.commit == Commit::Equal) asset.push_back({"committed", static_cast<std::uint64_t>(*built)});
        if (leg.commit == Commit::Newer) asset.push_back({"committed", static_cast<std::uint64_t>(*built + kCommitStep)});
        json::Value manifest = json::Object{
            {"version", leg.offered},
            {"commit", std::string(40, 'd')},
            {"built", "2026-11-13T00:00:00Z"},
            {"repo", "AnEntrypoint/gm"},
            {"assets", json::Object{{kPlatformTarget, json::Value(asset)}}}};
        std::ofstream(manifest_path) << json::dump(manifest);

        const std::string manifest_url = "file://" + manifest_path.string();
        const proc::Outcome run = proc::run({"env", "GMNEW_UPDATE_URL=" + manifest_url, (install / "current" / "gm").string(), "update"}, {}, {}, kRunLimitMs);
        const std::optional<json::Value> reply = reply_of(run.out);
        if (!reply) {
            result.failures.push_back(label + ": gm update printed no JSON reply: " + run.out.substr(0, 200) + run.err.substr(0, 200));
            continue;
        }
        const std::string status = text_of(*reply, "status");
        const std::string linked = linked_to(install);
        if (!flag_of(*reply, "ok")) result.failures.push_back(label + ": gm update did not answer ok: " + json::dump(*reply).substr(0, 240));
        if (std::string(leg.expect) == "taken") {
            if (!flag_of(*reply, "updated") || text_of(*reply, "to") != leg.offered) result.failures.push_back(label + ": " + leg.offered + " was not taken: " + json::dump(*reply).substr(0, 240));
            if (linked != leg.offered) result.failures.push_back(label + ": the install points at " + linked + ", not " + leg.offered);
        } else {
            if (flag_of(*reply, "updated")) result.failures.push_back(label + ": gm update took " + leg.offered + " over " + stamp);
            const std::string reason = std::string(leg.expect) == "kept" ? "is older" : "cannot be ordered";
            if (status.find(reason) == std::string::npos) result.failures.push_back(label + ": the update was not reported as refused (" + reason + "): '" + status + "'");
            if (linked != stamp) result.failures.push_back(label + ": the install points at " + linked + " after " + leg.offered + " was refused; it should stay on " + stamp);
        }
        outcomes.push_back(std::string(leg.expect) + " " + leg.offered + (status.empty() ? std::string{} : " ('" + status + "')"));
    }

    const double wall = std::chrono::duration<double>(Clock::now() - started).count();
    if (result.failures.empty()) {
        std::string summary = stamp + " (commit time " + std::to_string(*built) + "):";
        for (const std::string& outcome : outcomes) summary += " " + outcome + ";";
        result.summary = summary + " (wall " + std::to_string(wall) + " s)";
    }
    return result;
#endif
}

}
