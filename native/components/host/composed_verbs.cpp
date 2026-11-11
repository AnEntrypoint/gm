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

}
