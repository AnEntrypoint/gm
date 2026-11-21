#include "gm/tool.hpp"
#include "support.hpp"

#include <filesystem>
#include <string>
#include <system_error>
#include <vector>

namespace gm::tool {

CheckResult check_txiki_vendor(const std::string&) {
    CheckResult result;
    const std::filesystem::path root = support::checkout_root();
    if (root.empty()) {
        result.failures.push_back("run from the checkout: no skills/gm/SKILL.md in the working directory or its parents");
        return result;
    }
    const std::filesystem::path vendored = root / "native" / "third_party" / "txiki";
    const std::string manifest = support::read_text(vendored / "MANIFEST.sha256");
    if (manifest.empty()) {
        result.failures.push_back("native/third_party/txiki/MANIFEST.sha256 is missing or empty");
        return result;
    }
    std::size_t recorded = 0;
    for (const char c : manifest) recorded += c == '\n';
    std::size_t present = 0;
    std::error_code ec;
    for (const auto& entry : std::filesystem::recursive_directory_iterator(vendored, ec)) {
        if (entry.is_regular_file(ec) && entry.path().filename() != "MANIFEST.sha256") ++present;
    }
    if (present != recorded) result.failures.push_back(std::to_string(present) + " vendored files, " + std::to_string(recorded) + " in the manifest");

    proc::Outcome checked = proc::run({"sha256sum", "-c", "MANIFEST.sha256"}, vendored, {}, 300000);
    if (!checked.started) checked = proc::run({"shasum", "-a", "256", "-c", "MANIFEST.sha256"}, vendored, {}, 300000);
    if (!checked.started || checked.exit_code != 0) {
        std::string failed;
        std::size_t shown = 0;
        for (std::size_t at = 0; at < checked.out.size() && shown < 5;) {
            const std::size_t end = checked.out.find('\n', at);
            const std::string line = checked.out.substr(at, end == std::string::npos ? std::string::npos : end - at);
            if (line.find(": OK") == std::string::npos && !line.empty()) {
                failed += (failed.empty() ? "" : "; ") + line;
                ++shown;
            }
            at = end == std::string::npos ? checked.out.size() : end + 1;
        }
        result.failures.push_back("the vendored files do not match their manifest: " + (failed.empty() ? checked.err.substr(0, 200) : failed));
    }

    const std::string pins_text = support::read_text(root / "tools" / "txiki" / "pins.json");
    const auto pins = json::parse(pins_text);
    if (!pins) {
        result.failures.push_back("tools/txiki/pins.json is not JSON");
        return result;
    }
    const std::string version = support::read_text(vendored / "VERSION.txt");
    for (const char* group : {"archives", "patches"}) {
        const json::Value* entries = pins->find(group);
        if (entries == nullptr || !entries->is_array()) {
            result.failures.push_back(std::string("pins.json has no ") + group);
            continue;
        }
        for (const json::Value& entry : entries->as_array()) {
            const std::string pinned = text_at(entry, "sha256");
            if (std::string(group) == "archives" && !support::contains(version, pinned)) result.failures.push_back("VERSION.txt does not name the pinned archive " + text_at(entry, "name"));
            if (std::string(group) == "patches") {
                const std::string actual = support::file_sha256(root / "tools" / "txiki" / "patches" / text_at(entry, "file"));
                if (actual != pinned) result.failures.push_back("patch " + text_at(entry, "file") + " has sha256 " + actual + ", the pin says " + pinned);
            }
        }
    }
    if (result.failures.empty()) result.summary = std::to_string(recorded) + " vendored files match native/third_party/txiki/MANIFEST.sha256, none is missing or extra, and the archive and patch pins agree with VERSION.txt and the patch files";
    return result;
}

}
