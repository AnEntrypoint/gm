#include "config.hpp"

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <fstream>
#include <map>
#include <optional>
#include <set>
#include <sstream>

#include "gm/json.hpp"

namespace gm::mcpclient {

namespace {

constexpr std::uint64_t CALL_MS = 60000;
constexpr std::uint64_t STARTUP_MS = 30000;
constexpr std::uint64_t LAUNCHER_STARTUP_MS = 600000;
constexpr double MAX_EXACT_INTEGER = 9007199254740992.0;
constexpr const char* WHITESPACE = " \t\r\n\f\v";

bool ascii_letter(char c) { return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z'); }

bool identifier_start(char c) { return c == '_' || ascii_letter(c); }

bool identifier_part(char c) { return identifier_start(c) || (c >= '0' && c <= '9'); }

bool batch_launcher(const std::string& command) {
    const std::string name = std::filesystem::path(command).filename().string();
    return name == "npx" || name == "npm";
}

std::string trim(const std::string& text) {
    const auto first = text.find_first_not_of(WHITESPACE);
    if (first == std::string::npos) return {};
    return text.substr(first, text.find_last_not_of(WHITESPACE) - first + 1);
}

std::string text_of(const json::Value& value) { return value.is_string() ? value.as_string() : json::dump(value); }

const json::Value* field(const json::Value& spec, std::string_view key) {
    const json::Value* value = spec.find(key);
    return value == nullptr || value->is_null() ? nullptr : value;
}

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
    return std::all_of(value.as_array().begin(), value.as_array().end(), [non_empty](const json::Value& item) {
        return item.is_string() && (!non_empty || !trim(item.as_string()).empty());
    });
}

std::optional<std::string> ignore_problem(const json::Value& ignore) {
    if (!string_array(ignore, true)) return "ignore must be an array of non-empty strings";
    for (const json::Value& line : ignore.as_array()) {
        const std::string text = trim(line.as_string());
        const bool absolute = (!text.empty() && (text[0] == '/' || text[0] == '\\')) || (text.size() >= 2 && text[1] == ':' && ascii_letter(text[0]));
        if (absolute) return "ignore lines must be relative paths, not absolute";
    }
    for (const json::Value& line : ignore.as_array()) {
        std::string segment;
        for (char c : trim(line.as_string()) + "/") {
            if (c != '/' && c != '\\') {
                segment.push_back(c);
                continue;
            }
            if (segment == "..") return "ignore lines must not contain a .. segment";
            segment.clear();
        }
    }
    return std::nullopt;
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

std::optional<ServerSpec> server_of(const std::string& name, const json::Value& spec, const std::filesystem::path& workspace,
                                    std::vector<std::string>& problems) {
    const auto fail = [&](const std::string& text) -> std::optional<ServerSpec> {
        problems.push_back("server " + name + ": " + text);
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
    const json::Value* args = field(spec, "args");
    if (args != nullptr && !string_array(*args, false)) return fail("args must be an array of strings");
    const json::Value* env = field(spec, "env");
    if (env != nullptr && (!env->is_object() || std::any_of(env->as_object().begin(), env->as_object().end(), [](const auto& m) { return !m.second.is_string(); })))
        return fail("env must be an object of strings");
    const json::Value* ignore = field(spec, "ignore");
    if (ignore != nullptr)
        if (auto problem = ignore_problem(*ignore)) return fail(*problem);
    const json::Value* timeout = field(spec, "timeoutMs");
    const json::Value* startup = field(spec, "startupTimeoutMs");
    if ((timeout != nullptr && !positive_integer(*timeout)) || (startup != nullptr && !positive_integer(*startup)))
        return fail("timeoutMs and startupTimeoutMs must be positive integers");
    const json::Value* deny = field(spec, "deny");
    if (deny != nullptr && !string_array(*deny, true)) return fail("deny must be an array of non-empty tool names");

    std::vector<std::string> missing;
    ServerSpec server;
    server.name = name;
    server.workspace = workspace;
    server.command = expand_variables(command->as_string(), missing);
    if (args != nullptr)
        for (const json::Value& arg : args->as_array()) server.args.push_back(expand_variables(arg.as_string(), missing));
    if (env != nullptr)
        for (const auto& [key, value] : env->as_object()) server.env.emplace_back(key, expand_variables(value.as_string(), missing));
    server.cwd = cwd == nullptr ? workspace : (workspace / expand_variables(cwd->as_string(), missing)).lexically_normal();
    server.timeout_ms = timeout == nullptr ? CALL_MS : static_cast<std::uint64_t>(timeout->as_number());
    server.startup_default = startup == nullptr;
    server.startup_ms = startup == nullptr ? (batch_launcher(server.command) ? LAUNCHER_STARTUP_MS : STARTUP_MS) : static_cast<std::uint64_t>(startup->as_number());
    if (deny != nullptr)
        for (const json::Value& tool : deny->as_array()) server.deny.push_back(tool.as_string());
    if (ignore != nullptr)
        for (const json::Value& line : ignore->as_array()) server.ignore.push_back(trim(line.as_string()));
    if (!missing.empty()) {
        std::string names;
        std::set<std::string> listed;
        for (const std::string& variable : missing) {
            if (!listed.insert(variable).second) continue;
            names += (names.empty() ? "" : ", ") + variable;
        }
        return fail("environment variable " + names + " is not set");
    }
    return server;
}

}

ConfigReading read_servers(const std::vector<ConfigFile>& files, const std::filesystem::path& workspace) {
    ConfigReading reading;
    std::vector<std::string> order;
    std::map<std::string, std::optional<ServerSpec>, std::less<>> latest;
    for (const ConfigFile& file : files) {
        if (!std::filesystem::exists(file.path)) {
            if (file.required) reading.problems.push_back(file.path.string() + " does not exist");
            continue;
        }
        std::ifstream in(file.path, std::ios::binary);
        std::ostringstream text;
        text << in.rdbuf();
        auto document = json::parse(text.str());
        if (!document) {
            reading.problems.push_back(file.path.string() + " is not valid JSON: " + document.error());
            continue;
        }
        const json::Value* servers = document->find("mcpServers");
        if (servers == nullptr || !servers->is_object()) continue;
        for (const auto& [name, spec] : servers->as_object()) {
            if (!latest.contains(name)) order.push_back(name);
            latest[name] = server_of(name, spec, workspace, reading.problems);
        }
    }
    for (const std::string& name : order) {
        if (latest[name]) reading.servers.push_back(std::move(*latest[name]));
    }
    return reading;
}

}
