#include <filesystem>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>

#include "gm/host/install.hpp"
#include "gm/json.hpp"

namespace {

namespace fs = std::filesystem;
int failures = 0;

void check(bool ok, const std::string& what) {
    std::cout << (ok ? "ok   " : "FAIL ") << what << '\n';
    if (!ok) ++failures;
}

std::string read_text(const fs::path& file) {
    std::ifstream in(file, std::ios::binary);
    std::ostringstream buffer;
    buffer << in.rdbuf();
    return buffer.str();
}

gm::json::Value load(const fs::path& file) {
    auto parsed = gm::json::parse(read_text(file));
    return parsed ? *parsed : gm::json::Value();
}

const gm::json::Value* member(const gm::json::Value* value, const char* key) {
    return value == nullptr ? nullptr : value->find(key);
}

}

int main() {
    const fs::path home = fs::temp_directory_path() / "gm-install-test-home";
    fs::remove_all(home);
    fs::create_directories(home);
    const fs::path config = home / ".claude.json";

    {
        std::ofstream out(config);
        out << R"({"numStartups": 7, "mcpServers": {"playwriter": {"command": "npx", "args": ["-y"]}}})";
    }
    auto error = gm::host::register_mcp_server(config, "gm", "/opt/gm/current/gm", {"serve"});
    check(!error, "registration succeeds on an existing config");
    gm::json::Value root = load(config);
    check(member(&root, "numStartups") && member(&root, "numStartups")->as_number() == 7, "other top-level keys survive");
    const gm::json::Value* servers = member(&root, "mcpServers");
    check(member(servers, "playwriter") != nullptr, "other MCP servers survive");
    const gm::json::Value* entry = member(servers, "gm");
    check(member(entry, "command") && member(entry, "command")->as_string() == "/opt/gm/current/gm",
          "gm entry has the executable as command");
    const gm::json::Value* args = member(entry, "args");
    check(args && args->is_array() && args->as_array().size() == 1 && args->as_array()[0].as_string() == "serve",
          "gm entry args are [serve]");
    check(member(entry, "type") == nullptr, "gm entry has no type key, as add-mcp writes it");

    error = gm::host::register_mcp_server(config, "gm", "/opt/gm/current/gm", {"serve", "--mcp-config", "/x.json"});
    check(!error, "a second registration succeeds");
    root = load(config);
    args = member(member(member(&root, "mcpServers"), "gm"), "args");
    check(args && args->as_array().size() == 3, "a second registration replaces the gm entry, not duplicates it");
    check(member(member(&root, "mcpServers"), "playwriter") != nullptr, "the replacement keeps other servers");

    const fs::path fresh = home / "fresh.json";
    error = gm::host::register_mcp_server(fresh, "gm", "/opt/gm/current/gm", {"serve"});
    check(!error && fs::exists(fresh), "a missing config is created");
    check(!fs::exists(fresh.string() + ".gm-tmp"), "no temporary file is left behind");

    const fs::path not_object = home / "list.json";
    {
        std::ofstream out(not_object);
        out << "[1, 2]";
    }
    error = gm::host::register_mcp_server(not_object, "gm", "/opt/gm/current/gm", {"serve"});
    check(error.has_value(), "a config that is not an object is refused");
    check(read_text(not_object) == "[1, 2]", "a refused config is left untouched");

    fs::remove_all(home);
    std::cout << (failures == 0 ? "install_test passed" : "install_test FAILED") << '\n';
    return failures == 0 ? 0 : 1;
}
