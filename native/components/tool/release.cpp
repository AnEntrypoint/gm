#include "gm/tool.hpp"

#include <algorithm>
#include <chrono>
#include <cstddef>
#include <ctime>
#include <exception>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <map>
#include <optional>
#include <regex>
#include <set>
#include <sstream>
#include <system_error>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

std::map<std::string, std::string> options(const std::vector<std::string>& args) {
    std::map<std::string, std::string> values;
    for (std::size_t i = 1; i + 1 < args.size(); i += 2) {
        if (args[i].rfind("--", 0) == 0) values[args[i].substr(2)] = args[i + 1];
    }
    return values;
}

std::string option(const std::map<std::string, std::string>& values, const std::string& key) {
    const auto found = values.find(key);
    return found == values.end() ? std::string() : found->second;
}

bool ends_with(const std::string& text, const std::string& suffix) {
    return text.size() >= suffix.size() && text.compare(text.size() - suffix.size(), suffix.size(), suffix) == 0;
}

std::string read_file(const fs::path& file) {
    std::ifstream in(file, std::ios::binary);
    std::ostringstream text;
    text << in.rdbuf();
    return text.str();
}

bool write_file(const fs::path& file, const std::string& text) {
    std::ofstream out(file, std::ios::binary);
    out << text;
    return static_cast<bool>(out);
}

std::string sha256_of(const fs::path& file) {
    const auto hashed = proc::run({"sha256sum", file.string()});
    if (!hashed.started || hashed.exit_code != 0) return {};
    return hashed.out.substr(0, 64);
}

std::string utc_now() {
    const auto now = std::chrono::system_clock::now();
    const auto seconds = std::chrono::system_clock::to_time_t(now);
    const auto millis = std::chrono::duration_cast<std::chrono::milliseconds>(now.time_since_epoch()).count() % 1000;
    std::tm utc{};
#if defined(_WIN32)
    gmtime_s(&utc, &seconds);
#else
    gmtime_r(&seconds, &utc);
#endif
    std::ostringstream text;
    text << std::put_time(&utc, "%Y-%m-%dT%H:%M:%S") << '.' << std::setw(3) << std::setfill('0') << millis << 'Z';
    return text.str();
}

std::string trimmed(const std::string& text) {
    const auto first = text.find_first_not_of(" \t\r\n");
    if (first == std::string::npos) return {};
    const auto last = text.find_last_not_of(" \t\r\n");
    return text.substr(first, last - first + 1);
}

std::optional<std::int64_t> committed_of(const std::string& commit) {
    if (commit.empty()) return std::nullopt;
    const auto logged = proc::run({"git", "log", "-1", "--format=%ct", commit});
    if (!logged.started || logged.exit_code != 0) return std::nullopt;
    const std::string digits = trimmed(logged.out);
    if (digits.empty() || digits.find_first_not_of("0123456789") != std::string::npos) return std::nullopt;
    return std::stoll(digits);
}

std::string text_of(const json::Value* value) {
    return value != nullptr && value->is_string() ? value->as_string() : std::string();
}

}

int package_command(const fs::path& root, const std::vector<std::string>& args) {
    const auto values = options(args);
    const std::string target = option(values, "target");
    const std::string build = option(values, "build-dir");
    const std::string out_text = option(values, "out");
    if (target.empty() || build.empty() || out_text.empty()) {
        std::cerr << "gm-tool package: needs --target, --build-dir and --out\n";
        return 2;
    }
    const bool windows = ends_with(target, "-windows");
    const fs::path host = fs::absolute(build) / "native" / "components" / "host";
    const std::vector<std::string> executables = windows ? std::vector<std::string>{"gm.exe", "gm-core.exe"} : std::vector<std::string>{"gm", "gm-core"};
    for (const auto& exe : executables) {
        if (!fs::exists(host / exe)) {
            std::cerr << "gm-tool package: missing executable: " << (host / exe).string() << "\n";
            return 1;
        }
    }
    const fs::path out = fs::absolute(out_text);
    const std::string name = "gmnew-" + target;
    const fs::path stage = out / name;
    fs::remove_all(stage);
    fs::create_directories(stage);
    for (const auto& exe : executables) {
        fs::copy_file(host / exe, stage / exe, fs::copy_options::overwrite_existing);
        if (windows) continue;
        std::vector<std::string> strip{"strip"};
        if (ends_with(target, "-macos")) strip.push_back("-x");
        strip.push_back((stage / exe).string());
        const auto stripped = proc::run(strip);
        if (!stripped.started) {
            std::cerr << "gm-tool package: strip not found on PATH; install binutils (linux) or the Xcode command line tools (macos)\n";
            return 1;
        }
        if (stripped.exit_code != 0) {
            std::cerr << "gm-tool package: strip exited " << stripped.exit_code << " for " << exe << "\n";
            return 1;
        }
    }
    const std::pair<std::string, fs::path> runtime[] = {{"leaves", root / "native" / "leaves"}, {"skills", root / "skills"}, {"defaults", root / "defaults"}};
    for (const auto& [dir, source] : runtime) fs::copy(source, stage / dir, fs::copy_options::recursive);

    const fs::path archive = out / (windows ? name + ".zip" : name + ".tar.gz");
    fs::remove(archive);
    const proc::Outcome packed = windows
        ? proc::run({"powershell", "-NoProfile", "-NonInteractive", "-Command",
                     "Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory('" + stage.string() + "', '" + archive.string() + "', 'Optimal', $true)"})
        : proc::shell("COPYFILE_DISABLE=1 tar -czf '" + archive.string() + "' -C '" + out.string() + "' '" + name + "'");
    if (!packed.started || packed.exit_code != 0) {
        std::cerr << "gm-tool package: archive failed: " << (packed.err.empty() ? packed.out : packed.err) << "\n";
        return packed.exit_code > 0 ? packed.exit_code : 1;
    }
    fs::remove_all(stage);
    std::cout << archive.string() << "\n";
    return 0;
}

int release_manifest_command(const std::vector<std::string>& args) {
    const auto values = options(args);
    const fs::path dir = option(values, "dir");
    const std::string version = option(values, "version");
    const std::string commit = option(values, "commit");
    const std::string repo = option(values, "repo");
    const std::string previous_path = option(values, "previous");
    const std::string present_path = option(values, "present");
    const std::string summary_path = option(values, "summary");
    const std::optional<std::int64_t> committed = committed_of(commit);

    std::optional<json::Value> previous;
    if (!previous_path.empty() && fs::exists(previous_path)) {
        if (auto parsed = json::parse(read_file(previous_path))) {
            previous = *parsed;
        } else {
            std::cerr << "gm-tool release-manifest: the previous manifest is not JSON: " << previous_path << "\n";
            return 1;
        }
    }
    std::set<std::string> present;
    if (!present_path.empty() && fs::exists(present_path)) {
        std::istringstream lines(read_file(present_path));
        std::string line;
        while (std::getline(lines, line)) {
            const std::string name = trimmed(line);
            if (!name.empty()) present.insert(name);
        }
    }

    const std::regex archive_name(R"(^gmnew-.+\.(tar\.gz|zip)$)");
    std::vector<std::string> archives;
    std::error_code ec;
    for (const auto& entry : fs::directory_iterator(dir, ec)) {
        const std::string file = entry.path().filename().string();
        if (std::regex_match(file, archive_name)) archives.push_back(file);
    }
    std::sort(archives.begin(), archives.end());
    if (archives.empty()) {
        std::cerr << "gm-tool release-manifest: no target built in this push\n";
        return 1;
    }

    const std::regex target_pattern(R"((x64|arm64)-(linux|macos|windows))");
    const std::vector<std::string> expected{"x64-linux", "arm64-linux", "x64-macos", "arm64-macos", "x64-windows", "arm64-windows"};
    json::Object assets;
    std::vector<std::string> sums;
    std::vector<std::string> rows;
    auto has_asset = [&](const std::string& target) {
        return std::any_of(assets.begin(), assets.end(), [&](const json::Member& member) { return member.first == target; });
    };
    for (const auto& file : archives) {
        std::smatch match;
        std::regex_search(file, match, target_pattern);
        const std::string target = match.str(0);
        const fs::path path = dir / file;
        const std::string sha = sha256_of(path);
        json::Object entry{{"file", file}, {"sha256", sha}, {"size", static_cast<std::int64_t>(fs::file_size(path))}, {"version", version}};
        if (committed) entry.push_back({"committed", *committed});
        assets.push_back({target, json::Value(entry)});
        sums.push_back(sha + "  " + file);
        rows.push_back("| " + target + " | built this push | " + file + " |");
    }
    const json::Value* previous_assets = previous ? previous->find("assets") : nullptr;
    for (const auto& target : expected) {
        if (has_asset(target)) continue;
        const json::Value* old = previous_assets != nullptr && previous_assets->is_object() ? previous_assets->find(target) : nullptr;
        const std::string old_file = text_of(old != nullptr && old->is_object() ? old->find("file") : nullptr);
        if (old != nullptr && old->is_object() && present.count(old_file) > 0) {
            std::string old_version = text_of(old->find("version"));
            if (old_version.empty() && previous) old_version = text_of(previous->find("version"));
            json::Object kept;
            for (const auto& member : old->as_object()) {
                if (member.first == "version") continue;
                kept.push_back(member);
            }
            kept.push_back({"version", old_version});
            assets.push_back({target, json::Value(kept)});
            sums.push_back(text_of(old->find("sha256")) + "  " + old_file);
            rows.push_back("| " + target + " | failed this push; stays on " + old_version + " | " + old_file + " |");
            std::cout << "::warning::" << target << " did not build in this push; its manifest entry keeps " << old_version << "\n";
        } else {
            rows.push_back("| " + target + " | failed this push; no earlier build on the release | none |");
            std::cout << "::error::" << target << " did not build and has no earlier build on the release\n";
        }
    }

    const json::Value manifest = json::Object{{"version", version}, {"commit", commit}, {"built", utc_now()}, {"repo", repo}, {"assets", json::Value(assets)}};
    write_file(dir / "manifest.json", json::dump(manifest) + "\n");
    std::string sum_text;
    for (const auto& line : sums) sum_text += line + "\n";
    write_file(dir / "SHA256SUMS", sum_text);

    std::string table = "### Targets in " + version + " (" + commit + ")\n\n| target | status | archive |\n| --- | --- | --- |\n";
    for (const auto& row : rows) table += row + "\n";
    std::cout << table << "\n";
    if (!summary_path.empty()) {
        std::ofstream summary(summary_path, std::ios::app);
        summary << table << "\n";
    }
    return 0;
}

int prune_assets_command(const std::vector<std::string>& args) {
    const auto values = options(args);
    const std::string keep_text = option(values, "keep").empty() ? std::string("3") : option(values, "keep");
    if (keep_text.empty() || keep_text.find_first_not_of("0123456789") != std::string::npos || std::stoll(keep_text) < 1) {
        std::cerr << "gm-tool prune-release-assets: --keep must be a positive integer\n";
        return 2;
    }
    const auto keep = static_cast<std::size_t>(std::stoll(keep_text));

    std::vector<std::string> names;
    std::string line;
    while (std::getline(std::cin, line)) {
        const std::string name = trimmed(line);
        if (!name.empty()) names.push_back(name);
    }
    const std::regex versioned(R"(^gmnew-(.+)-(x64|arm64)-(linux|macos|windows)\.(tar\.gz|zip)$)");
    const std::regex archive_name(R"(^gmnew-.*\.(tar\.gz|zip)$)");
    auto run_of = [](const std::string& version) {
        const auto dash = version.rfind('-');
        try {
            return std::stoll(version.substr(dash == std::string::npos ? 0 : dash + 1));
        } catch (const std::exception&) {
            return 0LL;
        }
    };
    std::set<std::string> seen;
    for (const auto& name : names) {
        std::smatch match;
        if (std::regex_match(name, match, versioned)) seen.insert(match.str(1));
    }
    std::vector<std::string> versions(seen.begin(), seen.end());
    std::sort(versions.begin(), versions.end(), [&](const std::string& a, const std::string& b) { return run_of(a) > run_of(b); });
    const std::set<std::string> retained(versions.begin(), versions.begin() + static_cast<std::ptrdiff_t>(std::min(keep, versions.size())));
    for (const auto& name : names) {
        if (!std::regex_match(name, archive_name)) continue;
        std::smatch match;
        if (!std::regex_match(name, match, versioned) || retained.count(match.str(1)) == 0) std::cout << name << "\n";
    }
    return 0;
}

}
