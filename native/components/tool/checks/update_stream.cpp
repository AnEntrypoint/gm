#include "gm/tool.hpp"

#include <cctype>
#include <chrono>
#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <fstream>
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

struct Scratch {
    fs::path path;
    ~Scratch() {
        std::error_code ignored;
        fs::remove_all(path, ignored);
    }
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

bool succeeded(const proc::Outcome& outcome) {
    return outcome.started && !outcome.timed_out && outcome.exit_code == 0;
}

void make_executable(const fs::path& file) {
    std::error_code ec;
    fs::permissions(file, fs::perms::owner_all | fs::perms::group_read | fs::perms::group_exec | fs::perms::others_read | fs::perms::others_exec, fs::perm_options::replace, ec);
}

bool run_git(const fs::path& dir, const std::vector<std::string>& args) {
    std::vector<std::string> argv{"git", "-c", "user.name=gm-witness", "-c", "user.email=gm-witness@example.invalid", "-c", "commit.gpgsign=false"};
    argv.insert(argv.end(), args.begin(), args.end());
    return succeeded(proc::run(argv, dir, {}, kRunLimitMs));
}

bool make_repo(const fs::path& repo, const std::string& file) {
    std::error_code ec;
    fs::create_directories(repo / "native", ec);
    fs::create_directories(repo / "defaults", ec);
    std::ofstream(repo / "native" / file) << file << "\n";
    std::ofstream(repo / "defaults" / file) << file << "\n";
    return run_git(repo, {"init", "-q"}) && run_git(repo, {"add", "-A"}) && run_git(repo, {"commit", "-q", "-m", "first"});
}

std::optional<std::string> stamp_state(const fs::path& script, const fs::path& tree, const fs::path& header, std::string& why) {
    const proc::Outcome run = proc::run({"cmake", "-DSOURCE_DIR=" + tree.string(), "-DOUTPUT=" + header.string(), "-P", script.string()}, {}, {}, kRunLimitMs);
    if (!succeeded(run)) {
        why = "cmake exited " + std::to_string(run.exit_code) + " (started " + std::to_string(run.started) + ", timed out " + std::to_string(run.timed_out) + "): " + run.err.substr(0, 200) + run.out.substr(0, 200);
        return std::nullopt;
    }
    std::ifstream in(header);
    for (std::string line; std::getline(in, line);) {
        const auto at = line.find("kBuildState");
        if (at == std::string::npos) continue;
        std::size_t cursor = line.find('=', at) + 1;
        while (cursor < line.size() && !std::isalpha(static_cast<unsigned char>(line[cursor]))) ++cursor;
        std::string state;
        while (cursor < line.size() && std::isalpha(static_cast<unsigned char>(line[cursor]))) state += line[cursor++];
        return state.empty() ? std::nullopt : std::optional<std::string>(state);
    }
    why = "no kBuildState line in " + header.string();
    return std::nullopt;
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

}

CheckResult check_update_stream(const std::string& binary) {
    CheckResult result;
#if !defined(__linux__)
    result.summary = "skipped (not on this platform: the check stages a release archive with tar and sha256sum)";
    return result;
#else
    const auto started = Clock::now();
    const fs::path cwd = fs::current_path();
    const fs::path script = cwd / "cmake" / "gmnew_stamp.cmake";
    if (!fs::exists(script)) {
        result.failures.push_back("the stamp script is not at " + script.string() + "; run the check from the checkout root");
        return result;
    }
    const fs::path scratch = fs::temp_directory_path() / ("gm-update-stream-" + std::to_string(started.time_since_epoch().count()));
    const Scratch guard{scratch};
    std::error_code ec;
    fs::create_directories(scratch, ec);

    std::vector<std::string> states;
    const std::vector<std::string> cases{"clean", "dirty", "unpushed", "clean-at-origin"};
    for (const std::string& name : cases) {
        const fs::path repo = scratch / ("repo-" + name);
        const std::string expected = name == "clean-at-origin" ? "clean" : name;
        if (!make_repo(repo, name + ".txt")) {
            result.failures.push_back(name + ": could not create the throwaway repository");
            continue;
        }
        if (name == "dirty") std::ofstream(repo / "native" / "untracked.txt") << "untracked\n";
        if (name == "unpushed") {
            std::ofstream(repo / "native" / "second.txt") << "second\n";
            run_git(repo, {"add", "-A"});
            run_git(repo, {"commit", "-q", "-m", "second"});
            run_git(repo, {"update-ref", "refs/remotes/origin/main", "HEAD~1"});
        }
        if (name == "clean-at-origin") run_git(repo, {"update-ref", "refs/remotes/origin/main", "HEAD"});
        std::string why;
        const auto state = stamp_state(script, repo, scratch / (name + ".hpp"), why);
        if (!state) {
            result.failures.push_back(name + ": the stamp script did not produce a build state: " + why);
            continue;
        }
        states.push_back(name + "=" + *state);
        if (*state == "dirty") {
            std::stringstream header;
            header << std::ifstream(scratch / (name + ".hpp")).rdbuf();
            if (header.str().find("native/untracked.txt") == std::string::npos) result.failures.push_back(name + ": the stamp header does not name the uncommitted path");
        }
        if (*state != expected) result.failures.push_back(name + ": the stamp says " + *state + ", expected " + expected);
    }
    std::string checkout_why;
    const auto checkout_state = stamp_state(script, cwd, scratch / "checkout.hpp", checkout_why);
    if (!checkout_state) {
        result.failures.push_back("the stamp script did not produce a build state for the checkout: " + checkout_why);
        return result;
    }

    const auto version_line = proc::run({binary, "--version"}, {}, {}, kStampLimitMs).out;
    std::istringstream words(version_line);
    std::vector<std::string> fields;
    for (std::string field; words >> field;) fields.push_back(field);
    const auto built = fields.size() >= 3 ? whole_number(fields.back()) : std::nullopt;
    if (fields.empty() || !built) {
        result.failures.push_back("the build prints no commit time: " + version_line.substr(0, 200));
        return result;
    }
    const std::string stamp = fields.front();

    const std::string archive_name = std::string("gmnew-") + kPlatformTarget + ".tar.gz";
    const fs::path pack = scratch / "pack";
    const fs::path staged = pack / (std::string("gmnew-") + kPlatformTarget);
    const fs::path archive = scratch / archive_name;
    for (const char* name : {"leaves", "skills", "defaults"}) fs::create_directories(staged / name, ec);
    const std::string offered = "ffff333-7";
    std::ofstream(staged / "gm") << "#!/bin/sh\necho \"" << offered << " (ffff333) " << (*built + 2 * kCommitStep) << "\"\n";
    make_executable(staged / "gm");
    std::ofstream(staged / "gm-core") << "placeholder\n";
    if (!succeeded(proc::run({"tar", "-czf", archive.string(), "-C", pack.string(), staged.filename().string()}, {}, {}, kRunLimitMs))) {
        result.failures.push_back("could not pack the release archive " + archive.string());
        return result;
    }
    const std::string digest = first_word(proc::run({"sha256sum", archive.string()}, {}, {}, kRunLimitMs).out);
    const std::uintmax_t size = fs::file_size(archive, ec);
    const std::string head_full = first_word(proc::run({"git", "rev-parse", "HEAD"}, cwd, {}, kRunLimitMs).out);
    if (digest.empty() || ec || head_full.size() != 40) {
        result.failures.push_back("could not hash the archive or read HEAD of the checkout");
        return result;
    }

    struct Leg {
        const char* label;
        std::string commit;
        std::string version;
        std::int64_t committed;
        bool automatic;
    };
    const std::vector<Leg> legs{
        {"forced update, newer commit", std::string(40, 'e'), offered, *built + kCommitStep, false},
        {"forced update, same commit as this build", head_full, "ffff333-8", *built + 2 * kCommitStep, false},
        {"automatic update, newer commit", std::string(40, 'e'), offered, *built + kCommitStep, true},
    };
    std::vector<std::string> outcomes;
    for (std::size_t index = 0; index < legs.size(); ++index) {
        const Leg& leg = legs[index];
        const fs::path root = scratch / ("leg-" + std::to_string(index));
        const fs::path install = root / "install";
        const fs::path published = root / "published";
        fs::create_directories(install / "versions" / stamp, ec);
        fs::create_directories(published, ec);
        fs::copy_file(archive, published / archive_name, fs::copy_options::overwrite_existing, ec);
        const fs::path installed_gm = install / "versions" / stamp / "gm";
        fs::copy_file(binary, installed_gm, fs::copy_options::overwrite_existing, ec);
        make_executable(installed_gm);
        fs::create_directory_symlink(fs::path("versions") / stamp, install / "current", ec);

        json::Value manifest = json::Object{
            {"version", leg.version},
            {"commit", leg.commit},
            {"built", "2026-11-19T00:00:00Z"},
            {"repo", "AnEntrypoint/gm"},
            {"assets", json::Object{{kPlatformTarget, json::Value(json::Object{{"file", archive_name}, {"sha256", digest}, {"size", static_cast<std::uint64_t>(size)}, {"version", leg.version}, {"committed", static_cast<std::uint64_t>(leg.committed)}})}}}};
        std::ofstream(published / "manifest.json") << json::dump(manifest);
        const std::string url = "file://" + (published / "manifest.json").string();
        std::vector<std::string> argv{"env", "GMNEW_UPDATE_URL=" + url, (install / "current" / "gm").string(), "update"};
        if (leg.automatic) argv.push_back("--auto");
        const proc::Outcome run = proc::run(argv, {}, {}, kRunLimitMs);
        const std::optional<json::Value> reply = reply_of(run.out);
        if (!reply) {
            result.failures.push_back(std::string(leg.label) + ": gm update printed no JSON reply: " + run.out.substr(0, 200) + run.err.substr(0, 200));
            continue;
        }
        const std::string status = text_of(*reply, "status");
        const std::string linked = fs::read_symlink(install / "current", ec).filename().string();
        const std::string reported = first_word(proc::run({(install / "current" / "gm").string(), "--version"}, {}, {}, kStampLimitMs).out);

        if (leg.automatic && checkout_state != std::string("clean")) {
            if (flag_of(*reply, "updated") || linked != stamp || status.rfind("auto update off:", 0) != 0) result.failures.push_back(std::string(leg.label) + ": a " + *checkout_state + " build replaced itself (status '" + status + "', link " + linked + ")");
            outcomes.push_back("automatic update refused on a " + *checkout_state + " build ('" + status + "')");
            continue;
        }
        if (leg.commit == head_full) {
            if (flag_of(*reply, "updated") || status != "already current" || linked != stamp) result.failures.push_back(std::string(leg.label) + ": a manifest on the same commit was taken (status '" + status + "', link " + linked + ")");
            outcomes.push_back(std::string(leg.label) + ": already current, link unchanged");
            continue;
        }
        if (!flag_of(*reply, "updated") || text_of(*reply, "to") != leg.version || linked != leg.version) {
            result.failures.push_back(std::string(leg.label) + ": the link did not switch to " + leg.version + " (link " + linked + ", reply " + json::dump(*reply).substr(0, 200) + ")");
            continue;
        }
        if (reported != leg.version) result.failures.push_back(std::string(leg.label) + ": the new build reports '" + reported + "', not " + leg.version);
        outcomes.push_back(std::string(leg.label) + ": link switched to " + leg.version + ", which reports itself");
    }

    const double wall = std::chrono::duration<double>(Clock::now() - started).count();
    if (result.failures.empty()) {
        std::string summary = "stamp states";
        for (const std::string& state : states) summary += " " + state;
        summary += "; checkout " + *checkout_state + "; live build " + stamp + ":";
        for (const std::string& outcome : outcomes) summary += " " + outcome + ";";
        result.summary = summary + " (wall " + std::to_string(wall) + " s)";
    }
    return result;
#endif
}

}
