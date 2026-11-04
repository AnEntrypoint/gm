#pragma once

#include <cstddef>
#include <filesystem>
#include <map>
#include <string>
#include <unordered_map>
#include <vector>

#include "gmnew/json.hpp"

namespace gmnew::search {

struct FileEntry {
    std::string stamp;
    bool settled = false;
    std::vector<std::string> lines;
};

struct Listing {
    bool ok = false;
    std::vector<std::string> paths;
};

class Searcher {
public:
    explicit Searcher(std::filesystem::path workspace, std::filesystem::path root = {});

    std::string search(const json::Value& args);
    std::string grep(const json::Value& args);

private:
    struct Posting {
        std::size_t doc;
        int tf;
    };
    struct Doc {
        const FileEntry* file;
        const std::string* path;
        std::size_t line;
        int len;
    };
    struct Index {
        std::vector<Doc> docs;
        std::unordered_map<std::string, std::vector<Posting>> postings;
        double average = 1;
    };

    Listing list(const std::vector<std::string>& args, bool cached);
    bool load_tracked(std::string& error);
    void build_index();

    std::filesystem::path workspace_;
    std::filesystem::path root_;
    std::map<std::string, FileEntry> files_;
    std::vector<std::string> tracked_;
    Index index_;
    std::string index_key_;
    std::string listing_key_;
    Listing listing_;
};

}  // namespace gmnew::search
