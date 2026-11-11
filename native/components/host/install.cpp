#include "gm/host/install.hpp"

#include <cstdlib>
#include <fstream>
#include <iostream>
#include <sstream>
#include <system_error>

#include "gm/host/child.hpp"
#include "gm/host/update.hpp"
#include "gm/json.hpp"

namespace gm::host {
namespace {

namespace fs = std::filesystem;
constexpr int kMergeAttempts = 5;

std::optional<std::string> read_if_exists(const fs::path& file, std::string& text) {
    std::error_code ec;
    text.clear();
    if (!fs::exists(file, ec)) return std::nullopt;
    std::ifstream in(file, std::ios::binary);
    if (!in) return "cannot read " + file.string();
    std::ostringstream buffer;
    buffer << in.rdbuf();
    text = buffer.str();
    return std::nullopt;
}

bool blank(const std::string& text) { return text.find_first_not_of(" \t\r\n") == std::string::npos; }

std::optional<std::string> merged_config(const std::string& existing, const std::string& name,
                                         const json::Value& entry, std::string& out) {
    json::Value root = json::Object{};
    if (!blank(existing)) {
        auto parsed = json::parse(existing);
        if (!parsed) return "config is not JSON, left untouched: " + parsed.error();
        root = *parsed;
    }
    if (!root.is_object()) return "config is not a JSON object, left untouched";
    json::Value servers = json::Object{};
    if (const json::Value* found = root.find("mcpServers")) {
        if (!found->is_object()) return "mcpServers is not an object, left untouched";
        servers = *found;
    }
    servers.set(name, entry);
    root.set("mcpServers", servers);
    out = json::dump(root) + "\n";
    return std::nullopt;
}

}

std::optional<fs::path> claude_config_path() {
#if defined(_WIN32)
    const char* home = std::getenv("USERPROFILE");
#else
    const char* home = std::getenv("HOME");
#endif
    if (home == nullptr || *home == '\0') return std::nullopt;
    return fs::path(home) / ".claude.json";
}

std::optional<std::string> register_mcp_server(const fs::path& config, const std::string& name,
                                               const std::string& command, const std::vector<std::string>& args) {
    json::Array argv;
    for (const std::string& arg : args) argv.push_back(json::Value(arg));
    json::Value entry = json::Object{};
    entry.set("command", json::Value(command));
    entry.set("args", json::Value(argv));

    const fs::path temp = config.string() + ".gm-tmp";
    for (int attempt = 0; attempt < kMergeAttempts; ++attempt) {
        std::string before;
        if (auto error = read_if_exists(config, before)) return error;
        std::string text;
        if (auto error = merged_config(before, name, entry, text)) return error;
        if (text == before) return std::nullopt;

        {
            std::ofstream out(temp, std::ios::binary | std::ios::trunc);
            if (!out) return "cannot write " + temp.string();
            out << text;
            if (!out) return "cannot write " + temp.string();
        }

        std::string now;
        if (auto error = read_if_exists(config, now)) {
            std::error_code ignored;
            fs::remove(temp, ignored);
            return error;
        }
        if (now != before) {
            std::error_code ignored;
            fs::remove(temp, ignored);
            continue;
        }

        std::error_code ec;
        fs::rename(temp, config, ec);
        if (ec) {
            std::error_code ignored;
            fs::remove(temp, ignored);
            return "cannot replace " + config.string() + ": " + ec.message();
        }
        return std::nullopt;
    }
    return "the config kept changing while it was being written; nothing was written";
}

int run_install_command(const HostArgs& args) {
    const auto default_config = claude_config_path();
    const auto config = args.flag("--config") ? std::optional<fs::path>(fs::absolute(*args.flag("--config")))
                                              : default_config;
    if (!config) {
        std::cerr << "gm: install: neither HOME nor USERPROFILE is set\n";
        return 1;
    }
    std::vector<std::string> server_args{"serve"};
    if (auto mcp_config = args.flag("--mcp-config")) {
        server_args.push_back("--mcp-config");
        server_args.push_back(*mcp_config);
    }
    const std::string exe = stable_executable(current_executable()).string();
    if (auto error = register_mcp_server(*config, "gm", exe, server_args)) {
        std::cerr << "gm: install: " << *error << "\n";
        return 1;
    }
    std::cout << "registered gm MCP server (user scope) at " << exe << " in " << config->string() << "\n";
    return 0;
}

}
