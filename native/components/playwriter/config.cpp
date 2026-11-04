#include "config.hpp"

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <fstream>
#include <iostream>
#include <optional>
#include <set>
#include <sstream>

#include "gmnew/json.hpp"

namespace gmnew::playwriter {

namespace {

constexpr std::uint64_t CALL_MS = 60000;
constexpr std::uint64_t STARTUP_MS = 30000;
constexpr double MAX_EXACT_INTEGER = 9007199254740992.0;

bool ascii_letter(char c) { return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z'); }

bool identifier_start(char c) { return c == '_' || ascii_letter(c); }

bool identifier_part(char c) { return identifier_start(c) || (c >= '0' && c <= '9'); }

std::string trim(const std::string& text) {
    const auto first = text.find_first_not_of(" \t\r\n\f\v");
    if (first == std::string::npos) return {};
    return text.substr(first, text.find_last_not_of(" \t\r\n\f\v") - first + 1);
}

std::string text_of(const json::Value& value) { return value.is_string() ? value.as_string() : json::dump(value); }

bool is_disabled(const json::Value& spec) {
    const json::Value* disabled = spec.find("disabled");
    return disabled != nullptr && disabled->is_bool() && disabled->as_bool();
}

bool positive_integer(const json::Value& value) {
    return value.is_number() && value.as_number() >= 1 && value.as_number() <= MAX_EXACT_INTEGER &&
           std::floor(value.as_number()) == value.as_number();
}

bool string_array(const json::Value& value, bool non_empty) {
    if (!value.is_array()) return false;
    for (const json::Value& item : value.as_array()) {
        if (!item.is_string() || (non_empty && trim(item.as_string()).empty())) return false;
    }
    return true;
}

bool ignore_line_ok(const std::string& line) {
    const std::string text = trim(line);
    const bool absolute = (!text.empty() && (text[0] == '/' || text[0] == '\\')) ||
                          (text.size() >= 2 && text[1] == ':' && ascii_letter(text[0]));
    if (absolute) return false;
    std::string segment;
    for (char c : text + "/") {
        if (c == '/' || c == '\\') {
            if (segment == "..") return false;
            segment.clear();
        } else {
            segment.push_back(c);
        }
    }
    return true;
}

std::string expand_variables(const std::string& text, std::vector<std::string>& missing) {
    std::string out;
    for (std::size_t i = 0; i < text.size();) {
        const std::size_t start = i + 2;
        if (text[i] == '$' && i + 1 < text.size() && text[i + 1] == '{' && start < text.size() && identifier_start(text[start])) {
            std::size_t end = start + 1;
            while (end < text.size() && identifier_part(text[end])) ++end;
            if (end < text.size() && text[end] == '}') {
                const std::string variable = text.substr(start, end - start);
                if (const char* value = std::getenv(variable.c_str())) {
                    out += value;
                } else {
                    missing.push_back(variable);
                    out += text.substr(i, end - i + 1);
                }
                i = end + 1;
                continue;
            }
        }
        out.push_back(text[i]);
        ++i;
    }
    return out;
}

std::optional<ServerSpec> server_of(const std::string& name, const json::Value& spec, const std::filesystem::path& workspace) {
    const auto fail = [&](const std::string& text) -> std::optional<ServerSpec> {
        warn("server " + name + ": " + text);
        return std::nullopt;
    };
    if (is_disabled(spec)) return std::nullopt;
    if (name.empty()) return fail("the name must not be empty");
    if (const json::Value* type = spec.find("type"); type != nullptr && !(type->is_string() && type->as_string() == "stdio"))
        return fail("type " + text_of(*type) + " is not supported, only stdio servers run");
    const json::Value* command = spec.find("command");
    if (command == nullptr || !command->is_string() || command->as_string().empty()) return fail("command must be a non-empty string");
    const json::Value* cwd = spec.find("cwd");
    if (cwd != nullptr && !cwd->is_string()) return fail("cwd must be a string");
    const json::Value* args = spec.find("args");
    if (args != nullptr && !string_array(*args, false)) return fail("args must be an array of strings");
    const json::Value* env = spec.find("env");
    if (env != nullptr && (!env->is_object() || std::any_of(env->as_object().begin(), env->as_object().end(), [](const auto& m) { return !m.second.is_string(); })))
        return fail("env must be an object of strings");
    const json::Value* ignore = spec.find("ignore");
    if (ignore != nullptr && (!string_array(*ignore, true) || !std::all_of(ignore->as_array().begin(), ignore->as_array().end(), [](const json::Value& line) { return ignore_line_ok(line.as_string()); })))
        return fail("ignore must be an array of non-empty relative paths without a .. segment");
    const json::Value* timeout = spec.find("timeoutMs");
    const json::Value* startup = spec.find("startupTimeoutMs");
    if ((timeout != nullptr && !positive_integer(*timeout)) || (startup != nullptr && !positive_integer(*startup)))
        return fail("timeoutMs and startupTimeoutMs must be positive integers");
    const json::Value* deny = spec.find("deny");
    if (deny != nullptr && !string_array(*deny, true)) return fail("deny must be an array of non-empty tool names");

    std::vector<std::string> missing;
    ServerSpec server;
    server.name = name;
    server.command = expand_variables(command->as_string(), missing);
    if (args != nullptr)
        for (const json::Value& arg : args->as_array()) server.args.push_back(expand_variables(arg.as_string(), missing));
    if (env != nullptr)
        for (const auto& [key, value] : env->as_object()) server.env.emplace_back(key, expand_variables(value.as_string(), missing));
    server.cwd = cwd == nullptr ? workspace : (workspace / expand_variables(cwd->as_string(), missing)).lexically_normal();
    server.timeout_ms = timeout == nullptr ? CALL_MS : static_cast<std::uint64_t>(timeout->as_number());
    server.startup_ms = startup == nullptr ? STARTUP_MS : static_cast<std::uint64_t>(startup->as_number());
    if (deny != nullptr)
        for (const json::Value& tool : deny->as_array()) server.deny.push_back(tool.as_string());
    if (ignore != nullptr)
        for (const json::Value& line : ignore->as_array()) server.ignore.push_back(trim(line.as_string()));
    if (!missing.empty()) {
        std::set<std::string> unique(missing.begin(), missing.end());
        std::string names;
        for (const std::string& variable : unique) names += (names.empty() ? "" : ", ") + variable;
        return fail("environment variable " + names + " is not set");
    }
    return server;
}

std::optional<json::Value> read_document(const ConfigFile& file) {
    if (!std::filesystem::exists(file.path)) {
        if (file.required) warn(file.path.string() + " does not exist");
        return std::nullopt;
    }
    std::ifstream in(file.path, std::ios::binary);
    std::ostringstream text;
    text << in.rdbuf();
    auto document = json::parse(text.str());
    if (!document) {
        warn(file.path.string() + " is not valid JSON: " + document.error());
        return std::nullopt;
    }
    return *document;
}

}

void warn(const std::string& text) { std::cerr << "gm mcp: " << text << '\n'; }

std::map<std::string, ServerSpec, std::less<>> read_servers(const std::vector<ConfigFile>& files,
                                                            const std::filesystem::path& workspace) {
    std::map<std::string, std::optional<ServerSpec>, std::less<>> merged;
    for (const ConfigFile& file : files) {
        const auto document = read_document(file);
        if (!document) continue;
        const json::Value* servers = document->find("mcpServers");
        if (servers == nullptr || !servers->is_object()) continue;
        for (const auto& [name, spec] : servers->as_object()) merged[name] = server_of(name, spec, workspace);
    }
    std::map<std::string, ServerSpec, std::less<>> result;
    for (auto& [name, spec] : merged) {
        if (spec) result.emplace(name, std::move(*spec));
    }
    return result;
}

}
