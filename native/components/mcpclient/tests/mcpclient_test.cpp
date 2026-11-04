#include <chrono>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <initializer_list>
#include <iostream>
#include <mutex>
#include <sstream>
#include <string>
#include <utility>
#include <vector>

#include "gmnew/json.hpp"
#include "gmnew/mcpclient.hpp"

namespace fs = std::filesystem;
using gmnew::json::Object;
using gmnew::json::Value;
using gmnew::mcpclient::ConfigFile;
using gmnew::mcpclient::McpVerbs;
using gmnew::mcpclient::Options;
using gmnew::VerbInfo;

namespace {

using Events = std::vector<std::pair<std::string, Value>>;

int failures = 0;

void check(bool ok, const std::string& what) {
    std::cout << (ok ? "ok   " : "FAIL ") << what << std::endl;
    if (!ok) ++failures;
}

struct Recorder {
    std::mutex mutex;
    Events events;

    gmnew::mcpclient::Emit sink() {
        return [this](std::string_view kind, Value fields) {
            std::lock_guard lock(mutex);
            events.emplace_back(std::string(kind), std::move(fields));
        };
    }

    Events snapshot() {
        std::lock_guard lock(mutex);
        return events;
    }
};

fs::path scratch_dir() {
    const auto stamp = std::chrono::steady_clock::now().time_since_epoch().count();
    const fs::path dir = fs::temp_directory_path() / ("gmnew-mcpclient-test-" + std::to_string(stamp));
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

std::string server(const std::string& profile, const std::string& env_extra, const std::string& more) {
    std::string env = "\"GMNEW_FAKE_PROFILE\":\"" + profile + "\"";
    if (!env_extra.empty()) env += "," + env_extra;
    return "{\"command\":" + gmnew::json::quote(GMNEW_FAKE_MCP_SERVER) + ",\"env\":{" + env +
           "},\"timeoutMs\":1500,\"startupTimeoutMs\":10000" + (more.empty() ? std::string() : "," + more) + "}";
}

std::string config_of(std::initializer_list<std::pair<std::string, std::string>> entries) {
    std::string body;
    for (const auto& [name, value] : entries) body += (body.empty() ? "" : ",") + gmnew::json::quote(name) + ":" + value;
    return "{\"mcpServers\":{" + body + "}}";
}

Options options_for(const fs::path& workspace, const fs::path& config, Recorder& recorder) {
    Options options;
    options.workspace = workspace;
    options.config_files = {ConfigFile{config, true}};
    options.emit = recorder.sink();
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

std::string field(const Value& fields, const std::string& key) { return text_of(fields, key); }

bool event_matches(const std::pair<std::string, Value>& event, const std::string& kind, const std::string& server, const std::string& state) {
    if (event.first != kind) return false;
    if (!server.empty() && field(event.second, "server") != server) return false;
    if (!state.empty() && field(event.second, "state") != state) return false;
    return true;
}

bool has_event(const Events& events, const std::string& kind, const std::string& server, const std::string& state) {
    for (const auto& event : events) {
        if (event_matches(event, kind, server, state)) return true;
    }
    return false;
}

const Value* find_event(const Events& events, const std::string& kind, const std::string& server, const std::string& state) {
    for (const auto& event : events) {
        if (event_matches(event, kind, server, state)) return &event.second;
    }
    return nullptr;
}

bool has_problem(const Events& events, const std::string& problem) {
    for (const auto& event : events) {
        if (event.first == "mcp-config" && field(event.second, "problem") == problem) return true;
    }
    return false;
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

void test_two_servers(const fs::path& dir) {
    Recorder recorder;
    const fs::path config = dir / "two" / "mcp.json";
    write_file(config, config_of({{"playwriter", server("main", "", "\"deny\":[\"reset\"],\"ignore\":[\".playwriter/\"]")},
                                  {"second", server("second", "", "\"deny\":[\"hidden\"],\"ignore\":[\"cache/\"]")}}));
    McpVerbs verbs(options_for(dir / "two", config, recorder));
    verbs.wait_ready();
    const std::vector<VerbInfo> listed = verbs.list();
    check(has_verb(listed, "playwriter_execute"), "execute is served as playwriter_execute");
    check(has_verb(listed, "playwriter_browsers"), "browsers is served as playwriter_browsers");
    check(has_verb(listed, "playwriter_extra"), "a tool on the second tools/list page is served");
    check(!has_verb(listed, "playwriter_reset"), "reset is denied by the entry and not served");
    check(has_verb(listed, "second_lookup") && has_verb(listed, "second_browsers"), "the second server's tools are served under its own name");
    check(!has_verb(listed, "second_hidden"), "the second server's denied tool is not served");
    check(has_event(recorder.snapshot(), "mcp-tool-skipped", "playwriter", ""), "a denied tool logs mcp-tool-skipped");
    for (const VerbInfo& verb : listed) {
        if (verb.name == "playwriter_execute") {
            check(verb.description.find("(MCP server playwriter, tool execute)") != std::string::npos, "description names the server and tool");
            check(verb.input_schema_json.find("\"object\"") != std::string::npos, "input schema is the server's schema");
        }
        if (verb.name == "second_lookup") {
            check(verb.description.substr(0, 300) == std::string(300, 'x') && verb.description.find("...") == 300,
                  "a description over 300 characters is cut with ...");
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

    const Value second = verbs.call("second_browsers", Value(Object{}));
    check(ok_of(second) && text_of(second, "output") == "[]", "the second server answers its own calls");

    const Value pinged = verbs.call("playwriter_ping_first", Value(Object{}));
    check(ok_of(pinged) && text_of(pinged, "output") == "pinged", "a server-to-client ping is answered and the call still completes");

    const Value crashed = verbs.call("playwriter_crash", Value(Object{}));
    check(!ok_of(crashed) && text_of(crashed, "error") == "MCP server playwriter exited with code 3", "a server that exits fails the call with its exit code");
    const Value restarted = verbs.call("playwriter_browsers", Value(Object{}));
    check(ok_of(restarted) && text_of(restarted, "output") == "[]", "the next call restarts the server");

    const Events events = recorder.snapshot();
    const Value* down = find_event(events, "mcp-server", "playwriter", "down");
    check(down != nullptr && field(*down, "reason") == "exited with code 3", "a server that exits logs down with its exit code");
    check(down != nullptr && field(*down, "stderr").find("fake boot") != std::string::npos, "the down event carries the server's stderr");
    check(has_event(events, "mcp-server", "playwriter", "restarted"), "the restart after a crash logs state restarted");
    check(has_event(events, "mcp-server", "second", "connected"), "the second server logs connected");
}

void test_expansion_and_arguments(const fs::path& dir) {
    set_variable("GMNEW_MCPCLIENT_TEST_ARG", "expanded");
    Recorder recorder;
    const fs::path config = dir / "args" / "mcp.json";
    write_file(config, config_of({{"playwriter", server("main", "", "\"args\":[\"${GMNEW_MCPCLIENT_TEST_ARG}\",\"fixed\"]")}}));
    McpVerbs verbs(options_for(dir / "args", config, recorder));
    verbs.wait_ready();
    const Value echoed = verbs.call("playwriter_echo", Value(Object{}));
    check(ok_of(echoed) && text_of(echoed, "output") == "expanded fixed", "a set ${VAR} expands in args");
}

void test_missing_variable(const fs::path& dir) {
    unset_variable("GMNEW_MCPCLIENT_TEST_MISSING");
    Recorder recorder;
    const fs::path config = dir / "missing" / "mcp.json";
    write_file(config, config_of({{"playwriter", server("main", "\"TOKEN\":\"${GMNEW_MCPCLIENT_TEST_MISSING}\"", "")}}));
    McpVerbs verbs(options_for(dir / "missing", config, recorder));
    verbs.wait_ready();
    check(verbs.list().empty(), "an entry with an unset ${VAR} is refused and not started");
    check(has_problem(recorder.snapshot(), "server playwriter: environment variable GMNEW_MCPCLIENT_TEST_MISSING is not set"),
          "the unset variable is named in an mcp-config problem");
    check(!has_event(recorder.snapshot(), "mcp-server", "playwriter", ""), "a refused entry starts no server");
}

void test_config_problems(const fs::path& dir) {
    Recorder recorder;
    const fs::path config = dir / "problems" / "mcp.json";
    write_file(config, config_of({{"dotdot", server("main", "", "\"ignore\":[\"../x\"]")},
                                  {"absolute", server("main", "", "\"ignore\":[\"/etc\"]")},
                                  {"http", "{\"type\":\"http\",\"command\":\"x\"}"},
                                  {"deny", server("main", "", "\"deny\":\"reset\"")}}));
    McpVerbs verbs(options_for(dir / "problems", config, recorder));
    verbs.wait_ready();
    const Events events = recorder.snapshot();
    check(has_problem(events, "server dotdot: ignore lines must not contain a .. segment"), "an ignore line with .. is refused");
    check(has_problem(events, "server absolute: ignore lines must be relative paths, not absolute"), "an absolute ignore line is refused");
    check(has_problem(events, "server http: type http is not supported, only stdio servers run"), "a non-stdio type is refused");
    check(has_problem(events, "server deny: deny must be an array of non-empty tool names"), "a deny that is not an array is refused");
    check(verbs.list().empty(), "refused entries serve no verbs");
}

void test_depth_and_reserved(const fs::path& dir) {
    Recorder recorder;
    const fs::path config = dir / "depth" / "mcp.json";
    write_file(config, config_of({{"playwriter", server("main", "", "")}}));
    Options deep = options_for(dir / "depth", config, recorder);
    deep.depth = 2;
    McpVerbs too_deep(std::move(deep));
    too_deep.wait_ready();
    check(too_deep.list().empty() && has_problem(recorder.snapshot(), "servers are not started at MCP depth 2, the limit is 2"),
          "the server is not started at MCP depth 2 and the problem is logged");

    Recorder taken_recorder;
    Options reserved = options_for(dir / "depth", config, taken_recorder);
    reserved.reserved = {"playwriter_browsers"};
    McpVerbs taken(std::move(reserved));
    taken.wait_ready();
    check(!has_verb(taken.list(), "playwriter_browsers") && has_verb(taken.list(), "playwriter_execute"),
          "a reserved verb name is not shadowed and the other tools are still served");
    check(has_event(taken_recorder.snapshot(), "mcp-tool-skipped", "playwriter", ""), "a shadowed name logs mcp-tool-skipped");
}

void test_ignore_lines(const fs::path& dir) {
    const fs::path workspace = dir / "repo";
    fs::create_directories(workspace / ".git");
    write_file(workspace / ".gitignore", "build/");
    const fs::path config = dir / "ignore" / "mcp.json";
    write_file(config, config_of({{"playwriter", server("main", "", "\"ignore\":[\".playwriter/\"]")}}));
    Recorder first;
    {
        McpVerbs verbs(options_for(workspace, config, first));
        verbs.wait_ready();
    }
    Recorder second;
    {
        McpVerbs verbs(options_for(workspace, config, second));
        verbs.wait_ready();
    }
    const std::string gitignore = read_file(workspace / ".gitignore");
    check(gitignore == "build/\n.playwriter/\n", "the entry's ignore line is appended once to a git workspace's .gitignore");
    check(has_event(first.snapshot(), "gitignore", "playwriter", "added"), "the first start logs gitignore added");
    check(!has_event(second.snapshot(), "gitignore", "playwriter", "added"), "a second start adds nothing and logs no added event");

    const fs::path plain = dir / "plain";
    fs::create_directories(plain);
    Recorder skipped;
    {
        McpVerbs verbs(options_for(plain, config, skipped));
        verbs.wait_ready();
    }
    check(has_event(skipped.snapshot(), "gitignore", "playwriter", "skipped"), "a workspace that is not a git repository logs gitignore skipped");
    check(!fs::exists(plain / ".gitignore"), "a workspace that is not a git repository gets no .gitignore");
}

void test_startup_failure(const fs::path& dir) {
    Recorder recorder;
    const fs::path config = dir / "broken" / "mcp.json";
    write_file(config, "{\"mcpServers\":{\"playwriter\":{\"command\":\"/nonexistent/gmnew-mcpclient-binary\"}}}");
    McpVerbs verbs(options_for(dir / "broken", config, recorder));
    verbs.wait_ready();
    check(verbs.list().empty(), "a server that cannot start serves no verbs");
    check(!ok_of(verbs.call("playwriter_browsers", Value(Object{}))), "a call to a server that cannot start fails");
    const Events events = recorder.snapshot();
    const Value* failed = find_event(events, "mcp-server", "playwriter", "failed");
    check(failed != nullptr && field(*failed, "error").find("could not start") != std::string::npos, "a server that cannot start logs failed");
}

void test_bare_initialize(const fs::path& dir) {
    Recorder recorder;
    const fs::path config = dir / "bare" / "mcp.json";
    write_file(config, config_of({{"bare", server("bare", "", "")}}));
    McpVerbs verbs(options_for(dir / "bare", config, recorder));
    verbs.wait_ready();
    const Events events = recorder.snapshot();
    const Value* connected = find_event(events, "mcp-server", "bare", "connected");
    check(connected != nullptr && field(*connected, "protocolVersion") == "2025-11-25", "an initialize result with only protocolVersion connects");
    check(find_event(events, "mcp-server", "bare", "failed") == nullptr, "an initialize result without capabilities or serverInfo.version does not fail");
    const Value browsers = verbs.call("bare_browsers", Value(Object{}));
    check(ok_of(browsers) && text_of(browsers, "output") == "[]", "a server that initialized bare serves its tools");
}

void test_startup_timeout_and_exit(const fs::path& dir) {
    Recorder silent;
    const fs::path silent_config = dir / "silent" / "mcp.json";
    write_file(silent_config, config_of({{"quiet", server("silent", "", "\"startupTimeoutMs\":1000")}}));
    McpVerbs quiet(options_for(dir / "silent", silent_config, silent));
    const auto before = std::chrono::steady_clock::now();
    quiet.list();
    const auto listing = std::chrono::steady_clock::now() - before;
    quiet.wait_ready();
    const Events events = silent.snapshot();
    const Value* failed = find_event(events, "mcp-server", "quiet", "failed");
    check(listing < std::chrono::milliseconds(500), "list does not wait for a server that is still starting");
    check(failed != nullptr && field(*failed, "error") == "initialize timed out after 1000 ms", "a server that never answers initialize fails after startupTimeoutMs");
    check(failed != nullptr && field(*failed, "stderr").find("fake boot") != std::string::npos, "the failed event carries the server's stderr");
    const Value* down = find_event(events, "mcp-server", "quiet", "down");
    check(down != nullptr && field(*down, "reason") == "stopped by gm-new", "the server is stopped before the failed event");

    Recorder quitter;
    const fs::path quit_config = dir / "quit" / "mcp.json";
    write_file(quit_config, config_of({{"quit", server("quit", "", "")}}));
    McpVerbs quit(options_for(dir / "quit", quit_config, quitter));
    quit.wait_ready();
    const Events quit_events = quitter.snapshot();
    const Value* exited = find_event(quit_events, "mcp-server", "quit", "failed");
    check(exited != nullptr && field(*exited, "error") == "MCP server quit exited with code 2", "a server that exits before initialize fails with its exit code");
    const Value* exit_down = find_event(quit_events, "mcp-server", "quit", "down");
    check(exit_down != nullptr && field(*exit_down, "reason") == "exited with code 2", "a server that exits logs down before failed");
}

}

int main() {
    const fs::path dir = scratch_dir();
    test_two_servers(dir);
    test_expansion_and_arguments(dir);
    test_missing_variable(dir);
    test_config_problems(dir);
    test_depth_and_reserved(dir);
    test_ignore_lines(dir);
    test_startup_failure(dir);
    test_startup_timeout_and_exit(dir);
    test_bare_initialize(dir);
    std::error_code ignored;
    fs::remove_all(dir, ignored);
    std::cout << (failures == 0 ? "mcpclient ok" : "mcpclient failures") << " (" << failures << ")" << std::endl;
    return failures == 0 ? 0 : 1;
}
