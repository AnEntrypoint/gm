#include <cstdlib>
#include <iostream>
#include <string>

#include "gmnew/json.hpp"

using gmnew::json::Array;
using gmnew::json::Object;
using gmnew::json::Value;

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

Value tools_for(const Value& params) {
    Value page;
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
    std::string line;
    while (std::getline(std::cin, line)) {
        auto parsed = gmnew::json::parse(line);
        if (!parsed) continue;
        const Value* method = parsed->find("method");
        const Value* id = parsed->find("id");
        if (method == nullptr || id == nullptr) continue;
        const std::string name = method->as_string();
        Value reply;
        reply.set("jsonrpc", "2.0").set("id", *id);
        const Value* params = parsed->find("params");
        const Value empty{Object{}};
        if (params == nullptr) params = &empty;
        if (name == "initialize") {
            Value info;
            info.set("name", "fake");
            reply.set("result", Value(Object{}).set("protocolVersion", "2025-11-25").set("serverInfo", info));
        } else if (name == "tools/list") {
            reply.set("result", tools_for(*params));
        } else if (name == "tools/call") {
            const std::string tool_name = params->find("name")->as_string();
            const Value* arguments = params->find("arguments");
            if (tool_name == "hang") continue;
            if (tool_name == "crash") std::exit(3);
            if (tool_name == "ping_first") {
                Value ping;
                ping.set("jsonrpc", "2.0").set("id", 900).set("method", "ping");
                std::cout << gmnew::json::dump(ping) << '\n' << std::flush;
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
        std::cout << gmnew::json::dump(reply) << '\n' << std::flush;
    }
    return 0;
}
