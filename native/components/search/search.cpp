#include "search.hpp"

#include "search_impl.hpp"

namespace gm {

namespace fs = std::filesystem;

namespace {

constexpr std::size_t MAX_SEARCH_ROOTS = 4;

const char SEARCH_SCHEMA[] =
    R"({"type":"object","properties":{"query":{"type":"string"},"k":{"type":"number"},"root":{"type":"string"}},"required":["query"]})";
const char GREP_SCHEMA[] =
    R"({"type":"object","properties":{"pattern":{"type":"string"},"path":{"type":"string"},"mode":{"type":"string"},"scope":{"type":"string"},"ignoreCase":{"type":"boolean"},"limit":{"type":"number"},"offset":{"type":"number"},"vendor":{"type":"boolean"},"root":{"type":"string"}},"required":["pattern"]})";

json::Value refused(const std::string& reason) {
    return json::Value(json::Object{{"ok", false}, {"refused", true}, {"error", "refused: " + reason}, {"output", "refused: " + reason}});
}

}

void SearchVerbs::evict_least_used() {
    auto oldest = searchers_.begin();
    for (auto it = searchers_.begin(); it != searchers_.end(); ++it) {
        if (it->second->used < oldest->second->used) oldest = it;
    }
    searchers_.erase(oldest);
}

SearchVerbs::SearchVerbs(fs::path workspace) : workspace_(std::move(workspace)) {}

SearchVerbs::~SearchVerbs() = default;

std::vector<VerbInfo> SearchVerbs::list() const {
    return {
        {"search",
         "Rank the lines of git-tracked files by BM25 and return the best k as path:line score text. An identifier also matches its parts, so planWaves matches plan and waves. k is 1 to 50, default 10. root names another existing directory to search instead of the workspace.",
         SEARCH_SCHEMA},
        {"grep",
         "Find text in the files under path: the workspace by default. root names another existing directory, or one file, to search instead of the workspace; a file root must be tracked by git unless scope is all; pass scope: 'all' for a file written in this run. pattern is at most 200 characters; a longer one is refused with its length. mode is literal (default), regex, or word. If a literal search finds nothing and the pattern has a regex character, it runs once more as a regex; an invalid regex is an error. scope is tracked (default: tracked files and untracked files that git does not ignore) or all (also gitignored files, node_modules included). A zero-match reply starts with a hint that counts the files it skipped. Returns path:line text. ignoreCase is optional; limit is 1 to 1000, default 100.",
         GREP_SCHEMA},
    };
}

json::Value SearchVerbs::call(std::string_view name, const json::Value& args) {
    std::vector<std::string> takes;
    if (name == "search") takes = {"query", "k"};
    else if (name == "grep") takes = {"pattern", "path", "mode", "scope", "ignoreCase", "limit", "offset", "vendor"};
    else return json::Value(json::Object{{"ok", false}, {"error", "unknown verb " + std::string(name)}});

    std::string unknown;
    std::string list;
    for (const std::string& take : takes) list += (list.empty() ? "" : ", ") + take;
    if (args.is_object()) {
        for (const auto& member : args.as_object()) {
            const std::string& key = member.first;
            if (key == "root") continue;
            bool known = false;
            for (const std::string& take : takes) known = known || take == key;
            if (!known) unknown += (unknown.empty() ? "" : ", ") + key;
        }
    }
    if (!unknown.empty()) return refused("unknown argument " + unknown + "; " + std::string(name) + " takes " + list + ", root");

    fs::path root = workspace_;
    json::Value scoped = args;
    if (const json::Value* given = args.find("root")) {
        if (!given->is_string() || given->as_string().empty()) return refused("root must be a non-empty path");
        root = (workspace_ / given->as_string()).lexically_normal();
        std::error_code ec;
        if (!fs::exists(root, ec)) return refused("no such root: " + given->as_string());
        if (name == "grep" && fs::is_regular_file(root, ec)) {
            if (args.find("path") != nullptr) return refused("path cannot be combined with a file root");
            scoped.set("path", root.filename().string());
            root = root.parent_path();
        } else if (!fs::is_directory(root, ec)) {
            return refused("root is not a directory: " + given->as_string());
        }
    }
    std::shared_ptr<Root> entry;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        auto found = searchers_.find(root);
        if (found == searchers_.end()) {
            if (searchers_.size() >= MAX_SEARCH_ROOTS) evict_least_used();
            auto created = std::make_shared<Root>();
            created->searcher = std::make_unique<search::Searcher>(workspace_, root == workspace_ ? fs::path() : root);
            found = searchers_.emplace(root, std::move(created)).first;
        }
        found->second->used = ++clock_;
        entry = found->second;
    }
    std::lock_guard<std::mutex> scan(entry->scan);
    std::string reply = name == "search" ? entry->searcher->search(scoped) : entry->searcher->grep(scoped);
    auto parsed = json::parse(reply);
    return parsed ? *parsed : json::Value(json::Object{{"ok", false}, {"error", "internal: unparsable reply"}});
}

}
