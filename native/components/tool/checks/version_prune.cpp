#include "gm/tool.hpp"
#include "support.hpp"
#if !defined(_WIN32)

#include <chrono>
#include <filesystem>
#include <fstream>
#include <system_error>
#include <thread>

namespace gm::tool {
namespace fs = std::filesystem;

namespace {

struct Sandbox {
    fs::path scratch;
    fs::path home;
    fs::path root;
    fs::path repo;
    fs::path host;
    fs::path build;
    std::string version;
};

bool make_sandbox(const std::string& binary, Sandbox& box, std::string& why) {
    box.host = fs::path(binary).parent_path();
    box.build = box.host.parent_path().parent_path().parent_path();
    for (fs::path dir = fs::current_path();; dir = dir.parent_path()) {
        std::error_code ec;
        if (fs::exists(dir / "skills" / "gm" / "SKILL.md", ec)) {
            box.repo = dir;
            break;
        }
        if (dir == dir.parent_path()) break;
    }
    if (box.repo.empty()) {
        why = "run from the checkout: no skills/gm/SKILL.md in the working directory or its parents";
        return false;
    }
    box.scratch = fs::temp_directory_path() / ("gm-version-prune-" + std::to_string(std::chrono::steady_clock::now().time_since_epoch().count() % 1000000));
    box.home = box.scratch / "home";
    box.root = box.home / ".gmnew";
    fs::create_directories(box.home);
    return true;
}

proc::Outcome install(const Sandbox& box) { return proc::run(support::install_argv(box.home, box.host / "gm", box.build, box.repo), box.repo, {}, 120000); }

bool first_install(Sandbox& box, std::string& why) {
    const auto installed = install(box);
    if (!installed.started || installed.exit_code != 0) {
        why = "gm install --local failed: " + support::failure_text(installed);
        return false;
    }
    std::error_code ec;
    box.version = fs::read_symlink(box.root / "current", ec).filename().string();
    return !box.version.empty();
}

void copy_version(const Sandbox& box, const std::string& name) { fs::copy(box.root / "versions" / box.version, box.root / "versions" / name, fs::copy_options::recursive); }

void point_current(const Sandbox& box, const std::string& name) {
    std::error_code ec;
    fs::remove(box.root / "current.test", ec);
    fs::create_directory_symlink(fs::path("versions") / name, box.root / "current.test", ec);
    fs::rename(box.root / "current.test", box.root / "current", ec);
}

bool has(const Sandbox& box, const std::string& name) {
    std::error_code ec;
    return fs::exists(box.root / "versions" / name, ec);
}

bool any_retired(const Sandbox& box) {
    std::error_code ec;
    for (const auto& entry : fs::directory_iterator(box.root / "versions", ec))
        if (entry.path().filename().string().find(".retired-") != std::string::npos) return true;
    return false;
}

}

CheckResult check_version_prune(const std::string& binary) {
    CheckResult result;
    Sandbox box;
    std::string why;
    if (!make_sandbox(binary, box, why) || !first_install(box, why)) {
        result.failures.push_back(why);
        return result;
    }
    auto expect = [&](bool condition, const std::string& what) {
        if (!condition) result.failures.push_back(what);
    };
    for (const char* name : {"old1-dev", "old2-dev", "old3-dev"}) copy_version(box, name);
    fs::create_directories(box.root / "versions" / "foreign-keep");
    std::ofstream(box.root / "versions" / "foreign-keep" / "note.txt") << "not written by the updater\n";
    std::ofstream(box.root / "previous-notes.txt") << "not a link\n";
    std::error_code ec;
    for (const char* name : {"old1-dev", "old2-dev"}) fs::create_directory_symlink(fs::path("versions") / name, box.root / (std::string("previous-") + name), ec);
    const fs::path sleeper = box.root / "versions" / "old2-dev" / "sleep";
    fs::copy_file("/bin/sleep", sleeper, fs::copy_options::overwrite_existing, ec);
    proc::SpawnOptions options(box.scratch);
    auto spawned = proc::Child::spawn({sleeper.string(), "300"}, options);
    expect(static_cast<bool>(spawned), "could not start a process from versions/old2-dev");
    point_current(box, "old3-dev");

    auto second = install(box);
    expect(second.started && second.exit_code == 0, "the second install failed: " + support::failure_text(second));
    expect(second.out.find("pruned") != std::string::npos && second.out.find("freed") != std::string::npos, "the install did not report what it pruned: " + second.out.substr(0, 400));
    expect(!has(box, "old1-dev"), "versions/old1-dev, written by the updater and neither current, previous nor in use, was not pruned");
    expect(has(box, "old2-dev") && second.out.find("old2-dev") != std::string::npos, "versions/old2-dev was removed or not named while a process runs from it");
    expect(has(box, "old3-dev"), "versions/old3-dev, the version that was current before the switch, was pruned: it is the rollback");
    expect(!any_retired(box), "the retired copy of the reinstalled version was not pruned");
    expect(has(box, "foreign-keep"), "a directory without the updater's marker was removed");
    expect(fs::exists(box.root / "previous-notes.txt"), "a regular file named like a previous link was removed");
    expect(fs::is_symlink(box.root / "previous-old3-dev") && !fs::is_symlink(box.root / "previous-old1-dev") && !fs::exists(box.root / "previous-old2-dev", ec), "the previous links were not reduced to the one that names the rollback");
    expect(fs::exists(box.root / "pw"), "the playwriter directory was removed");

    if (spawned) {
        (*spawned)->kill();
        std::this_thread::sleep_for(std::chrono::milliseconds(300));
    }
    point_current(box, "old3-dev");
    auto third = install(box);
    expect(third.started && third.exit_code == 0 && !has(box, "old2-dev"), "versions/old2-dev was not pruned after its process ended: " + third.out.substr(0, 300));
    expect(has(box, "old3-dev") && has(box, "foreign-keep"), "the rollback or the foreign directory was lost on the third install");

    std::error_code ignored;
    fs::remove_all(box.scratch, ignored);
    result.summary = "after an install the updater's old versions are pruned except the current one, the one current before (the rollback) and any a live process runs from; a directory without the marker, a regular file named like a link and the pw directory are untouched; the previous links are reduced to the rollback's; the in-use version is pruned once its process ends";
    return result;
}

CheckResult check_version_rollback(const std::string& binary) {
    CheckResult result;
    Sandbox box;
    std::string why;
    if (!make_sandbox(binary, box, why) || !first_install(box, why)) {
        result.failures.push_back(why);
        return result;
    }
    const auto reference = proc::run({(box.root / "versions" / box.version / "gm").string(), "--version"}, box.scratch, {}, 30000);
    copy_version(box, "before-dev");
    point_current(box, "before-dev");
    const auto switched = install(box);
    if (!switched.started || switched.exit_code != 0) result.failures.push_back("the install over before-dev failed: " + support::failure_text(switched));
    std::error_code ec;
    if (fs::read_symlink(box.root / "current", ec).filename() != box.version) result.failures.push_back("current does not name the new version " + box.version);
    if (!has(box, "before-dev")) result.failures.push_back("the rollback version before-dev did not survive the switch");
    point_current(box, "before-dev");
    const auto rolled = proc::run({(box.root / "current" / "gm").string(), "--version"}, box.scratch, {}, 30000);
    if (!rolled.started || rolled.exit_code != 0 || rolled.out != reference.out) result.failures.push_back("the rollback version does not run as a complete install: exit " + std::to_string(rolled.exit_code) + " out " + rolled.out.substr(0, 120));
    const auto skills = box.root / "current" / "skills" / "gm" / "SKILL.md";
    if (!fs::exists(skills) || !fs::exists(box.root / "current" / "gm-core") || !fs::exists(box.root / "current" / "defaults")) result.failures.push_back("the rollback version is missing files after the switch");
    std::error_code ignored;
    fs::remove_all(box.scratch, ignored);
    result.summary = "the version that was current before an install survives it complete, and pointing current back at it runs the same gm --version";
    return result;
}

}
#else

namespace gm::tool {

CheckResult check_version_prune(const std::string&) {
    CheckResult result;
    result.summary = "skipped: POSIX-only check, runs on Linux and macOS";
    return result;
}

CheckResult check_version_rollback(const std::string&) {
    CheckResult result;
    result.summary = "skipped: POSIX-only check, runs on Linux and macOS";
    return result;
}

}
#endif
