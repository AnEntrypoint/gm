#include "gmnew/playwriter.hpp"

#include <algorithm>
#include <cstdlib>
#include <fstream>
#include <map>
#include <set>
#include <sstream>

#include "client.hpp"
#include "config.hpp"

namespace gmnew::playwriter {

namespace fs = std::filesystem;

namespace {

constexpr const char* SERVER = "playwriter";
constexpr const char* VERB_PREFIX = "playwriter_";
constexpr std::size_t MAX_DEPTH = 2;
constexpr std::size_t DESCRIPTION_CHARS = 300;

std::string identifier_of(const std::string& text) {
    std::string out = text;
    for (char& c : out) {
        const bool word = (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_';
        if (!word) c = '_';
    }
    return out;
}

std::string describe(const json::Value& tool, const std::string& name) {
    const json::Value* description = tool.find("description");
    const json::Value* title = tool.find("title");
    std::string text = name;
    if (description != nullptr && description->is_string()) text = description->as_string();
    else if (title != nullptr && title->is_string()) text = title->as_string();
    if (text.size() > DESCRIPTION_CHARS) {
        std::size_t cut = DESCRIPTION_CHARS;
        while (cut > 0 && (static_cast<unsigned char>(text[cut]) & 0xC0) == 0x80) --cut;
        text = text.substr(0, cut) + "...";
    }
    return text + " (MCP server " + SERVER + ", tool " + name + ")";
}

void ignore_lines(const fs::path& workspace, const std::vector<std::string>& lines) {
    if (lines.empty() || !fs::exists(workspace / ".git")) return;
    const fs::path file = workspace / ".gitignore";
    std::string text;
    if (fs::exists(file)) {
        std::ifstream in(file, std::ios::binary);
        std::ostringstream buffer;
        buffer << in.rdbuf();
        text = buffer.str();
    }
    std::set<std::string> present;
    std::istringstream existing(text);
    for (std::string line; std::getline(existing, line);) {
        if (!line.empty() && line.back() == '\r') line.pop_back();
        present.insert(line);
    }
    const std::string eol = text.find("\r\n") != std::string::npos ? "\r\n" : "\n";
    std::string addition;
    for (const std::string& line : lines) {
        if (present.insert(line).second) addition += line + eol;
    }
    if (addition.empty()) return;
    const std::string lead = text.empty() || text.back() == '\n' ? std::string() : eol;
    std::ofstream out(file, std::ios::binary | std::ios::app);
    out << lead << addition;
}

}

std::size_t depth_from_environment() {
    const char* value = std::getenv("GMNEW_MCP_DEPTH");
    if (value == nullptr) return 0;
    const long parsed = std::strtol(value, nullptr, 10);
    return parsed > 0 ? static_cast<std::size_t>(parsed) : 0;
}

struct PlaywriterVerbs::Impl {
    std::unique_ptr<StdioClient> client;
    std::vector<VerbInfo> verbs;
    std::map<std::string, std::string, std::less<>> tool_of_verb;
};

PlaywriterVerbs::PlaywriterVerbs(Options options) : impl_(std::make_unique<Impl>()) {
    const auto servers = read_servers(options.config_files, options.workspace);
    const auto found = servers.find(SERVER);
    if (found == servers.end()) return;
    if (options.depth >= MAX_DEPTH) {
        warn("server " + std::string(SERVER) + " is not started at MCP depth " + std::to_string(options.depth) +
             ", the limit is " + std::to_string(MAX_DEPTH));
        return;
    }
    const ServerSpec& spec = found->second;
    impl_->client = std::make_unique<StdioClient>(spec, options.depth);
    if (auto error = impl_->client->ensure_running()) {
        warn("server " + std::string(SERVER) + ": " + *error);
        return;
    }
    ignore_lines(options.workspace, spec.ignore);
    for (const json::Value& tool : impl_->client->tools()) {
        const json::Value* name_value = tool.find("name");
        if (name_value == nullptr || !name_value->is_string()) continue;
        const std::string tool_name = name_value->as_string();
        if (std::find(spec.deny.begin(), spec.deny.end(), tool_name) != spec.deny.end()) {
            warn("tool " + tool_name + " skipped: the server entry denies it");
            continue;
        }
        const std::string verb = VERB_PREFIX + identifier_of(tool_name);
        if (options.reserved.count(verb) != 0 || impl_->tool_of_verb.count(verb) != 0) {
            warn("tool " + tool_name + " skipped: the name " + verb + " is taken");
            continue;
        }
        impl_->tool_of_verb.emplace(verb, tool_name);
        json::Value fallback{json::Object{}};
        fallback.set("type", "object");
        const json::Value* schema = tool.find("inputSchema");
        impl_->verbs.push_back({verb, describe(tool, tool_name), json::dump(schema != nullptr ? *schema : fallback)});
    }
}

PlaywriterVerbs::~PlaywriterVerbs() = default;

std::vector<VerbInfo> PlaywriterVerbs::list() const { return impl_->verbs; }

json::Value PlaywriterVerbs::call(std::string_view name, const json::Value& args) {
    const auto found = impl_->tool_of_verb.find(name);
    if (found == impl_->tool_of_verb.end()) {
        json::Value reply;
        reply.set("ok", false).set("error", "unknown tool: " + std::string(name));
        return reply;
    }
    return impl_->client->call_tool(found->second, args.is_null() ? json::Value(json::Object{}) : args);
}

}
