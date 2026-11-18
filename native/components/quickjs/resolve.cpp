#include "engine.hpp"

#include <optional>
#include <system_error>
#include <vector>

#include "platform.hpp"

namespace gm::engine {
namespace fs = std::filesystem;
namespace {

bool is_import_condition(std::string_view condition) {
    return condition == "import" || condition == "default";
}

bool has_subpath_keys(const json::Value& exports) {
    if (!exports.is_object()) return false;
    for (const json::Member& member : exports.as_object()) {
        if (member.first.starts_with('.')) return true;
    }
    return false;
}

std::optional<std::string> target_path(const fs::path& package_dir, const json::Value& target, std::string_view match) {
    if (target.is_string()) {
        if (!target.as_string().starts_with("./")) return std::nullopt;
        std::string relative = target.as_string().substr(2);
        for (std::size_t star = relative.find('*'); star != std::string::npos; star = relative.find('*', star + match.size())) {
            relative.replace(star, 1, match);
        }
        return (package_dir / relative).lexically_normal().generic_string();
    }
    if (target.is_array()) {
        for (const json::Value& entry : target.as_array()) {
            if (auto found = target_path(package_dir, entry, match)) return found;
        }
        return std::nullopt;
    }
    if (target.is_object()) {
        for (const json::Member& member : target.as_object()) {
            if (!is_import_condition(member.first)) continue;
            if (auto found = target_path(package_dir, member.second, match)) return found;
        }
    }
    return std::nullopt;
}

std::optional<std::string> exports_path(const fs::path& package_dir, const json::Value& exports, const std::string& key) {
    const json::Value table = has_subpath_keys(exports) ? exports : json::Value(json::Object{{".", exports}});
    if (const json::Value* exact = table.find(key)) return target_path(package_dir, *exact, "");
    const json::Member* best = nullptr;
    std::string_view best_match;
    std::size_t best_prefix = 0;
    for (const json::Member& member : table.as_object()) {
        const std::string_view pattern = member.first;
        const std::size_t star = pattern.find('*');
        if (star == std::string_view::npos) continue;
        const std::string_view prefix = pattern.substr(0, star);
        const std::string_view suffix = pattern.substr(star + 1);
        if (!key.starts_with(prefix) || !key.ends_with(suffix) || key.size() < prefix.size() + suffix.size()) continue;
        if (best != nullptr && prefix.size() <= best_prefix) continue;
        best = &member;
        best_prefix = prefix.size();
        best_match = std::string_view(key).substr(prefix.size(), key.size() - prefix.size() - suffix.size());
    }
    if (best == nullptr) return std::nullopt;
    return target_path(package_dir, best->second, best_match);
}

deoxidene::Result<std::string, std::string> resolve_in_package(const fs::path& package_dir, const std::string& key, std::string_view specifier) {
    json::Value manifest{json::Object{}};
    if (auto text = platform::read_file(package_dir / "package.json")) {
        auto parsed = json::parse(*text);
        if (!parsed) return deoxidene::Err<std::string>("the package.json of '" + std::string(specifier) + "' does not parse: " + parsed.error());
        manifest = std::move(*parsed);
    }
    const json::Value* exports = manifest.find("exports");
    if (exports != nullptr && !exports->is_null()) {
        auto found = exports_path(package_dir, *exports, key);
        if (!found) return deoxidene::Err<std::string>("Package subpath '" + key + "' is not defined by \"exports\" in " + (package_dir / "package.json").generic_string());
        if (!platform::is_regular_file(*found)) return deoxidene::Err<std::string>("Cannot find module '" + *found + "' for '" + std::string(specifier) + "'");
        return *found;
    }
    if (key != ".") {
        const fs::path file = (package_dir / key.substr(2)).lexically_normal();
        if (platform::is_regular_file(file)) return file.generic_string();
        return deoxidene::Err<std::string>("Cannot find module '" + file.generic_string() + "' for '" + std::string(specifier) + "'");
    }
    std::vector<fs::path> candidates;
    if (const json::Value* main = manifest.find("main"); main != nullptr && main->is_string()) {
        const fs::path entry = (package_dir / main->as_string()).lexically_normal();
        candidates = {entry, fs::path(entry.string() + ".js"), entry / "index.js"};
    }
    candidates.push_back((package_dir / "index.js").lexically_normal());
    for (const fs::path& candidate : candidates) {
        if (platform::is_regular_file(candidate)) return candidate.generic_string();
    }
    return deoxidene::Err<std::string>("Cannot find a file for '" + std::string(specifier) + "' in " + package_dir.generic_string());
}

}

deoxidene::Result<std::string, std::string> resolve_module_path(const fs::path& base_dir, std::string_view specifier) {
    if (specifier.starts_with('/')) return std::string(specifier);
    if (specifier == "." || specifier == ".." || specifier.starts_with("./") || specifier.starts_with("../")) {
        return (base_dir / std::string(specifier)).lexically_normal().generic_string();
    }
    std::size_t name_end = specifier.find('/');
    if (specifier.starts_with('@')) {
        const std::size_t scope_end = specifier.find('/');
        name_end = scope_end == std::string_view::npos ? std::string_view::npos : specifier.find('/', scope_end + 1);
    }
    if (name_end == std::string_view::npos) name_end = specifier.size();
    const std::string name(specifier.substr(0, name_end));
    const std::string key = name_end == specifier.size() ? std::string(".") : "." + std::string(specifier.substr(name_end));
    if (name.empty() || name == "@") return deoxidene::Err<std::string>("'" + std::string(specifier) + "' is not a package name");
    for (fs::path dir = base_dir;; dir = dir.parent_path()) {
        if (dir.filename() != "node_modules") {
            std::error_code ignored;
            const fs::path package_dir = dir / "node_modules" / name;
            if (fs::is_directory(package_dir, ignored)) return resolve_in_package(package_dir, key, specifier);
        }
        if (dir == dir.parent_path()) break;
    }
    return deoxidene::Err<std::string>("Cannot find package '" + name + "' imported from " + base_dir.generic_string());
}

}
