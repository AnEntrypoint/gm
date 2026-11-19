#include "engine.hpp"

#include <optional>
#include <system_error>
#include <vector>

#include "platform.hpp"

namespace gm::engine {
namespace fs = std::filesystem;
namespace {

struct MapEntry {
    const json::Value* target;
    std::string match;
};

std::string_view primary_condition(ModuleSystem system) {
    return system == ModuleSystem::Cjs ? "require" : "import";
}

bool is_module_condition(std::string_view condition, ModuleSystem system) {
    return condition == primary_condition(system) || condition == "default";
}

bool has_subpath_keys(const json::Value& exports) {
    if (!exports.is_object()) return false;
    for (const json::Member& member : exports.as_object()) {
        if (member.first.starts_with('.')) return true;
    }
    return false;
}

std::vector<fs::path> file_candidates(const fs::path& base, ModuleSystem system) {
    std::vector<fs::path> out{base, fs::path(base.string() + ".js")};
    if (system == ModuleSystem::Cjs) {
        out.push_back(fs::path(base.string() + ".cjs"));
        out.push_back(fs::path(base.string() + ".json"));
    }
    return out;
}

std::vector<fs::path> directory_candidates(const fs::path& dir, ModuleSystem system) {
    std::vector<fs::path> out{dir / "index.js"};
    if (system == ModuleSystem::Cjs) {
        out.push_back(dir / "index.cjs");
        out.push_back(dir / "index.json");
    }
    return out;
}

std::optional<MapEntry> find_entry(const json::Value& map, const std::string& key) {
    if (!map.is_object()) return std::nullopt;
    if (const json::Value* exact = map.find(key)) return MapEntry{exact, ""};
    const json::Member* best = nullptr;
    std::string_view best_match;
    std::size_t best_prefix = 0;
    for (const json::Member& member : map.as_object()) {
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
    return MapEntry{&best->second, std::string(best_match)};
}

std::string substitute(std::string text, std::string_view match) {
    for (std::size_t star = text.find('*'); star != std::string::npos; star = text.find('*', star + match.size())) {
        text.replace(star, 1, match);
    }
    return text;
}

std::optional<std::string> target_path(const fs::path& package_dir, const json::Value& target, std::string_view match, ModuleSystem system) {
    if (target.is_string()) {
        if (!target.as_string().starts_with("./")) return std::nullopt;
        return (package_dir / substitute(target.as_string().substr(2), match)).lexically_normal().generic_string();
    }
    if (target.is_array()) {
        for (const json::Value& entry : target.as_array()) {
            if (auto found = target_path(package_dir, entry, match, system)) return found;
        }
        return std::nullopt;
    }
    if (target.is_object()) {
        for (const json::Member& member : target.as_object()) {
            if (!is_module_condition(member.first, system)) continue;
            if (auto found = target_path(package_dir, member.second, match, system)) return found;
        }
    }
    return std::nullopt;
}

std::optional<std::string> exports_path(const fs::path& package_dir, const json::Value& exports, const std::string& key, ModuleSystem system) {
    const json::Value table = has_subpath_keys(exports) ? exports : json::Value(json::Object{{".", exports}});
    const auto entry = find_entry(table, key);
    if (!entry) return std::nullopt;
    return target_path(package_dir, *entry->target, entry->match, system);
}

deoxidene::Result<std::optional<std::string>, std::string> import_target(const fs::path& package_dir, const json::Value& target, std::string_view match, ModuleSystem system, std::string_view specifier) {
    using Found = std::optional<std::string>;
    if (target.is_string()) {
        const std::string text = substitute(target.as_string(), match);
        if (text.starts_with("./")) return Found((package_dir / text.substr(2)).lexically_normal().generic_string());
        auto resolved = resolve_module_path(package_dir, text, system);
        if (!resolved) return deoxidene::Err<std::string>(resolved.error());
        return Found(*resolved);
    }
    if (target.is_array()) {
        for (const json::Value& entry : target.as_array()) {
            auto found = import_target(package_dir, entry, match, system, specifier);
            if (!found) return deoxidene::Err<std::string>(found.error());
            if (*found) return *found;
        }
        return Found();
    }
    if (target.is_object()) {
        for (const json::Member& member : target.as_object()) {
            if (!is_module_condition(member.first, system)) continue;
            auto found = import_target(package_dir, member.second, match, system, specifier);
            if (!found) return deoxidene::Err<std::string>(found.error());
            if (*found) return *found;
        }
    }
    return Found();
}

deoxidene::Result<std::string, std::string> resolve_import(const fs::path& base_dir, std::string_view specifier, ModuleSystem system) {
    const std::string key(specifier);
    for (fs::path dir = base_dir;; dir = dir.parent_path()) {
        if (dir.filename() == "node_modules") break;
        const fs::path manifest_file = dir / "package.json";
        if (auto text = platform::read_file(manifest_file)) {
            auto parsed = json::parse(*text);
            if (!parsed) return deoxidene::Err<std::string>("the package.json of '" + key + "' does not parse: " + parsed.error());
            const json::Value* imports = parsed->find("imports");
            if (imports != nullptr && imports->is_object()) {
                if (const auto entry = find_entry(*imports, key)) {
                    auto found = import_target(dir, *entry->target, entry->match, system, specifier);
                    if (!found) return deoxidene::Err<std::string>(found.error());
                    if (*found) return **found;
                }
            }
            return deoxidene::Err<std::string>("Package import specifier '" + key + "' is not defined in " + manifest_file.generic_string());
        }
        if (dir == dir.parent_path()) break;
    }
    return deoxidene::Err<std::string>("Package import specifier '" + key + "' is not defined: no package.json above " + base_dir.generic_string());
}

deoxidene::Result<std::string, std::string> resolve_in_package(const fs::path& package_dir, const std::string& key, std::string_view specifier, ModuleSystem system) {
    json::Value manifest{json::Object{}};
    if (auto text = platform::read_file(package_dir / "package.json")) {
        auto parsed = json::parse(*text);
        if (!parsed) return deoxidene::Err<std::string>("the package.json of '" + std::string(specifier) + "' does not parse: " + parsed.error());
        manifest = std::move(*parsed);
    }
    const json::Value* exports = manifest.find("exports");
    if (exports != nullptr && !exports->is_null()) {
        auto found = exports_path(package_dir, *exports, key, system);
        if (!found) return deoxidene::Err<std::string>("Package subpath '" + key + "' is not defined by \"exports\" in " + (package_dir / "package.json").generic_string());
        if (!platform::is_regular_file(*found)) return deoxidene::Err<std::string>("Cannot find module '" + *found + "' for '" + std::string(specifier) + "'");
        return *found;
    }
    std::vector<fs::path> candidates;
    if (key != ".") {
        const fs::path file = (package_dir / key.substr(2)).lexically_normal();
        candidates = {file};
        if (system == ModuleSystem::Cjs) {
            candidates = file_candidates(file, system);
            const auto indexes = directory_candidates(file, system);
            candidates.insert(candidates.end(), indexes.begin(), indexes.end());
        }
    } else {
        if (const json::Value* main = manifest.find("main"); main != nullptr && main->is_string()) {
            const fs::path entry = (package_dir / main->as_string()).lexically_normal();
            candidates = file_candidates(entry, system);
            const auto indexes = directory_candidates(entry, system);
            candidates.insert(candidates.end(), indexes.begin(), indexes.end());
        }
        const auto indexes = directory_candidates(package_dir, system);
        candidates.insert(candidates.end(), indexes.begin(), indexes.end());
    }
    for (const fs::path& candidate : candidates) {
        if (platform::is_regular_file(candidate)) return candidate.lexically_normal().generic_string();
    }
    return deoxidene::Err<std::string>("Cannot find a file for '" + std::string(specifier) + "' in " + package_dir.generic_string());
}

}

deoxidene::Result<std::string, std::string> resolve_module_path(const fs::path& base_dir, std::string_view specifier, ModuleSystem system) {
    if (specifier.starts_with('/')) return std::string(specifier);
    if (specifier == "." || specifier == ".." || specifier.starts_with("./") || specifier.starts_with("../")) {
        return (base_dir / std::string(specifier)).lexically_normal().generic_string();
    }
    if (specifier.starts_with('#')) return resolve_import(base_dir, specifier, system);
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
            if (system == ModuleSystem::Cjs) {
                for (const fs::path& candidate : file_candidates(dir / "node_modules" / std::string(specifier), system)) {
                    if (platform::is_regular_file(candidate)) return candidate.lexically_normal().generic_string();
                }
            }
            const fs::path package_dir = dir / "node_modules" / name;
            if (fs::is_directory(package_dir, ignored)) return resolve_in_package(package_dir, key, specifier, system);
        }
        if (dir == dir.parent_path()) break;
    }
    return deoxidene::Err<std::string>("Cannot find package '" + name + "' imported from " + base_dir.generic_string());
}

}
