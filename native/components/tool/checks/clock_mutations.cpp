#include "gm/tool.hpp"

#include <chrono>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <optional>
#include <sstream>
#include <system_error>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

constexpr std::uint64_t kBuildTimeoutMs = 580000;
constexpr std::uint64_t kCheckTimeoutMs = 300000;

struct Mutant {
    std::string name;
    fs::path relative;
    std::string from;
    std::string to;
    std::string check;
};

std::optional<std::string> read_text(const fs::path& path) {
    std::ifstream in(path, std::ios::binary);
    if (!in) return std::nullopt;
    return std::string((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
}

bool write_text(const fs::path& path, const std::string& text) {
    std::ofstream out(path, std::ios::binary | std::ios::trunc);
    out << text;
    return static_cast<bool>(out);
}

std::string last_chars(const std::string& text, std::size_t count) {
    return text.size() > count ? text.substr(text.size() - count) : text;
}

fs::path source_of(const fs::path& build) {
    std::ifstream cache(build / "CMakeCache.txt");
    const std::string key = "CMAKE_HOME_DIRECTORY:INTERNAL=";
    for (std::string line; std::getline(cache, line);)
        if (line.rfind(key, 0) == 0) return fs::path(line.substr(key.size()));
    for (fs::path dir = fs::current_path();; dir = dir.parent_path()) {
        std::error_code ec;
        if (fs::exists(dir / "skills" / "gm" / "SKILL.md", ec)) return dir;
        if (dir == dir.parent_path()) return {};
    }
}

proc::Outcome rebuild(const fs::path& build) {
    return proc::run({"cmake", "--build", build.string(), "-j", "4"}, {}, {}, kBuildTimeoutMs);
}

class EnvOverride {
public:
    EnvOverride(const char* name, const char* value) : name_(name) {
        if (const char* old = std::getenv(name)) previous_ = std::string(old);
        if (value) set_env(name, value);
        else unset_env(name);
    }
    ~EnvOverride() {
        if (previous_) set_env(name_, previous_->c_str());
        else unset_env(name_);
    }
    EnvOverride(const EnvOverride&) = delete;
    EnvOverride& operator=(const EnvOverride&) = delete;

private:
    const char* name_;
    std::optional<std::string> previous_;
};

class SourceRestorer {
public:
    SourceRestorer(fs::path build, CheckResult& result) : build_(std::move(build)), result_(result) {}
    ~SourceRestorer() {
        bool restored_any = false;
        for (const auto& kept : kept_) {
            const auto now = read_text(kept.path);
            if (!now || *now != kept.text) {
                if (!write_text(kept.path, kept.text)) result_.failures.push_back("could not restore " + kept.path.string());
            }
            restored_any = true;
        }
        if (restored_any) {
            const auto built = rebuild(build_);
            if (!built.started || built.exit_code != 0)
                result_.failures.push_back("the binary did not rebuild after the mutations were reverted: " + last_chars(built.out + built.err, 300));
        }
        for (const auto& kept : kept_) {
            std::error_code ec;
            fs::last_write_time(kept.path, kept.mtime, ec);
            if (ec) result_.failures.push_back("could not restore the mtime of " + kept.path.string() + ": " + ec.message());
        }
    }
    SourceRestorer(const SourceRestorer&) = delete;
    SourceRestorer& operator=(const SourceRestorer&) = delete;

    bool keep(const fs::path& path, const std::string& text) {
        std::error_code ec;
        const auto mtime = fs::last_write_time(path, ec);
        if (ec) return false;
        kept_.push_back({path, text, mtime});
        return true;
    }

    void put_back(const fs::path& path) {
        for (const auto& kept : kept_)
            if (kept.path == path) write_text(kept.path, kept.text);
    }

private:
    struct Kept {
        fs::path path;
        std::string text;
        fs::file_time_type mtime;
    };
    fs::path build_;
    CheckResult& result_;
    std::vector<Kept> kept_;
};

void scale_needs_test_clock(const std::string& binary, CheckResult& result) {
    const auto stamp = std::chrono::steady_clock::now().time_since_epoch().count();
    const fs::path sandbox = fs::temp_directory_path() / ("gm-clock-guard-" + std::to_string(stamp));
    const fs::path workspace = sandbox / "ws";
    fs::create_directories(workspace);
    std::ofstream(sandbox / "quiet.json") << R"({"mcpServers":{"playwriter":{"disabled":true}}})";
    {
        EnvOverride scale("GM_CLOCK_SCALE", "0.0167");
        EnvOverride test_clock("GMNEW_TEST_CLOCK", nullptr);
        Session session(binary, workspace, sandbox, 180000, true);
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + binary);
        } else {
            session.rpc("initialize", json::Object{{"protocolVersion", "2025-06-18"}, {"capabilities", json::Object{}},
                                                  {"clientInfo", json::Object{{"name", "clock-mutations"}, {"version", "1"}}}});
            session.notify("notifications/initialized", json::Object{});
            session.rpc("resources/read", json::Object{{"uri", "skill://gm/SKILL.md"}});
            tool_text(session, "next_context", json::Object{});
            const json::Value body = tool_json(session, "run_code",
                                               json::Object{{"format", "esm"}, {"body", "const end = Date.now() + 2000; while (Date.now() < end) {} return { spun: true };"}});
            const json::Value* ok = body.find("ok");
            const bool held = ok != nullptr && ok->is_bool() && ok->as_bool() && body.find("background") == nullptr;
            if (!held)
                result.failures.push_back("the scale was honoured without GMNEW_TEST_CLOCK: a 2000 ms body with no timeoutMs became " + json::dump(body).substr(0, 200));
        }
    }
    std::error_code ec;
    fs::remove_all(sandbox, ec);
}

}

CheckResult check_clock_mutations(const std::string& binary) {
    CheckResult result;
    const auto started = std::chrono::steady_clock::now();
    const fs::path host = fs::path(binary).parent_path();
    const fs::path build = host.parent_path().parent_path().parent_path();
    const fs::path tool = build / "native" / "components" / "tool" / "gm-tool";
    const fs::path source = source_of(build);
    std::error_code ec;
    if (source.empty() || !fs::exists(build / "CMakeCache.txt", ec) || !fs::exists(tool, ec)) {
        result.failures.push_back("the binary is not in a configured build tree with gm-tool: " + binary);
        return result;
    }
    const std::vector<Mutant> mutants{
        {"job lifetime 60 s", fs::path("native") / "components" / "mcp" / "include" / "gm" / "mcp.hpp", "std::uint64_t job_lifetime_ms = 3600000;",
         "std::uint64_t job_lifetime_ms = 60000;", "check-run-code-budget"},
        {"job wait cap 30 s", fs::path("native") / "components" / "verbs" / "job.cpp", "const double max_wait_ms = 60000 * clock_scale();",
         "const double max_wait_ms = 30000 * clock_scale();", "check-turn-economy"},
    };
    scale_needs_test_clock(binary, result);
    std::vector<std::string> caught;
    {
        SourceRestorer restorer(build, result);
        for (const auto& mutant : mutants) {
            const fs::path file = source / mutant.relative;
            const auto text = read_text(file);
            const std::size_t at = text ? text->find(mutant.from) : std::string::npos;
            if (at == std::string::npos) {
                result.failures.push_back(mutant.name + ": the source text to mutate is not in " + file.string());
                continue;
            }
            if (!restorer.keep(file, *text)) {
                result.failures.push_back(mutant.name + ": could not read the mtime of " + file.string());
                continue;
            }
            std::string mutated = *text;
            mutated.replace(at, mutant.from.size(), mutant.to);
            if (!write_text(file, mutated)) {
                result.failures.push_back(mutant.name + ": could not write the mutant to " + file.string());
                restorer.put_back(file);
                continue;
            }
            const auto built = rebuild(build);
            if (!built.started || built.exit_code != 0) {
                result.failures.push_back(mutant.name + ": the mutant did not build: " + last_chars(built.out + built.err, 300));
                restorer.put_back(file);
                continue;
            }
            const auto run = proc::run({tool.string(), "check", binary, mutant.check}, source, {}, kCheckTimeoutMs);
            restorer.put_back(file);
            if (run.started && run.exit_code == 0)
                result.failures.push_back(mutant.name + ": " + mutant.check + " passed on the mutant, so the scaled check does not prove this regression");
            else
                caught.push_back(mutant.name + " failed " + mutant.check + " (exit " + std::to_string(run.exit_code) + ")");
        }
    }
    const double wall = std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count();
    std::ostringstream summary;
    summary << "the scale is not honoured without GMNEW_TEST_CLOCK; ";
    for (const auto& line : caught) summary << line << "; ";
    summary << "the sources and their mtimes are restored and the binary rebuilt (wall " << wall << " s)";
    result.summary = summary.str();
    return result;
}

}
