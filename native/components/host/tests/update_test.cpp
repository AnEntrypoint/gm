#include <chrono>
#include <cstdint>
#include <fstream>
#include <iostream>
#include <iterator>
#include <string>

#include "gm/host/update.hpp"
#include "gm/mcp.hpp"
#include "gm/proc.hpp"

namespace {

namespace fs = std::filesystem;
using namespace gm::host;

int failures = 0;

void check(bool ok, const std::string& what) {
    std::cout << (ok ? "ok   " : "FAIL ") << what << '\n';
    if (!ok) ++failures;
}

void write_text(const fs::path& path, const std::string& text) {
    fs::create_directories(path.parent_path());
    std::ofstream out(path, std::ios::binary | std::ios::trunc);
    out << text;
}

std::string read_text(const fs::path& path) {
    std::ifstream in(path, std::ios::binary);
    return std::string((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
}

void make_build(const fs::path& root, const std::string& mark) {
    write_text(root / executable_name(), mark);
    write_text(root / core_executable_name(), mark);
    write_text(root / "leaves" / "core.mjs", mark);
    write_text(root / "skills" / "gm" / "SKILL.md", mark);
    write_text(root / "defaults" / "mcp.json", mark);
}

std::string file_url(const fs::path& path) {
    std::string text = path.generic_string();
    if (text.empty() || text.front() != '/') text = "/" + text;
    return "file://" + text;
}

const std::string kVersion = "abc1234-7";
const std::string kCommit = "abc1234def5678";

struct Release {
    fs::path manifest;
    std::string url;
};

Release make_release(const fs::path& dir, const std::string& mark, const std::string& digest_override = {}) {
    const std::string target = target_name();
    const fs::path tree = dir / "tree";
    make_build(tree / ("gmnew-" + target), mark);
    const fs::path archive = dir / ("gm-" + target + ".tar.gz");
    const gm::proc::Outcome packed =
        gm::proc::run({"tar", "-czf", archive.string(), "-C", tree.string(), "gmnew-" + target});
    check(packed.started && packed.exit_code == 0, "fixture archive for " + target + " is packed");

    const std::string bytes = read_text(archive);
    const std::string digest = digest_override.empty() ? gm::mcp::sha256_hex(bytes) : digest_override;
    const fs::path manifest = dir / "manifest.json";
    write_text(manifest,
               "{\"version\":\"" + kVersion + "\",\"commit\":\"" + kCommit +
                   "\",\"built\":\"2026-11-05T00:00:00Z\",\"repo\":\"AnEntrypoint/gmc\",\"assets\":{\"" + target +
                   "\":{\"file\":\"gm-" + target + ".tar.gz\",\"sha256\":\"" + digest +
                   "\",\"size\":" + std::to_string(bytes.size()) + "},\"other-target\":{\"file\":\"x.tar.gz\",\"sha256\":\"00\",\"size\":1}}}");
    return {manifest, file_url(manifest)};
}

UpdatePolicy policy_for(const fs::path& install, const std::string& url, const std::string& current) {
    UpdatePolicy policy;
    policy.url = url;
    policy.install_dir = install;
    policy.current_version = current;
    policy.enabled = true;
    return policy;
}

void manifest_parsing() {
    const std::string text =
        "{\"version\":\"abc1234-7\",\"commit\":\"abc1234def\",\"built\":\"t\",\"repo\":\"r\","
        "\"assets\":{\"x64-linux\":{\"file\":\"gm-x64-linux.tar.gz\",\"sha256\":\"ff\",\"size\":123}}}";
    const auto manifest = parse_manifest(text);
    check(manifest.has_value(), "a release manifest parses");
    if (!manifest) return;
    check(manifest->version == "abc1234-7" && manifest->commit == "abc1234def", "the manifest version and commit are read");
    const auto asset = manifest->assets.find("x64-linux");
    check(asset != manifest->assets.end() && asset->second.file == "gm-x64-linux.tar.gz" &&
              asset->second.sha256 == "ff" && asset->second.size == 123,
          "an asset keeps its file, sha256 and size");
    check(!parse_manifest("not json").has_value(), "text that is not JSON is refused");
    check(!parse_manifest("{\"version\":\"1-2\"}").has_value(), "a manifest without assets is refused");
}

void version_comparison() {
    const Manifest manifest = parse_manifest("{\"version\":\"abc1234-7\",\"commit\":\"abc1234def\",\"assets\":{}}").value();
    check(is_newer(manifest, "abc0000-3"), "a higher run number from another commit is newer");
    check(!is_newer(manifest, "abc1234-7"), "the same version is not newer");
    check(!is_newer(manifest, "abc1234-9"), "the same commit is not newer, whatever the run");
    check(!is_newer(manifest, "zzz9999-9"), "a lower run number is not newer");
    check(is_newer(manifest, "dev"), "a dev build takes any release when updated by hand");
}

void refuses_bad_digest(const fs::path& root) {
    const fs::path install = root / "install-bad";
    make_build(install, "old");
    const Release release = make_release(root / "release-bad", "new", std::string(64, '0'));
    const UpdateResult result = update_now(policy_for(install, release.url, "abc0000-3"));
    check(!result.ok, "a sha256 mismatch is refused");
    check(result.error.find("sha256") != std::string::npos, "the refusal names the sha256 check");
    check(read_text(install / executable_name()) == "old" && read_text(install / "leaves" / "core.mjs") == "old",
          "a refused update leaves the installed build untouched");
    check(!fs::exists(install / ".gmnew-staging"), "a refused update removes its staging directory");
}

void swaps_and_keeps_previous(const fs::path& root) {
    const fs::path install = root / "install-good";
    make_build(install, "old");
    const Release release = make_release(root / "release-good", "new");
    const UpdateResult result = update_now(policy_for(install, release.url, "abc0000-3"));
    check(result.ok && result.updated, "a newer release is downloaded, verified and installed");
    check(result.from == "abc0000-3" && result.to == kVersion, "the result names both versions");
    check(read_text(install / executable_name()) == "new" && read_text(install / "skills" / "gm" / "SKILL.md") == "new",
          "the executable and the shared directories are replaced");
    check(read_text(install / ".gmnew-previous" / executable_name()) == "old",
          "the previous executable is kept in the backup directory");
    check(!fs::exists(install / ".gmnew-staging"), "the staging directory is removed after a swap");
}

void same_version_is_a_no_op(const fs::path& root) {
    const fs::path install = root / "install-same";
    make_build(install, "old");
    const Release release = make_release(root / "release-same", "new");
    const UpdateResult result = update_now(policy_for(install, release.url, kVersion));
    check(result.ok && !result.updated, "the installed version is kept when the manifest is not newer");
    check(read_text(install / executable_name()) == "old", "a not-newer manifest changes nothing");
}

void missing_manifest_is_silent(const fs::path& root) {
    const fs::path install = root / "install-missing";
    make_build(install, "old");
    const UpdateResult result = update_now(policy_for(install, file_url(root / "absent" / "manifest.json"), "abc0000-3"));
    check(!result.ok && !result.error.empty(), "a missing manifest is reported as a failure, not a crash");
    check(read_text(install / executable_name()) == "old", "a failed fetch leaves the installed build untouched");
}

void rolls_back_a_failed_swap(const fs::path& root) {
    const fs::path install = root / "install-rollback";
    const fs::path staged = root / "staged-rollback";
    make_build(install, "old");
    make_build(staged, "new");
    const auto blocked = [](std::string_view name) { return name != "skills"; };
    const auto error = install_staged(staged, install, blocked);
    check(error.has_value(), "a swap that stops midway reports an error");
    check(read_text(install / executable_name()) == "old" && read_text(install / "leaves" / "core.mjs") == "old" &&
              read_text(install / "skills" / "gm" / "SKILL.md") == "old",
          "a failed swap rolls every replaced item back");
    check(read_text(staged / executable_name()) == "new", "the staged build is still there after a rollback");
}

using Reply = deoxidene::Result<ManifestReply, std::string>;

std::int64_t epoch_ms(std::chrono::milliseconds offset = {}) {
    return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch() + offset)
        .count();
}

void state_round_trips(const fs::path& root) {
    const fs::path install = root / "state";
    fs::create_directories(install);
    check(read_update_state(install).checked_ms == 0, "a missing state file reads as never checked");
    const UpdateState saved{1793836800000, "\"abc\"", kVersion};
    check(write_update_state(install, saved), "the state file is written");
    const UpdateState loaded = read_update_state(install);
    check(loaded.checked_ms == saved.checked_ms && loaded.etag == saved.etag && loaded.version == saved.version,
          "the state file reads back what was written");
    check(!fs::exists(install / ".gmnew-update.json.tmp"), "the state file leaves no temporary file behind");
}

void interval_skips_the_network(const fs::path& root) {
    const fs::path install = root / "install-fresh";
    make_build(install, "old");
    write_update_state(install, UpdateState{epoch_ms(), "\"fresh\"", "abc0000-3"});
    int fetches = 0;
    UpdatePolicy policy = policy_for(install, "https://unreachable.invalid/manifest.json", "abc0000-3");
    policy.fetch = [&fetches](const std::string&, const std::string&, const fs::path&) -> Reply {
        ++fetches;
        return deoxidene::Err<std::string>("the fetcher must not be called inside the interval");
    };
    const UpdateResult result = update_now(policy);
    check(result.ok && !result.updated && result.status == "already current" && fetches == 0,
          "a check inside the interval returns without touching the fetcher");
    check(read_update_state(install).etag == "\"fresh\"", "a skipped check leaves the state file as it was");
}

void not_modified_refreshes_the_check(const fs::path& root) {
    const fs::path install = root / "install-304";
    make_build(install, "old");
    const std::int64_t stale = epoch_ms(-std::chrono::hours(7));
    write_update_state(install, UpdateState{stale, "\"tag\"", "abc0000-3"});
    std::string sent_etag;
    UpdatePolicy policy = policy_for(install, "https://unreachable.invalid/manifest.json", "abc0000-3");
    policy.fetch = [&sent_etag](const std::string&, const std::string& etag, const fs::path&) -> Reply {
        sent_etag = etag;
        ManifestReply reply;
        reply.not_modified = true;
        return reply;
    };
    const UpdateResult result = update_now(policy);
    check(result.ok && !result.updated && result.status == "already current", "a 304 is reported as already current");
    check(sent_etag == "\"tag\"", "the stored etag is sent for the conditional request");
    const UpdateState after = read_update_state(install);
    check(after.checked_ms > stale && after.etag == "\"tag\"", "a 304 records the check time and keeps the etag");
    check(read_text(install / executable_name()) == "old", "a 304 downloads and installs nothing");
}

void lock_is_exclusive(const fs::path& root) {
    const fs::path install = root / "lock";
    const fs::path lock = install / ".gmnew-update.lock";
    fs::create_directories(install);
    check(acquire_update_lock(install), "the first updater takes the lock");
    check(!acquire_update_lock(install), "a second updater is refused while the lock is held");
    fs::remove_all(lock);
    check(acquire_update_lock(install), "the lock can be taken again once released");
    fs::last_write_time(lock, fs::file_time_type::clock::now() - std::chrono::minutes(31));
    check(acquire_update_lock(install), "a lock older than thirty minutes is taken over");
    fs::last_write_time(lock, fs::file_time_type::clock::now() - std::chrono::minutes(5));
    check(!acquire_update_lock(install), "a fresh lock is not taken over");
    fs::remove_all(lock);
    fs::create_directories(lock);
    std::ofstream(lock / "owner") << 2147483646 << '\n';
    check(acquire_update_lock(install), "a fresh lock whose owner has exited is taken over");
    fs::remove_all(lock);
}

void etag_is_read_from_the_last_response() {
    check(etag_from_headers("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nETag: \"abc\"\r\n\r\n").value_or("") == "\"abc\"",
          "the etag of a 200 is read with its quotes");
    check(etag_from_headers("HTTP/1.1 302 Found\r\netag: \"old\"\r\n\r\nHTTP/2 200\r\netag: W/\"new\"\r\n\r\n").value_or("") ==
              "W/\"new\"",
          "after a redirect the etag of the final response is used");
    check(!etag_from_headers("HTTP/1.1 200 OK\r\n\r\n").has_value(), "a response without an etag gives none");
}

}

int main() {
    const fs::path root = fs::temp_directory_path() / "gm-update-test";
    fs::remove_all(root);
    fs::create_directories(root);

    manifest_parsing();
    version_comparison();
    refuses_bad_digest(root);
    swaps_and_keeps_previous(root);
    same_version_is_a_no_op(root);
    missing_manifest_is_silent(root);
    rolls_back_a_failed_swap(root);
    state_round_trips(root);
    interval_skips_the_network(root);
    not_modified_refreshes_the_check(root);
    lock_is_exclusive(root);
    etag_is_read_from_the_last_response();

    fs::remove_all(root);
    std::cout << (failures == 0 ? "update_test passed" : "update_test FAILED") << '\n';
    return failures == 0 ? 0 : 1;
}
