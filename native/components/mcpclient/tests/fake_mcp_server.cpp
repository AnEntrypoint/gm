#include <cstdlib>
#include <iostream>
#include <string>

#include "gm/json.hpp"

using gm::json::Array;
using gm::json::Object;
using gm::json::Value;

namespace {

Value text_result(const std::string& text) {
    Value part;
    part.set("type", "text").set("text", text);
    Value result;
    result.set("content", Array{part});
    return result;
}

Value tool(const std::string& name, const std::string& description) {
    Value schema;
    schema.set("type", "object");
    Value entry;
    entry.set("name", name).set("description", description).set("inputSchema", schema);
    return entry;
}

Value tools_for(const std::string& profile, const Value& params) {
    Value page;
    if (profile == "second") {
        page.set("tools", Array{tool("lookup", std::string(350, 'x')), tool("hidden", "Denied by the entry."), tool("browsers", "Second browsers.")});
        return page;
    }
    const Value* cursor = params.find("cursor");
    if (cursor == nullptr) {
        page.set("tools", Array{tool("execute", "Run code."), tool("browsers", "List browsers."), tool("reset", "Reset."),
                                tool("echo", "Echo the argv."), tool("fail", "Always fails."), tool("hang", "Never answers."),
                                tool("crash", "Exits."), tool("ping_first", "Pings the client first.")});
        page.set("nextCursor", "page2");
    } else {
        page.set("tools", Array{tool("extra", "A tool on the second page.")});
    }
    return page;
}

}

int main(int argc, char** argv) {
    const char* profile_variable = std::getenv("GMNEW_FAKE_PROFILE");
    const std::string profile = profile_variable != nullptr ? profile_variable : "main";
    std::cerr << "fake boot" << std::endl;
    if (profile == "quit") return 2;
    std::string line;
    while (std::getline(std::cin, line)) {
        auto parsed = gm::json::parse(line);
        if (!parsed) continue;
        const Value* method = parsed->find("method");
        const Value* id = parsed->find("id");
        if (method == nullptr || id == nullptr) continue;
        const std::string name = method->as_string();
        if (profile == "silent" && name == "initialize") continue;
        Value reply;
        reply.set("jsonrpc", "2.0").set("id", *id);
        const Value* params = parsed->find("params");
        const Value empty{Object{}};
        if (params == nullptr) params = &empty;
        if (name == "initialize" && profile == "bare") {
            reply.set("result", Value(Object{}).set("protocolVersion", "2025-11-25"));
        } else if (name == "initialize") {
            Value info;
            info.set("name", "fake").set("version", "1");
            reply.set("result", Value(Object{}).set("protocolVersion", "2025-11-25").set("capabilities", Object{}).set("serverInfo", info));
        } else if (name == "tools/list") {
            reply.set("result", tools_for(profile, *params));
        } else if (name == "tools/call") {
            const std::string tool_name = params->find("name")->as_string();
            const Value* arguments = params->find("arguments");
            if (tool_name == "hang") continue;
            if (tool_name == "crash") std::exit(3);
            if (tool_name == "ping_first") {
                Value ping;
                ping.set("jsonrpc", "2.0").set("id", 900).set("method", "ping");
                std::cout << gm::json::dump(ping) << '\n' << std::flush;
                reply.set("result", text_result("pinged"));
            } else if (tool_name == "fail") {
                Value result = text_result("boom");
                result.set("isError", true);
                reply.set("result", result);
            } else if (tool_name == "execute") {
                Value text;
                text.set("type", "text").set("text", "ran");
                Value image;
                image.set("type", "image").set("mimeType", "image/png");
                const Value* code = arguments != nullptr ? arguments->find("code") : nullptr;
                Value result;
                result.set("content", Array{text, image});
                result.set("structuredContent", Value(Object{}).set("code", code != nullptr ? *code : Value()));
                reply.set("result", result);
            } else if (tool_name == "echo") {
                std::string joined;
                for (int i = 1; i < argc; ++i) joined += (joined.empty() ? "" : " ") + std::string(argv[i]);
                reply.set("result", text_result(joined));
            } else if (tool_name == "browsers") {
                reply.set("result", text_result("[]"));
            } else {
                reply.set("result", text_result("extra"));
            }
        } else {
            reply.set("error", Value(Object{}).set("code", -32601).set("message", "fake does not serve " + name));
        }
        std::cout << gm::json::dump(reply) << '\n' << std::flush;
    }
    return 0;
}
