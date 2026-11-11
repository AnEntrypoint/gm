#include "gm/mcpclient.hpp"

#include <algorithm>
#include <condition_variable>
#include <cstdlib>
#include <fstream>
#include <map>
#include <mutex>
#include <optional>
#include <sstream>
#include <thread>

#include "client.hpp"
#include "config.hpp"

namespace gm::mcpclient {

namespace {

constexpr std::size_t MAX_DEPTH = 2;
constexpr std::size_t DESCRIPTION_UNITS = 300;

std::size_t sequence_length(unsigned char lead) {
    if (lead < 0x80) return 1;
    if (lead >= 0xF0) return 4;
    if (lead >= 0xE0) return 3;
    if (lead >= 0xC0) return 2;
    return 1;
}

std::string identifier_of(const std::string& text) {
    std::string out;
    for (std::size_t at = 0; at < text.size();) {
        const auto lead = static_cast<unsigned char>(text[at]);
        const std::size_t length = sequence_length(lead);
        const bool word = length == 1 && ((lead >= 'A' && lead <= 'Z') || (lead >= 'a' && lead <= 'z') || (lead >= '0' && lead <= '9') || lead == '_');
        if (word) out.push_back(static_cast<char>(lead));
        else out.append(length == 4 ? 2 : 1, '_');
        at += length;
    }
    return out;
}

std::string verb_name(const std::string& server, const std::string& tool) {
    const std::string name = identifier_of(server) + "_" + identifier_of(tool);
    return !name.empty() && name[0] >= '0' && name[0] <= '9' ? "mcp_" + name : name;
}

std::string short_text(const std::string& text) {
    std::size_t units = 0;
    for (std::size_t at = 0; at < text.size();) {
        const std::size_t length = sequence_length(static_cast<unsigned char>(text[at]));
        const std::size_t cost = length == 4 ? 2 : 1;
        if (units + cost > DESCRIPTION_UNITS) return text.substr(0, at) + "...";
        units += cost;
        at += length;
    }
    return text;
}

std::string describe(const std::string& server, const json::Value& tool, const std::string& name) {
    const json::Value* description = tool.find("description");
    const json::Value* title = tool.find("title");
    std::string text = name;
    if (description != nullptr && description->is_string()) text = description->as_string();
    else if (title != nullptr && title->is_string()) text = title->as_string();
    return short_text(text) + " (MCP server " + server + ", tool " + name + ")";
}

std::size_t depth_of(const char* text) {
    if (text == nullptr) return 0;
    const long parsed = std::strtol(text, nullptr, 10);
    return parsed > 0 ? static_cast<std::size_t>(parsed) : 0;
}

}

std::size_t depth_from_environment() { return depth_of(std::getenv("GMNEW_MCP_DEPTH")); }

struct Route {
    StdioClient* client = nullptr;
    std::string tool;
};

namespace {

std::optional<std::vector<json::Value>> read_tool_cache(const std::filesystem::path& file) {
    std::ifstream in(file, std::ios::binary);
    if (!in) return std::nullopt;
    std::ostringstream text;
    text << in.rdbuf();
    auto parsed = json::parse(text.str());
    if (!parsed || !parsed->is_object()) return std::nullopt;
    const json::Value* tools = parsed->find("tools");
    if (tools == nullptr || !tools->is_array()) return std::nullopt;
    return tools->as_array();
}

}

struct McpVerbs::Impl {
    Emit emit;
    std::set<std::string, std::less<>> reserved;
    std::vector<std::unique_ptr<StdioClient>> clients;
    std::thread starter;
    std::mutex mutex;
    std::condition_variable ready_changed;
    bool ready = false;
    std::vector<VerbInfo> verbs;
    std::map<std::string, Route, std::less<>> routes;

    void announce(std::string_view kind, json::Value fields) const {
        if (emit) emit(kind, std::move(fields));
    }

    void start_all() {
        std::vector<std::thread> connects;
        for (const std::unique_ptr<StdioClient>& client : clients) {
            if (client->preloaded()) continue;
            connects.emplace_back([c = client.get()] { c->connect(false); });
        }
        for (std::thread& connect : connects) connect.join();
        build_routes();
        {
            std::lock_guard lock(mutex);
            ready = true;
        }
        ready_changed.notify_all();
    }

    void build_routes() {
        std::vector<VerbInfo> built;
        std::map<std::string, Route, std::less<>> table;
        for (const std::unique_ptr<StdioClient>& client : clients) {
            const ServerSpec& spec = client->spec();
            for (const json::Value& tool : client->tools()) {
                const json::Value* name_value = tool.find("name");
                if (name_value == nullptr || !name_value->is_string()) continue;
                const std::string tool_name = name_value->as_string();
                const std::string verb = verb_name(spec.name, tool_name);
                if (std::find(spec.deny.begin(), spec.deny.end(), tool_name) != spec.deny.end()) {
                    skip(spec.name, tool_name, verb, "the server entry denies it");
                    continue;
                }
                if (reserved.count(verb) != 0 || table.count(verb) != 0) {
                    skip(spec.name, tool_name, verb, reserved.count(verb) != 0 ? "the name is a gm verb" : "the name is another MCP tool");
                    continue;
                }
                table.emplace(verb, Route{client.get(), tool_name});
                const json::Value* schema = tool.find("inputSchema");
                json::Value fallback{json::Object{}};
                fallback.set("type", "object");
                built.push_back({verb, describe(spec.name, tool, tool_name), json::dump(schema != nullptr ? *schema : fallback)});
            }
        }
        std::lock_guard lock(mutex);
        verbs = std::move(built);
        routes = std::move(table);
    }

    void skip(const std::string& server, const std::string& tool, const std::string& verb, const std::string& reason) const {
        json::Value fields;
        fields.set("server", server).set("tool", tool).set("verb", verb).set("reason", reason);
        announce("mcp-tool-skipped", std::move(fields));
    }
};

McpVerbs::McpVerbs(Options options) : impl_(std::make_unique<Impl>()) {
    impl_->emit = std::move(options.emit);
    impl_->reserved = std::move(options.reserved);
    ConfigReading reading = read_servers(options.config_files, options.workspace);
    for (const std::string& problem : reading.problems) {
        json::Value fields;
        fields.set("problem", problem);
        impl_->announce("mcp-config", std::move(fields));
    }
    std::vector<ServerSpec> specs = std::move(reading.servers);
    if (options.depth >= MAX_DEPTH) {
        if (!specs.empty()) {
            json::Value fields;
            fields.set("problem", "servers are not started at MCP depth " + std::to_string(options.depth) + ", the limit is " + std::to_string(MAX_DEPTH));
            impl_->announce("mcp-config", std::move(fields));
        }
        specs.clear();
    }
    for (ServerSpec& spec : specs) {
        const bool lazy = spec.lazy;
        const std::string name = spec.name;
        auto client = std::make_unique<StdioClient>(std::move(spec), options.depth, impl_->emit);
        if (lazy && !options.tool_cache.empty()) {
            if (auto tools = read_tool_cache(options.tool_cache / (name + ".json"))) client->preload_tools(std::move(*tools));
        }
        impl_->clients.push_back(std::move(client));
    }
    impl_->starter = std::thread([impl = impl_.get()] { impl->start_all(); });
}

McpVerbs::~McpVerbs() {
    if (!impl_) return;
    for (const std::unique_ptr<StdioClient>& client : impl_->clients) client->stop();
    if (impl_->starter.joinable()) impl_->starter.join();
}

std::vector<VerbInfo> McpVerbs::list() const {
    std::lock_guard lock(impl_->mutex);
    return impl_->verbs;
}

json::Value McpVerbs::call(std::string_view name, const json::Value& args) {
    StdioClient* client = nullptr;
    std::string tool;
    {
        std::lock_guard lock(impl_->mutex);
        const auto found = impl_->routes.find(name);
        if (found != impl_->routes.end()) {
            client = found->second.client;
            tool = found->second.tool;
        }
    }
    if (client == nullptr) {
        json::Value reply;
        reply.set("ok", false).set("error", "unknown tool: " + std::string(name));
        return reply;
    }
    return client->call_tool(tool, args.is_null() ? json::Value(json::Object{}) : args);
}

void McpVerbs::wait_ready() const {
    std::unique_lock lock(impl_->mutex);
    impl_->ready_changed.wait(lock, [this] { return impl_->ready; });
}

}
