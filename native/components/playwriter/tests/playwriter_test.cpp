#include <chrono>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <set>
#include <sstream>
#include <string>
#include <vector>

#include "gmnew/json.hpp"
#include "gmnew/playwriter.hpp"

namespace fs = std::filesystem;
using gmnew::json::Object;
using gmnew::json::Value;
using gmnew::playwriter::ConfigFile;
using gmnew::playwriter::Options;
using gmnew::playwriter::PlaywriterVerbs;
using gmnew::VerbInfo;

namespace {

int failures = 0;

void check(bool ok, const std::string& what) {
    std::cout << (ok ? "ok   " : "FAIL ") << what << std::endl;
    if (!ok) ++failures;
}

fs::path scratch_dir() {
    const auto stamp = std::chrono::steady_clock::now().time_since_epoch().count();
    const fs::path dir = fs::temp_directory_path() / ("gmnew-playwriter-test-" + std::to_string(stamp));
    fs::create_directories(dir);
    return dir;
}

void write_file(const fs::path& path, const std::string& text) {
    fs::create_directories(path.parent_path());
    std::ofstream(path, std::ios::binary) << text;
}

std::string read_file(const fs::path& path) {
    std::ifstream in(path, std::ios::binary);
    std::ostringstream text;
    text << in.rdbuf();
    return text.str();
}

std::string config_with(const std::string& extra_fields) {
    return "{\"mcpServers\":{\"playwriter\":{\"command\":" + gmnew::json::quote(GMNEW_FAKE_MCP_SERVER) +
           ",\"deny\":[\"reset\"],\"timeoutMs\":1500,\"startupTimeoutMs\":10000,\"ignore\":[\".playwriter/\"]" +
           (extra_fields.empty() ? std::string() : "," + extra_fields) + "}}}";
}

Options options_for(const fs::path& workspace, const fs::path& config) {
    Options options;
    options.workspace = workspace;
    options.config_files = {ConfigFile{config, true}};
    return options;
}

bool has_verb(const std::vector<VerbInfo>& verbs, const std::string& name) {
    for (const VerbInfo& verb : verbs) {
        if (verb.name == name) return true;
    }
    return false;
}

std::string text_of(const Value& reply, const std::string& key) {
    const Value* value = reply.find(key);
    return value != nullptr && value->is_string() ? value->as_string() : std::string();
}

bool ok_of(const Value& reply) {
    const Value* ok = reply.find("ok");
    return ok != nullptr && ok->is_bool() && ok->as_bool();
}

void unset_variable(const char* name) {
#if defined(_WIN32)
    _putenv_s(name, "");
#else
    unsetenv(name);
#endif
}

void set_variable(const char* name, const char* value) {
#if defined(_WIN32)
    _putenv_s(name, value);
#else
    setenv(name, value, 1);
#endif
}

void test_full_surface(const fs::path& dir) {
    const fs::path config = dir / "surface" / "mcp.json";
    write_file(config, config_with(""));
    PlaywriterVerbs verbs(options_for(dir / "surface", config));
    const std::vector<VerbInfo> listed = verbs.list();
    check(has_verb(listed, "playwriter_execute"), "execute is served as playwriter_execute");
    check(has_verb(listed, "playwriter_browsers"), "browsers is served as playwriter_browsers");
    check(has_verb(listed, "playwriter_extra"), "a tool on the second tools/list page is served");
    check(!has_verb(listed, "playwriter_reset"), "reset is denied by the entry and not served");
    for (const VerbInfo& verb : listed) {
        if (verb.name == "playwriter_execute") {
            check(verb.description.find("(MCP server playwriter, tool execute)") != std::string::npos, "description names the server and tool");
            check(verb.input_schema_json.find("\"object\"") != std::string::npos, "input schema is the server's schema");
        }
    }

    const Value browsers = verbs.call("playwriter_browsers", Value(Object{}));
    check(ok_of(browsers) && text_of(browsers, "output") == "[]", "browsers returns the server's text");

    Value args;
    args.set("code", "1+1");
    const Value executed = verbs.call("playwriter_execute", args);
    check(ok_of(executed) && text_of(executed, "output") == "ran\n[image image/png]", "a text and an image part join with a newline");
    const Value* data = executed.find("data");
    check(data != nullptr && data->find("code") != nullptr && data->find("code")->as_string() == "1+1", "structuredContent arrives as data");

    const Value failed = verbs.call("playwriter_fail", Value(Object{}));
    check(!ok_of(failed) && text_of(failed, "error") == "boom", "isError replies ok false with the output as error");

    const Value unknown = verbs.call("playwriter_nope", Value(Object{}));
    check(!ok_of(unknown) && text_of(unknown, "error").find("unknown tool") == 0, "an unknown verb is refused");

    const auto before = std::chrono::steady_clock::now();
    const Value hung = verbs.call("playwriter_hang", Value(Object{}));
    const auto elapsed = std::chrono::steady_clock::now() - before;
    check(!ok_of(hung) && text_of(hung, "error").find("timed out") != std::string::npos, "a call past timeoutMs replies with a timeout");
    check(elapsed < std::chrono::seconds(10), "the timeout is honoured promptly");
    check(ok_of(verbs.call("playwriter_browsers", Value(Object{}))), "the server keeps serving after a timeout");

    const Value pinged = verbs.call("playwriter_ping_first", Value(Object{}));
    check(ok_of(pinged) && text_of(pinged, "output") == "pinged", "a server-to-client ping is answered and the call still completes");

    const Value crashed = verbs.call("playwriter_crash", Value(Object{}));
    check(!ok_of(crashed), "a server that exits fails the call");
    const Value restarted = verbs.call("playwriter_browsers", Value(Object{}));
    check(ok_of(restarted) && text_of(restarted, "output") == "[]", "the next call restarts the server");
}

void test_expansion_and_arguments(const fs::path& dir) {
    set_variable("GMNEW_PLAYWRITER_TEST_ARG", "expanded");
    const fs::path config = dir / "args" / "mcp.json";
    write_file(config, config_with("\"args\":[\"${GMNEW_PLAYWRITER_TEST_ARG}\",\"fixed\"]"));
    PlaywriterVerbs verbs(options_for(dir / "args", config));
    const Value echoed = verbs.call("playwriter_echo", Value(Object{}));
    check(ok_of(echoed) && text_of(echoed, "output") == "expanded fixed", "a set ${VAR} expands in args");
}

void test_missing_variable(const fs::path& dir) {
    unset_variable("GMNEW_PLAYWRITER_TEST_MISSING");
    const fs::path config = dir / "missing" / "mcp.json";
    write_file(config, config_with("\"env\":{\"TOKEN\":\"${GMNEW_PLAYWRITER_TEST_MISSING}\"}"));
    PlaywriterVerbs verbs(options_for(dir / "missing", config));
    check(verbs.list().empty(), "an entry with an unset ${VAR} is not started");
}

void test_depth_and_reserved(const fs::path& dir) {
    const fs::path config = dir / "depth" / "mcp.json";
    write_file(config, config_with(""));
    Options deep = options_for(dir / "depth", config);
    deep.depth = 2;
    PlaywriterVerbs too_deep(deep);
    check(too_deep.list().empty(), "the server is not started at MCP depth 2");

    Options reserved = options_for(dir / "depth", config);
    reserved.reserved = {"playwriter_browsers"};
    PlaywriterVerbs taken(reserved);
    check(!has_verb(taken.list(), "playwriter_browsers") && has_verb(taken.list(), "playwriter_execute"),
          "a reserved verb name is not shadowed and the other tools are still served");
}

void test_ignore_lines(const fs::path& dir) {
    const fs::path workspace = dir / "repo";
    fs::create_directories(workspace / ".git");
    write_file(workspace / ".gitignore", "build/");
    const fs::path config = dir / "ignore" / "mcp.json";
    write_file(config, config_with(""));
    {
        PlaywriterVerbs verbs(options_for(workspace, config));
    }
    {
        PlaywriterVerbs verbs(options_for(workspace, config));
    }
    const std::string gitignore = read_file(workspace / ".gitignore");
    check(gitignore == "build/\n.playwriter/\n", "the entry's ignore line is appended once to a git workspace's .gitignore");
}

void test_startup_failure(const fs::path& dir) {
    const fs::path config = dir / "broken" / "mcp.json";
    write_file(config, "{\"mcpServers\":{\"playwriter\":{\"command\":\"/nonexistent/gmnew-playwriter-binary\"}}}");
    PlaywriterVerbs verbs(options_for(dir / "broken", config));
    check(verbs.list().empty(), "a server that cannot start serves no verbs");
    check(!ok_of(verbs.call("playwriter_browsers", Value(Object{}))), "a call to a server that cannot start fails");
}

}

int main() {
    const fs::path dir = scratch_dir();
    test_full_surface(dir);
    test_expansion_and_arguments(dir);
    test_missing_variable(dir);
    test_depth_and_reserved(dir);
    test_ignore_lines(dir);
    test_startup_failure(dir);
    std::error_code ignored;
    fs::remove_all(dir, ignored);
    std::cout << (failures == 0 ? "playwriter ok" : "playwriter failures") << " (" << failures << ")" << std::endl;
    return failures == 0 ? 0 : 1;
}
