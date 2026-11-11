#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdio>
#include <ctime>
#include <filesystem>
#include <map>
#include <optional>
#include <regex>
#include <set>
#include <sstream>
#include <string>
#include <system_error>
#include <vector>

#include "core_internal.hpp"
#include "gm/proc.hpp"

namespace gm::core {
namespace {

namespace fs = std::filesystem;

constexpr double kK1 = 1.2;
constexpr double kB = 0.75;
constexpr std::uintmax_t kMaxFileBytes = 1000000;
constexpr std::uint64_t kListTimeoutMs = 30000;
constexpr std::size_t kSnippetChars = 300;
constexpr std::size_t kBinaryProbe = 8000;
constexpr int kDefaultK = 10;
constexpr int kMaxK = 50;
const std::vector<std::string> kRootArgs{"root", "projectPath", "cwd"};
const std::vector<std::string> kSearchTakes{"query", "k"};
const std::vector<std::string> kKinds{"ingest", "answer", "lint"};
const std::set<std::string> kStateDirs{".git", ".gm", ".agentplug", ".agentplug-kv", ".playwriter", "runs", "node_modules", "vendor"};
const std::string kRootNote = "root (or its aliases projectPath and cwd) names another existing directory to search instead of the workspace; with a root other than the workspace, hits show absolute paths. An unknown argument is refused by name.";

bool page_name(const std::string& text) { return std::regex_match(text, std::regex("^[a-z0-9][a-z0-9-]{0,63}$")); }
bool source_id(const std::string& text) { return std::regex_match(text, std::regex("^[0-9a-f]{12}$")); }

bool is_ascii(const std::string& text) {
    return std::all_of(text.begin(), text.end(), [](unsigned char c) { return c < 0x80; });
}

std::string trim_text(const std::string& text) {
    const auto first = text.find_first_not_of(" \t\r\n");
    if (first == std::string::npos) return "";
    return text.substr(first, text.find_last_not_of(" \t\r\n") - first + 1);
}

bool one_line(const std::string& text) {
    return !trim_text(text).empty() && text.find_first_of("\r\n") == std::string::npos && is_ascii(text);
}

std::string ascii_escape_units(const std::string& text) {
    std::string out;
    std::size_t at = 0;
    while (at < text.size()) {
        const auto lead = static_cast<unsigned char>(text[at]);
        if (lead < 0x80) {
            out += static_cast<char>(lead);
            ++at;
            continue;
        }
        const std::size_t size = lead < 0xE0 ? 2 : lead < 0xF0 ? 3 : 4;
        std::uint32_t code = size == 2 ? lead & 0x1F : size == 3 ? lead & 0x0F : lead & 0x07;
        for (std::size_t i = 1; i < size && at + i < text.size(); ++i) code = (code << 6) | (static_cast<unsigned char>(text[at + i]) & 0x3F);
        at += size;
        const std::uint32_t units[2] = {code >= 0x10000 ? 0xD800 + ((code - 0x10000) >> 10) : code, code >= 0x10000 ? 0xDC00 + ((code - 0x10000) & 0x3FF) : 0};
        for (std::size_t i = 0; i < (code >= 0x10000 ? 2u : 1u); ++i) {
            char buf[8];
            std::snprintf(buf, sizeof(buf), "\\u%04x", units[i]);
            out += buf;
        }
    }
    return out;
}

std::string lower(std::string text) {
    std::transform(text.begin(), text.end(), text.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return text;
}

std::vector<std::string> tokens_of(const std::string& text) {
    static const std::regex word(R"([A-Za-z0-9_]+)");
    static const std::regex camel(R"(([a-z0-9])([A-Z]))");
    std::vector<std::string> out;
    for (auto it = std::sregex_iterator(text.begin(), text.end(), word), end = std::sregex_iterator(); it != end; ++it) {
        const std::string whole = lower(it->str());
        out.push_back(whole);
        const std::string spaced = std::regex_replace(it->str(), camel, "$1 $2");
        std::vector<std::string> parts;
        std::string current;
        for (char c : spaced) {
            if (c == '_' || c == ' ') {
                if (!current.empty()) parts.push_back(lower(current));
                current.clear();
            } else {
                current += c;
            }
        }
        if (!current.empty()) parts.push_back(lower(current));
        if (parts.size() > 1) out.insert(out.end(), parts.begin(), parts.end());
    }
    return out;
}

struct Line {
    std::string text;
    std::size_t len = 0;
    std::map<std::string, int> tf;
};

Line line_of(const std::string& text) {
    Line line;
    line.text = text;
    const auto tokens = tokens_of(text);
    line.len = tokens.size();
    for (const auto& term : tokens) line.tf[term] += 1;
    return line;
}

struct Entry {
    std::string rel;
    std::vector<Line> lines;
};

struct Doc {
    std::string path;
    std::size_t line = 0;
    std::string text;
    std::size_t len = 0;
    std::map<std::string, int> tf;
};

struct Index {
    std::vector<Doc> docs;
    std::map<std::string, std::vector<std::size_t>> postings;
    double avg = 0;
};

Index build_index(const std::vector<Entry>& entries) {
    Index index;
    for (const auto& entry : entries) {
        for (std::size_t i = 0; i < entry.lines.size(); ++i) {
            const Line& line = entry.lines[i];
            if (line.len > 0) index.docs.push_back(Doc{entry.rel, i + 1, line.text, line.len, line.tf});
        }
    }
    for (std::size_t id = 0; id < index.docs.size(); ++id)
        for (const auto& [term, count] : index.docs[id].tf) {
            (void)count;
            index.postings[term].push_back(id);
        }
    double total = 0;
    for (const auto& doc : index.docs) total += static_cast<double>(doc.len);
    index.avg = total / static_cast<double>(std::max<std::size_t>(index.docs.size(), 1));
    return index;
}

struct Hit {
    const Doc* doc;
    double score;
};

std::vector<Hit> rank(const Index& index, const std::vector<std::string>& terms, int k) {
    std::map<std::size_t, double> scores;
    const auto n = static_cast<double>(index.docs.size());
    for (const auto& term : terms) {
        const auto found = index.postings.find(term);
        if (found == index.postings.end()) continue;
        const auto df = static_cast<double>(found->second.size());
        const double idf = std::log(1 + (n - df + 0.5) / (df + 0.5));
        for (std::size_t id : found->second) {
            const Doc& doc = index.docs[id];
            const double tf = doc.tf.at(term);
            const double weight = (tf * (kK1 + 1)) / (tf + kK1 * (1 - kB + (kB * static_cast<double>(doc.len)) / index.avg));
            scores[id] += idf * weight;
        }
    }
    std::vector<std::pair<std::size_t, double>> ordered(scores.begin(), scores.end());
    std::stable_sort(ordered.begin(), ordered.end(), [](const auto& a, const auto& b) { return a.second != b.second ? a.second > b.second : a.first < b.first; });
    std::vector<Hit> hits;
    for (std::size_t i = 0; i < ordered.size() && i < static_cast<std::size_t>(k); ++i) hits.push_back(Hit{&index.docs[ordered[i].first], ordered[i].second});
    return hits;
}

std::string snippet(const std::string& text) { return text.size() <= kSnippetChars ? text : text.substr(0, kSnippetChars) + " ..."; }

std::string read_whole(const fs::path& path, bool& ok) {
    const auto file = read_text(path, "open");
    ok = file.ok;
    return file.ok ? file.text : std::string();
}

bool exists_file(const fs::path& path) {
    std::error_code ec;
    return fs::exists(path, ec);
}

json::Value refusal_result(const std::string& reason) {
    json::Value reply;
    reply.set("ok", false);
    reply.set("refused", true);
    reply.set("error", "refused: " + reason);
    return reply;
}

json::Value write_refusal(const std::string& reason) {
    json::Value reply;
    reply.set("ok", false);
    reply.set("error", "refused: " + reason);
    return reply;
}

json::Value fail_result(const std::string& message) {
    json::Value reply;
    reply.set("ok", false);
    reply.set("error", message);
    return reply;
}

std::vector<std::string> walk_wiki(const fs::path& root) {
    std::vector<std::string> paths;
    std::vector<std::string> pending{""};
    while (!pending.empty()) {
        const std::string dir = pending.back();
        pending.pop_back();
        std::error_code ec;
        for (const auto& entry : fs::directory_iterator(root / "wiki" / dir, ec)) {
            const std::string bare = entry.path().filename().string();
            if (bare.empty()) continue;
            const std::string rel = dir.empty() ? bare : dir + "/" + bare;
            if (entry.is_directory(ec)) {
                if (bare.rfind('.', 0) == 0 || kStateDirs.count(bare) > 0) continue;
                pending.push_back(rel);
            } else {
                paths.push_back("wiki/" + rel);
            }
        }
    }
    std::sort(paths.begin(), paths.end());
    return paths;
}

struct Listing {
    std::vector<Entry> entries;
    std::string error;
};

Listing wiki_entries(const fs::path& root) {
    Listing listing;
    const auto git = proc::run({"git", "ls-files", "-z", "-co", "--exclude-standard", "--", "wiki"}, root, {}, kListTimeoutMs);
    const bool failed = !git.started || git.timed_out || git.exit_code != 0;
    std::vector<std::string> rels;
    if (failed) {
        rels = walk_wiki(root);
    } else {
        std::string piece;
        for (char c : git.out) {
            if (c == '\0') {
                if (!piece.empty()) rels.push_back(piece);
                piece.clear();
            } else {
                piece += c;
            }
        }
    }
    if (failed && rels.empty()) {
        listing.error = "search and grep found no files in " + root.string() + ": git ls-files failed (not a git repository or git unavailable) and a directory walk found no files";
        return listing;
    }
    for (const auto& rel : rels) {
        const fs::path at = root / rel;
        std::error_code ec;
        if (!fs::is_regular_file(at, ec) || fs::file_size(at, ec) > kMaxFileBytes) continue;
        bool ok = false;
        const std::string text = read_whole(at, ok);
        if (!ok) continue;
        Entry entry{rel, {}};
        if (text.substr(0, kBinaryProbe).find('\0') == std::string::npos) {
            std::istringstream lines(text);
            for (std::string raw; std::getline(lines, raw);) {
                if (!raw.empty() && raw.back() == '\r') raw.pop_back();
                entry.lines.push_back(line_of(raw));
            }
        }
        listing.entries.push_back(std::move(entry));
    }
    return listing;
}

std::optional<fs::path> home_of(const json::Value& args, const fs::path& workspace, std::string& error) {
    std::vector<std::string> given;
    for (const auto& key : kRootArgs)
        if (args.find(key) != nullptr) given.push_back(key);
    if (given.empty()) return workspace;
    std::set<std::string> dirs;
    for (const auto& key : given) {
        const json::Value* value = args.find(key);
        if (!value->is_string() || value->as_string().empty()) {
            error = key + " must be a non-empty path";
            return std::nullopt;
        }
        const std::string path = value->as_string();
        const fs::path resolved = path.rfind('/', 0) == 0 || (path.size() > 1 && path[1] == ':') ? fs::path(path) : workspace / path;
        dirs.insert(fs::absolute(resolved).lexically_normal().string());
    }
    if (dirs.size() > 1) {
        std::string joined;
        for (const auto& key : given) joined += (joined.empty() ? "" : " and ") + key;
        error = joined + " name different roots; pass one";
        return std::nullopt;
    }
    const fs::path dir = *dirs.begin();
    std::error_code ec;
    if (!fs::exists(dir, ec)) {
        error = "no such root: " + args.find(given.front())->as_string();
        return std::nullopt;
    }
    if (!fs::is_directory(dir, ec)) {
        error = "root is not a directory: " + args.find(given.front())->as_string();
        return std::nullopt;
    }
    return dir == fs::absolute(workspace).lexically_normal() ? workspace : dir;
}

json::Value wiki_search(const json::Value& args, const fs::path& workspace) {
    std::vector<std::string> unknown;
    for (const auto& member : args.as_object()) {
        const auto& key = member.first;
        if (std::find(kSearchTakes.begin(), kSearchTakes.end(), key) == kSearchTakes.end() && std::find(kRootArgs.begin(), kRootArgs.end(), key) == kRootArgs.end()) unknown.push_back(key);
    }
    if (!unknown.empty()) {
        std::string names;
        for (const auto& key : unknown) names += (names.empty() ? "" : ", ") + key;
        return refusal_result("unknown argument " + names + "; wiki_search takes query, k, root");
    }
    std::string error;
    const auto home = home_of(args, workspace, error);
    if (!home) return refusal_result(error);
    const json::Value* query_value = args.find("query");
    if (query_value == nullptr || !query_value->is_string() || trim_text(query_value->as_string()).empty()) return fail_result("query must be a non-empty string");
    int k = kDefaultK;
    if (const json::Value* kv = args.find("k"); kv != nullptr && !kv->is_null()) {
        if (!kv->is_number() || kv->as_number() != std::floor(kv->as_number()) || kv->as_number() < 1 || kv->as_number() > kMaxK)
            return fail_result("k must be an integer from 1 to " + std::to_string(kMaxK));
        k = static_cast<int>(kv->as_number());
    }
    std::vector<std::string> terms;
    for (const auto& term : tokens_of(query_value->as_string()))
        if (std::find(terms.begin(), terms.end(), term) == terms.end()) terms.push_back(term);
    if (terms.empty()) return fail_result("query has no word characters");
    const Listing listing = wiki_entries(*home);
    if (!listing.error.empty()) return fail_result(listing.error);
    const bool at_workspace = *home == workspace;
    const Index index = build_index(listing.entries);
    std::string output;
    for (const auto& hit : rank(index, terms, k)) {
        if (!output.empty()) output += "\n";
        const std::string shown = at_workspace ? hit.doc->path : home->string() + "/" + hit.doc->path;
        char score[32];
        std::snprintf(score, sizeof(score), "%.3f", hit.score);
        output += shown + ":" + std::to_string(hit.doc->line) + " " + score + " " + snippet(hit.doc->text);
    }
    json::Value reply;
    reply.set("ok", true);
    reply.set("output", output.empty() ? std::string("(no match)") : output);
    return reply;
}

std::optional<std::string> source_text(const fs::path& root, const std::string& id) {
    if (!source_id(id)) return std::nullopt;
    const fs::path file = root / "sources" / (id + ".txt");
    if (!exists_file(file)) return std::nullopt;
    bool ok = false;
    const std::string text = read_whole(file, ok);
    if (!ok) return std::nullopt;
    return text;
}

json::Value strings_array(const std::vector<std::string>& items) {
    json::Array out;
    for (const auto& item : items) out.push_back(json::Value(item));
    return json::Value(std::move(out));
}

std::vector<std::string> string_list(const json::Value* value) {
    std::vector<std::string> out;
    if (value == nullptr || !value->is_array()) return out;
    for (const auto& item : value->as_array())
        if (item.is_string()) out.push_back(item.as_string());
    return out;
}

std::string put(const fs::path& path, const std::string& content) {
    std::error_code ec;
    fs::create_directories(path.parent_path(), ec);
    if (ec) return ec.message();
    return write_text(path, content);
}

json::Value wiki_write(const json::Value& args, const fs::path& root, LockedLog& log) {
    const json::Value* page_value = args.find("page");
    if (page_value == nullptr || !page_value->is_string() || !page_name(page_value->as_string())) return write_refusal("page must be lowercase letters, digits and hyphens, at most 64 characters");
    const std::string page = page_value->as_string();
    const json::Value* title_value = args.find("title");
    const std::string title = title_value != nullptr && title_value->is_string() ? title_value->as_string() : page;
    if (!one_line(title)) return write_refusal("title must be one line of ASCII");
    const json::Value* body_value = args.find("body");
    if (body_value == nullptr || !body_value->is_string() || !is_ascii(body_value->as_string())) return write_refusal("body must be ASCII text; write non-ASCII as \\uXXXX");
    const std::string body = body_value->as_string();
    const json::Value* summary_value = args.find("summary");
    if (summary_value == nullptr || !summary_value->is_string() || !one_line(summary_value->as_string())) return write_refusal("summary must be one line of ASCII");
    const std::string summary = summary_value->as_string();
    std::string kind = "ingest";
    if (const json::Value* kv = args.find("kind"); kv != nullptr && kv->is_string()) kind = kv->as_string();
    if (std::find(kKinds.begin(), kKinds.end(), kind) == kKinds.end()) return write_refusal("kind must be one of ingest, answer, lint");
    const json::Value* sources_value = args.find("sources");
    if (sources_value == nullptr || !sources_value->is_array() || sources_value->as_array().empty()) return write_refusal("sources must be a non-empty list of source ids");
    std::vector<std::string> sources;
    for (const auto& item : sources_value->as_array()) {
        if (!item.is_string() || !source_id(item.as_string())) return write_refusal("sources must be a non-empty list of source ids");
        sources.push_back(item.as_string());
    }
    for (const auto& id : sources)
        if (!source_text(root, id)) return write_refusal("source " + id + " is not in sources/");
    const json::Value* claims_value = args.find("claims");
    if (claims_value != nullptr && !claims_value->is_array()) return write_refusal("claims must be a list of {quote, source}");
    json::Array claims;
    if (claims_value != nullptr) claims = claims_value->as_array();
    for (std::size_t i = 0; i < claims.size(); ++i) {
        const json::Value& claim = claims[i];
        const json::Value* quote = claim.find("quote");
        const json::Value* source = claim.find("source");
        if (quote == nullptr || !quote->is_string() || quote->as_string().empty() || source == nullptr || !source->is_string() ||
            std::find(sources.begin(), sources.end(), source->as_string()) == sources.end())
            return write_refusal("claim " + std::to_string(i + 1) + " needs a quote and a source that is listed in sources");
        const auto text = source_text(root, source->as_string());
        if (!text || text->find(ascii_escape_units(quote->as_string())) == std::string::npos)
            return write_refusal("claim " + std::to_string(i + 1) + ": the quote is not in source " + source->as_string());
    }
    for (const char* key : {"contradicts", "resolves"}) {
        const json::Value* list = args.find(key);
        if (list == nullptr) continue;
        if (!list->is_array()) return write_refusal("contradicts and resolves must be lists of page names");
        for (const auto& item : list->as_array())
            if (!item.is_string() || !page_name(item.as_string())) return write_refusal("contradicts and resolves must be lists of page names");
    }
    const auto now = iso_now();
    json::Array stored_claims;
    for (const auto& claim : claims) {
        json::Value stored{json::Object{}};
        stored.set("quote", ascii_escape_units(claim.find("quote")->as_string()));
        stored.set("source", claim.find("source")->as_string());
        stored_claims.push_back(stored);
    }
    std::string front = "---\ntitle: " + json::dump(json::Value(title)) + "\nupdated: " + json::dump(json::Value(now)) + "\nsources: " + json::dump(strings_array(sources)) +
                        "\nclaims: " + json::dump(json::Value(stored_claims)) + "\ncontradicts: " + json::dump(strings_array(string_list(args.find("contradicts")))) +
                        "\nresolves: " + json::dump(strings_array(string_list(args.find("resolves")))) + "\n---";
    const fs::path dir = root / "wiki";
    if (const auto error = put(dir / (page + ".md"), front + "\n" + (!body.empty() && body.back() == '\n' ? body : body + "\n")); !error.empty()) return fail_result(error);

    bool ok = false;
    const fs::path index_path = dir / "index.md";
    std::string index_text = exists_file(index_path) ? read_whole(index_path, ok) : std::string("# Index\n\n");
    std::vector<std::string> rows;
    std::istringstream index_in(index_text);
    for (std::string row; std::getline(index_in, row);) rows.push_back(row);
    if (!rows.empty() && rows.back().empty()) rows.pop_back();
    const std::string entry = "- [[" + page + "]] - " + summary;
    const std::string prefix = "- [[" + page + "]] - ";
    const auto at = std::find_if(rows.begin(), rows.end(), [&](const std::string& row) { return row.rfind(prefix, 0) == 0; });
    if (at != rows.end()) *at = entry;
    else rows.push_back(entry);
    std::string joined;
    for (const auto& row : rows) joined += row + "\n";
    if (const auto error = put(index_path, joined); !error.empty()) return fail_result(error);

    const fs::path log_path = dir / "log.md";
    const std::string log_before = exists_file(log_path) ? read_whole(log_path, ok) : std::string("# Log\n\n");
    if (const auto error = put(log_path, log_before + "## [" + now.substr(0, 10) + "] " + kind + " | " + title + "\n"); !error.empty()) return fail_result(error);
    json::Value fields{json::Object{}};
    fields.set("page", page);
    fields.set("writeKind", kind);
    fields.set("sources", static_cast<std::uint64_t>(sources.size()));
    fields.set("claims", static_cast<std::uint64_t>(claims.size()));
    log.append("wiki", std::move(fields));
    json::Value result{json::Object{}};
    result.set("ok", true);
    result.set("output", "wrote wiki/" + page + ".md, its index entry and its log line");
    result.set("page", "wiki/" + page + ".md");
    result.set("claims", static_cast<std::uint64_t>(claims.size()));
    json::Value reply;
    reply.set("ok", true);
    reply.set("output", json::dump(result));
    return reply;
}


bool parse_iso(const std::string& text, std::int64_t& ms) {
    int y = 0, mo = 0, d = 0, h = 0, mi = 0, sec = 0;
    if (std::sscanf(text.c_str(), "%d-%d-%dT%d:%d:%d", &y, &mo, &d, &h, &mi, &sec) != 6) return false;
    const std::size_t dot = text.find('.');
    const std::int64_t millis = dot == std::string::npos ? 0 : std::atoi(text.substr(dot + 1, 3).c_str());
    const int yy = mo <= 2 ? y - 1 : y;
    const std::int64_t era = (yy >= 0 ? yy : yy - 399) / 400;
    const std::int64_t yoe = yy - era * 400;
    const std::int64_t doy = (153 * (mo + (mo > 2 ? -3 : 9)) + 2) / 5 + d - 1;
    const std::int64_t doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    const std::int64_t days = era * 146097 + doe - 719468;
    ms = ((days * 86400 + h * 3600 + mi * 60 + sec) * 1000) + millis;
    return true;
}

struct Page {
    std::string name;
    std::string title;
    std::string updated;
    std::vector<std::string> sources;
    std::vector<std::pair<std::string, std::string>> claims;
    std::vector<std::string> contradicts;
    std::vector<std::string> resolves;
    std::string body;
};

std::vector<std::string> string_array_of(const json::Value* value) {
    std::vector<std::string> out;
    if (value == nullptr || !value->is_array()) return out;
    for (const auto& item : value->as_array())
        if (item.is_string()) out.push_back(item.as_string());
    return out;
}

bool parse_page(const std::string& name, const std::string& text, Page& page) {
    static const std::regex frame(R"(^---\n([\s\S]*?)\n---\n([\s\S]*)$)");
    std::smatch match;
    if (!std::regex_match(text, match, frame)) return false;
    std::map<std::string, json::Value> fields;
    std::istringstream lines(match[1].str());
    for (std::string line; std::getline(lines, line);) {
        const auto at = line.find(": ");
        if (at == std::string::npos || at == 0) continue;
        auto value = json::parse(line.substr(at + 2));
        if (!value) return false;
        fields[line.substr(0, at)] = *value;
    }
    page.name = name;
    if (fields.count("title")) page.title = fields["title"].is_string() ? fields["title"].as_string() : "";
    if (fields.count("updated")) page.updated = fields["updated"].is_string() ? fields["updated"].as_string() : "";
    page.sources = string_array_of(fields.count("sources") ? &fields["sources"] : nullptr);
    page.contradicts = string_array_of(fields.count("contradicts") ? &fields["contradicts"] : nullptr);
    page.resolves = string_array_of(fields.count("resolves") ? &fields["resolves"] : nullptr);
    if (fields.count("claims") && fields["claims"].is_array()) {
        for (const auto& claim : fields["claims"].as_array()) {
            const json::Value* quote = claim.find("quote");
            const json::Value* source = claim.find("source");
            page.claims.emplace_back(quote && quote->is_string() ? quote->as_string() : "", source && source->is_string() ? source->as_string() : "");
        }
    }
    page.body = match[2].str();
    return true;
}

std::vector<std::string> links_in(const std::string& text) {
    static const std::regex link(R"(\[\[([^\]]+)\]\])");
    std::vector<std::string> out;
    for (auto it = std::sregex_iterator(text.begin(), text.end(), link), end = std::sregex_iterator(); it != end; ++it) out.push_back((*it)[1].str());
    return out;
}

json::Value wiki_lint(const fs::path& root) {
    const fs::path dir = root / "wiki";
    json::Value reply;
    reply.set("ok", true);
    if (!exists_file(dir)) {
        json::Value lint{json::Object{}};
        lint.set("problems", json::Array{});
        lint.set("pages", static_cast<std::uint64_t>(0));
        lint.set("skipped", true);
        reply.set("output", json::dump(lint));
        reply.set("problems", json::Array{});
        reply.set("pages", static_cast<std::uint64_t>(0));
        reply.set("skipped", true);
        return reply;
    }
    std::vector<std::string> problems;
    bool ok = false;
    const fs::path index_path = dir / "index.md";
    const fs::path log_path = dir / "log.md";
    const bool has_index = exists_file(index_path);
    const bool has_log = exists_file(log_path);
    if (!has_index) problems.push_back("wiki/index.md is missing");
    if (!has_log) problems.push_back("wiki/log.md is missing");
    const std::string index_text = has_index ? read_whole(index_path, ok) : std::string();
    const std::string log_text = has_log ? read_whole(log_path, ok) : std::string();

    std::set<std::string> indexed;
    {
        static const std::regex entry(R"(^- \[\[([a-z0-9][a-z0-9-]{0,63})\]\] - (.+)$)");
        std::istringstream rows(index_text);
        for (std::string row; std::getline(rows, row);) {
            std::smatch match;
            if (std::regex_match(row, match, entry)) indexed.insert(match[1].str());
        }
    }
    std::vector<std::string> files;
    std::error_code ec;
    for (const auto& item : fs::directory_iterator(dir, ec)) {
        if (!item.is_regular_file(ec)) continue;
        const std::string file = item.path().filename().string();
        if (file.size() > 3 && file.substr(file.size() - 3) == ".md" && file != "index.md" && file != "log.md") files.push_back(file);
    }
    std::sort(files.begin(), files.end());
    std::vector<Page> pages;
    for (const auto& file : files) {
        Page page;
        bool read_ok = false;
        const std::string text = read_whole(dir / file, read_ok);
        if (!parse_page(file.substr(0, file.size() - 3), text, page)) problems.push_back("wiki/" + file + " has no frontmatter");
        else pages.push_back(std::move(page));
    }
    auto find_page = [&](const std::string& name) -> const Page* {
        for (const auto& page : pages)
            if (page.name == name) return &page;
        return nullptr;
    };
    for (const auto& page : pages)
        if (!indexed.count(page.name)) problems.push_back("page " + page.name + " has no entry in wiki/index.md");
    for (const auto& name : indexed)
        if (!find_page(name)) problems.push_back("wiki/index.md lists " + name + ", which has no page");
    for (const auto& target : links_in(index_text))
        if (!find_page(target)) problems.push_back("wiki/index.md links to " + target + ", which has no page");

    std::set<std::string> linked_from;
    for (const auto& page : pages) {
        for (const auto& target : links_in(page.body)) {
            if (!find_page(target)) problems.push_back("page " + page.name + " links to " + target + ", which has no page");
            else if (target != page.name) linked_from.insert(target);
        }
    }
    for (const auto& page : pages)
        if (!linked_from.count(page.name)) problems.push_back("page " + page.name + " is an orphan: no other page links to it");

    std::set<std::string> log_titles;
    {
        static const std::regex entry(R"(^## \[\d{4}-\d{2}-\d{2}\] (?:ingest|answer|lint) \| (.+)$)");
        std::istringstream rows(log_text);
        for (std::string row; std::getline(rows, row);) {
            std::smatch match;
            if (std::regex_match(row, match, entry)) log_titles.insert(match[1].str());
        }
    }
    for (const auto& page : pages) {
        if (!log_titles.count(page.title)) problems.push_back("page " + page.name + " has no line in wiki/log.md");
        for (const auto& id : page.sources)
            if (!source_text(root, id)) problems.push_back("page " + page.name + " cites source " + id + ", which is not in sources/");
        for (const auto& [quote, source] : page.claims) {
            if (std::find(page.sources.begin(), page.sources.end(), source) == page.sources.end()) problems.push_back("page " + page.name + " has a claim from " + source + ", which it does not list");
            const auto text = source_text(root, source);
            if (text && text->find(quote) == std::string::npos) problems.push_back("page " + page.name + ": a quote is no longer in source " + source);
        }
    }

    std::vector<json::Value> registry;
    {
        const fs::path file = root / "sources" / "index.jsonl";
        if (exists_file(file)) {
            bool read_ok = false;
            const std::string text = read_whole(file, read_ok);
            std::istringstream rows(text);
            bool bad = false;
            for (std::string row; std::getline(rows, row);) {
                if (row.empty()) continue;
                auto entry = json::parse(row);
                if (!entry) {
                    bad = true;
                    break;
                }
                registry.push_back(*entry);
            }
            if (bad) {
                problems.push_back("sources/index.jsonl is not JSON lines");
                registry.clear();
            }
        }
    }
    auto field_of = [](const json::Value& entry, const char* key) { const json::Value* v = entry.find(key); return v != nullptr && v->is_string() ? v->as_string() : std::string(); };
    for (const auto& page : pages) {
        std::int64_t page_ms = 0;
        const bool page_time = parse_iso(page.updated, page_ms);
        for (const auto& id : page.sources) {
            std::string url;
            for (const auto& entry : registry)
                if (field_of(entry, "id") == id) {
                    url = field_of(entry, "url");
                    break;
                }
            if (url.empty()) continue;
            const json::Value* latest = nullptr;
            for (const auto& entry : registry)
                if (field_of(entry, "url") == url) latest = &entry;
            if (latest == nullptr || field_of(*latest, "id") == id) continue;
            std::int64_t at_ms = 0;
            if (parse_iso(field_of(*latest, "at"), at_ms) && page_time && at_ms > page_ms)
                problems.push_back("page " + page.name + " cites source " + id + ", but " + url + " was archived again as " + field_of(*latest, "id") + " at " + field_of(*latest, "at"));
        }
    }

    for (const auto& page : pages) {
        std::int64_t page_ms = 0;
        const bool page_time = parse_iso(page.updated, page_ms);
        for (const auto& other : page.contradicts) {
            if (!find_page(other)) {
                problems.push_back("page " + page.name + " contradicts " + other + ", which has no page");
                continue;
            }
            bool resolved = false;
            for (const auto& later : pages) {
                if (later.name == page.name) continue;
                const bool names = std::find(later.resolves.begin(), later.resolves.end(), page.name) != later.resolves.end() || std::find(later.resolves.begin(), later.resolves.end(), other) != later.resolves.end();
                std::int64_t later_ms = 0;
                if (names && parse_iso(later.updated, later_ms) && page_time && later_ms > page_ms) resolved = true;
            }
            if (!resolved) problems.push_back("open contradiction: " + page.name + " contradicts " + other);
        }
        for (const auto& other : page.resolves)
            if (!find_page(other)) problems.push_back("page " + page.name + " resolves " + other + ", which has no page");
    }

    std::uint64_t claims = 0;
    for (const auto& page : pages) claims += page.claims.size();
    json::Array listed;
    for (const auto& problem : problems) listed.push_back(json::Value(problem));
    json::Value lint{json::Object{}};
    lint.set("problems", json::Value(listed));
    lint.set("pages", static_cast<std::uint64_t>(pages.size()));
    lint.set("claims", claims);
    lint.set("skipped", false);
    reply.set("output", json::dump(lint));
    reply.set("problems", json::Value(listed));
    reply.set("pages", static_cast<std::uint64_t>(pages.size()));
    reply.set("claims", claims);
    reply.set("skipped", false);
    return reply;
}

}

bool is_wiki_verb(std::string_view name) { return name == "wiki_search" || name == "wiki_write" || name == "wiki_lint"; }

json::Value wiki_call(std::string_view name, const json::Value& args, const fs::path& workspace, LockedLog& log) {
    if (name == "wiki_search") return wiki_search(args, workspace);
    if (name == "wiki_write") return wiki_write(args, workspace, log);
    if (name == "wiki_lint") return wiki_lint(workspace);
    return failure("unknown wiki verb: " + std::string(name));
}

}
