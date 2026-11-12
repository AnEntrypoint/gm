#include "gm/host/composed_verbs.hpp"

#include <mutex>
#include <set>

namespace gm::host {

deoxidene::Result<std::unique_ptr<ComposedVerbs>, std::string> ComposedVerbs::compose(std::vector<VerbTable*> tables) {
    std::set<std::string, std::less<>> seen;
    for (VerbTable* table : tables) {
        for (const VerbInfo& verb : table->list()) {
            if (!seen.insert(verb.name).second)
                return deoxidene::Err<std::string>("verb " + verb.name + " is defined by two verb tables");
        }
    }
    return std::unique_ptr<ComposedVerbs>(new ComposedVerbs(std::move(tables)));
}

ComposedVerbs::ComposedVerbs(std::vector<VerbTable*> tables) : tables_(std::move(tables)) { reindex(); }

void ComposedVerbs::reindex() const {
    std::map<std::string, VerbTable*, std::less<>> fresh;
    for (VerbTable* table : tables_) {
        for (const VerbInfo& verb : table->list()) fresh.emplace(verb.name, table);
    }
    std::unique_lock lock(index_mutex_);
    index_ = std::move(fresh);
}

VerbTable* ComposedVerbs::route(std::string_view name) const {
    std::shared_lock lock(index_mutex_);
    const auto it = index_.find(name);
    return it == index_.end() ? nullptr : it->second;
}

std::vector<VerbInfo> ComposedVerbs::list() const {
    std::vector<VerbInfo> all;
    std::set<std::string, std::less<>> seen;
    for (VerbTable* table : tables_) {
        for (VerbInfo& verb : table->list()) {
            if (seen.insert(verb.name).second) all.push_back(std::move(verb));
        }
    }
    return all;
}

json::Value ComposedVerbs::call_sibling(std::string_view sibling, std::string_view tool, const json::Value& args) {
    VerbTable* table = route(sibling);
    if (table == nullptr) {
        reindex();
        table = route(sibling);
    }
    if (table == nullptr) {
        json::Value reply;
        reply.set("ok", false);
        reply.set("error", "unknown tool: " + std::string(tool));
        return reply;
    }
    return table->call_sibling(sibling, tool, args);
}

json::Value ComposedVerbs::call(std::string_view name, const json::Value& args) {
    VerbTable* table = route(name);
    if (table == nullptr) {
        reindex();
        table = route(name);
    }
    if (table == nullptr) {
        json::Value reply;
        reply.set("ok", false);
        reply.set("error", "unknown tool: " + std::string(name));
        return reply;
    }
    return table->call(name, args);
}

namespace {

std::optional<json::Value> schema_of(const VerbTable& verbs, std::string_view name) {
    for (const VerbInfo& verb : verbs.list()) {
        if (verb.name != name) continue;
        auto schema = json::parse(verb.input_schema_json.empty() ? std::string_view("{}") : std::string_view(verb.input_schema_json));
        if (!schema) return std::nullopt;
        return std::move(*schema);
    }
    return std::nullopt;
}

}

std::optional<json::Value> refuse_unknown_keys(const VerbTable& verbs, std::string_view name, const json::Value& args) {
    if (!args.is_object() || args.as_object().empty()) return std::nullopt;
    const std::optional<json::Value> schema = schema_of(verbs, name);
    if (!schema) return std::nullopt;
    const json::Value* properties = schema->find("properties");
    if (properties == nullptr || !properties->is_object()) return std::nullopt;
    std::string unknown;
    for (const json::Member& member : args.as_object()) {
        if (properties->find(member.first) != nullptr) continue;
        unknown += (unknown.empty() ? "" : ", ") + member.first;
    }
    if (unknown.empty()) return std::nullopt;
    std::string accepted;
    for (const json::Member& declared : properties->as_object()) {
        accepted += (accepted.empty() ? "" : ", ") + declared.first;
    }
    json::Value reply;
    reply.set("ok", false);
    reply.set("error", "refused: unknown argument " + unknown + "; " + std::string(name) + " takes " + (accepted.empty() ? std::string("none") : accepted));
    return reply;
}

}
