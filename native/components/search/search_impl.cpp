#include "search_impl.hpp"

#include <sys/stat.h>

#include <algorithm>
#include <cctype>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <memory>
#include <fstream>
#include <iterator>
#include <regex>
#include <set>
#include <sstream>

#include "gmnew/proc.hpp"

namespace gmnew::search {

namespace fs = std::filesystem;

namespace {

constexpr double K1 = 1.2;
constexpr double B = 0.75;
constexpr std::uintmax_t MAX_FILE_BYTES = 1000000;
constexpr std::uint64_t LIST_TIMEOUT_MS = 30000;
constexpr std::size_t SNIPPET_CHARS = 300;
constexpr std::size_t OUTPUT_PAGE = 20000;
constexpr int DEFAULT_K = 10;
constexpr int MAX_K = 50;
constexpr int DEFAULT_LIMIT = 100;
constexpr int MAX_LIMIT = 1000;
constexpr std::size_t MAX_PATTERN_CHARS = 200;
constexpr long long STAMP_SETTLE_MS = 3000;
constexpr std::size_t BINARY_PROBE_BYTES = 8000;

const std::set<std::string> STATE_DIRS = {".git", ".gm", ".agentplug", ".agentplug-kv", ".gm-new", ".playwriter", "runs"};

Listing walk_listing(const fs::path& base) {
    Listing walked;
    walked.ok = true;
    std::vector<std::string> pending = {""};
    while (!pending.empty()) {
        std::string dir = pending.back();
        pending.pop_back();
        std::error_code walk_ec;
        for (const fs::directory_entry& entry : fs::directory_iterator(base / dir, walk_ec)) {
            std::string name = entry.path().filename().string();
            std::string rel = dir.empty() ? name : dir + "/" + name;
            std::error_code type_ec;
            if (entry.is_symlink(type_ec)) continue;
            if (entry.is_directory(type_ec)) {
                bool skip = STATE_DIRS.count(name) || (!name.empty() && name[0] == '.') || name == "runs" || name == "node_modules" || name == "vendor";
                if (!skip) pending.push_back(rel);
            } else if (entry.is_regular_file(type_ec)) {
                walked.paths.push_back(rel);
            }
        }
    }
    std::sort(walked.paths.begin(), walked.paths.end());
    return walked;
}

std::string fail(const std::string& error) {
    json::Value out;
    out.set("ok", false);
    out.set("error", error);
    out.set("output", error);
    return json::dump(out);
}

bool is_whole(const json::Value& v) {
    return v.is_number() && std::floor(v.as_number()) == v.as_number();
}

bool is_word_char(unsigned char c) {
    return std::isalnum(c) || c == '_';
}

std::size_t char_count(const std::string& s) {
    std::size_t count = 0;
    for (unsigned char c : s) count += (c & 0xC0) != 0x80;
    return count;
}

bool has_regex_char(const std::string& s) {
    return s.find_first_of(".|()[]{}*+?^$\\") != std::string::npos;
}

std::string lower_ascii(std::string s) {
    for (char& c : s) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    return s;
}

std::string snippet(const std::string& text) {
    if (text.size() <= SNIPPET_CHARS) return text;
    std::size_t cut = SNIPPET_CHARS;
    while (cut > 0 && (static_cast<unsigned char>(text[cut]) & 0xC0) == 0x80) --cut;
    return text.substr(0, cut) + " ...";
}

std::string plural(std::size_t count, const std::string& one, const std::string& many) {
    return std::to_string(count) + " " + (count == 1 ? one : many);
}

bool in_vendor(const std::string& rel) {
    std::size_t start = 0;
    while (start < rel.size()) {
        std::size_t slash = rel.find('/', start);
        if (slash == std::string::npos) return false;
        std::string part = rel.substr(start, slash - start);
        if (part == "node_modules" || part == "vendor") return true;
        start = slash + 1;
    }
    return false;
}

bool in_state(const std::string& rel) {
    std::size_t start = 0;
    while (true) {
        std::size_t slash = rel.find('/', start);
        if (slash == std::string::npos) return false;
        if (STATE_DIRS.count(rel.substr(start, slash - start))) return true;
        start = slash + 1;
    }
}

std::vector<std::string> under(const std::vector<std::string>& paths, const std::string& prefix, bool vendor) {
    std::vector<std::string> out;
    for (const std::string& rel : paths) {
        bool inside = prefix.empty() || rel == prefix || rel.compare(0, prefix.size() + 1, prefix + "/") == 0;
        if (inside && (vendor || !in_vendor(rel))) out.push_back(rel);
    }
    return out;
}

std::string generic(const fs::path& p) {
    return p.generic_string();
}

std::string stamp_of(const struct stat& info, long long& newest_ms) {
#if defined(__APPLE__)
    long long mtime_ns = static_cast<long long>(info.st_mtimespec.tv_sec) * 1000000000LL + info.st_mtimespec.tv_nsec;
    long long ctime_ns = static_cast<long long>(info.st_ctimespec.tv_sec) * 1000000000LL + info.st_ctimespec.tv_nsec;
#elif defined(_WIN32)
    long long mtime_ns = static_cast<long long>(info.st_mtime) * 1000000000LL;
    long long ctime_ns = static_cast<long long>(info.st_ctime) * 1000000000LL;
#else
    long long mtime_ns = static_cast<long long>(info.st_mtim.tv_sec) * 1000000000LL + info.st_mtim.tv_nsec;
    long long ctime_ns = static_cast<long long>(info.st_ctim.tv_sec) * 1000000000LL + info.st_ctim.tv_nsec;
#endif
    newest_ms = std::max(mtime_ns, ctime_ns) / 1000000;
    return std::to_string(info.st_dev) + ":" + std::to_string(info.st_ino) + ":" + std::to_string(info.st_size) + ":" +
           std::to_string(mtime_ns) + ":" + std::to_string(ctime_ns);
}

long long now_ms() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count();
}

bool stat_file(const fs::path& path, struct stat& info) {
    return ::stat(path.string().c_str(), &info) == 0;
}

bool read_text(const fs::path& path, std::string& out) {
    std::ifstream in(path, std::ios::binary);
    if (!in) return false;
    std::ostringstream buffer;
    buffer << in.rdbuf();
    out = buffer.str();
    return true;
}

bool looks_binary(const std::string& data) {
    return std::memchr(data.data(), 0, std::min(data.size(), BINARY_PROBE_BYTES)) != nullptr;
}

std::vector<std::string> split_lines(const std::string& data) {
    std::vector<std::string> lines;
    std::size_t start = 0;
    while (true) {
        std::size_t newline = data.find('\n', start);
        std::string line = data.substr(start, newline == std::string::npos ? std::string::npos : newline - start);
        if (!line.empty() && line.back() == '\r') line.pop_back();
        lines.push_back(std::move(line));
        if (newline == std::string::npos) break;
        start = newline + 1;
    }
    return lines;
}

std::vector<std::string> tokens_of(const std::string& text) {
    std::vector<std::string> out;
    std::size_t i = 0;
    while (i < text.size()) {
        if (!is_word_char(static_cast<unsigned char>(text[i]))) {
            ++i;
            continue;
        }
        std::size_t end = i;
        while (end < text.size() && is_word_char(static_cast<unsigned char>(text[end]))) ++end;
        std::string word = text.substr(i, end - i);
        out.push_back(lower_ascii(word));
        std::vector<std::string> parts;
        std::string current;
        for (std::size_t k = 0; k < word.size(); ++k) {
            unsigned char c = static_cast<unsigned char>(word[k]);
            bool camel = k > 0 && std::isupper(c) && (std::islower(static_cast<unsigned char>(word[k - 1])) || std::isdigit(static_cast<unsigned char>(word[k - 1])));
            if (c == '_' || camel) {
                if (!current.empty()) parts.push_back(lower_ascii(current));
                current.clear();
            }
            if (c != '_') current.push_back(static_cast<char>(c));
        }
        if (!current.empty()) parts.push_back(lower_ascii(current));
        if (parts.size() > 1) out.insert(out.end(), parts.begin(), parts.end());
        i = end;
    }
    return out;
}

class Matcher {
public:
    Matcher(const std::string& pattern, const std::string& mode, bool ignore_case)
        : mode_(mode), ignore_case_(ignore_case), needle_(ignore_case ? lower_ascii(pattern) : pattern) {
        if (mode == "regex") {
            auto flags = std::regex::ECMAScript | (ignore_case ? std::regex::icase : std::regex_constants::syntax_option_type{});
            regex_ = std::regex(pattern, flags);
        }
    }

    bool operator()(const std::string& text) const {
        if (mode_ == "regex") return std::regex_search(text, regex_);
        const std::string& hay = ignore_case_ ? lowered(text) : text;
        std::size_t at = hay.find(needle_);
        if (mode_ == "literal") return at != std::string::npos;
        while (at != std::string::npos) {
            bool left = at == 0 || !is_word_char(static_cast<unsigned char>(hay[at - 1]));
            std::size_t after = at + needle_.size();
            bool right = after >= hay.size() || !is_word_char(static_cast<unsigned char>(hay[after]));
            if (left && right) return true;
            at = hay.find(needle_, at + 1);
        }
        return false;
    }

private:
    const std::string& lowered(const std::string& text) const {
        scratch_ = lower_ascii(text);
        return scratch_;
    }

    std::string mode_;
    bool ignore_case_;
    std::string needle_;
    std::regex regex_;
    mutable std::string scratch_;
};

struct Scan {
    std::vector<std::string> found;
    std::size_t total = 0;
    long long next = -1;
};

}

Searcher::Searcher(fs::path workspace, fs::path root) : workspace_(workspace.lexically_normal()) {
    root_ = root.empty() ? workspace_ : (workspace_ / root).lexically_normal();
}

Listing Searcher::list(const std::vector<std::string>& args, bool cached) {
    std::string key;
    long long newest = 0;
    bool settled = false;
    struct stat info;
    if (cached && stat_file(root_ / ".git" / "index", info)) {
        key = stamp_of(info, newest);
        settled = newest < now_ms() - STAMP_SETTLE_MS;
        if (settled && key == listing_key_ && listing_.ok) return listing_;
    }
    std::vector<std::string> argv = {"git"};
    argv.insert(argv.end(), args.begin(), args.end());
    proc::Outcome outcome = proc::run(argv, root_, {}, LIST_TIMEOUT_MS);
    Listing listing;
    if (!outcome.started || outcome.timed_out || outcome.exit_code != 0) return listing;
    listing.ok = true;
    std::size_t start = 0;
    while (start < outcome.out.size()) {
        std::size_t nul = outcome.out.find('\0', start);
        if (nul == std::string::npos) nul = outcome.out.size();
        if (nul > start) listing.paths.push_back(outcome.out.substr(start, nul - start));
        start = nul + 1;
    }
    if (cached && settled) {
        listing_key_ = key;
        listing_ = listing;
    }
    return listing;
}

bool Searcher::load_tracked(std::string& error) {
    Listing listing = list({"ls-files", "-z"}, true);
    if (!listing.ok) {
        listing = walk_listing(root_);
        if (listing.paths.empty()) {
            error = "search and grep need a git repository: git ls-files failed";
            return false;
        }
    }
    std::map<std::string, FileEntry> next;
    std::string key;
    bool all_settled = true;
    tracked_.clear();
    for (const std::string& rel : listing.paths) {
        struct stat info;
        fs::path at = root_ / rel;
        if (!stat_file(at, info) || !S_ISREG(info.st_mode) || static_cast<std::uintmax_t>(info.st_size) > MAX_FILE_BYTES) continue;
        long long newest = 0;
        std::string stamp = stamp_of(info, newest);
        long long read_at = now_ms();
        auto known = files_.find(rel);
        if (known != files_.end() && known->second.stamp == stamp && known->second.settled) {
            next[rel] = std::move(known->second);
        } else {
            std::string data;
            if (!read_text(at, data)) continue;
            FileEntry entry;
            entry.stamp = stamp;
            entry.settled = newest < read_at - STAMP_SETTLE_MS;
            if (!looks_binary(data)) entry.lines = split_lines(data);
            next[rel] = std::move(entry);
        }
        all_settled = all_settled && next[rel].settled;
        key += rel + '\n' + next[rel].stamp + '\n';
        tracked_.push_back(rel);
    }
    files_ = std::move(next);
    if (!all_settled || key != index_key_) {
        build_index();
        index_key_ = all_settled ? key : std::string();
    }
    return true;
}

void Searcher::build_index() {
    index_ = Index{};
    double total_len = 0;
    for (const std::string& rel : tracked_) {
        const FileEntry& entry = files_[rel];
        for (std::size_t i = 0; i < entry.lines.size(); ++i) {
            std::vector<std::string> tokens = tokens_of(entry.lines[i]);
            if (tokens.empty()) continue;
            std::size_t id = index_.docs.size();
            index_.docs.push_back({&entry, &files_.find(rel)->first, i + 1, static_cast<int>(tokens.size())});
            total_len += static_cast<double>(tokens.size());
            std::map<std::string, int> tf;
            for (const std::string& token : tokens) ++tf[token];
            for (auto& [term, count] : tf) index_.postings[term].push_back({id, count});
        }
    }
    index_.average = index_.docs.empty() ? 1 : total_len / static_cast<double>(index_.docs.size());
}

std::string Searcher::search(const json::Value& args) {
    const json::Value* query = args.find("query");
    if (!query || !query->is_string() || query->as_string().find_first_not_of(" \t\r\n") == std::string::npos)
        return fail("query must be a non-empty string");
    int k = DEFAULT_K;
    if (const json::Value* given = args.find("k")) {
        if (!is_whole(*given) || given->as_number() < 1 || given->as_number() > MAX_K)
            return fail("k must be an integer from 1 to " + std::to_string(MAX_K));
        k = static_cast<int>(given->as_number());
    }
    std::vector<std::string> raw = tokens_of(query->as_string());
    std::vector<std::string> terms;
    for (const std::string& term : raw)
        if (std::find(terms.begin(), terms.end(), term) == terms.end()) terms.push_back(term);
    if (terms.empty()) return fail("query has no word characters");
    std::string error;
    if (!load_tracked(error)) return fail(error);

    std::map<std::size_t, double> scores;
    double n = static_cast<double>(index_.docs.size());
    for (const std::string& term : terms) {
        auto found = index_.postings.find(term);
        if (found == index_.postings.end()) continue;
        double df = static_cast<double>(found->second.size());
        double idf = std::log(1 + (n - df + 0.5) / (df + 0.5));
        for (const Posting& posting : found->second) {
            double len = index_.docs[posting.doc].len;
            double tf = posting.tf;
            double weight = (tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * len) / index_.average));
            scores[posting.doc] += idf * weight;
        }
    }
    std::vector<std::pair<std::size_t, double>> ranked(scores.begin(), scores.end());
    std::sort(ranked.begin(), ranked.end(), [](const auto& a, const auto& b) { return a.second != b.second ? a.second > b.second : a.first < b.first; });
    if (ranked.size() > static_cast<std::size_t>(k)) ranked.resize(static_cast<std::size_t>(k));

    std::string output;
    bool absolute = root_ != workspace_;
    for (const auto& [id, score] : ranked) {
        const Doc& doc = index_.docs[id];
        char formatted[32];
        std::snprintf(formatted, sizeof formatted, "%.3f", score);
        std::string shown = absolute ? generic(root_ / *doc.path) : *doc.path;
        if (!output.empty()) output += '\n';
        output += shown + ":" + std::to_string(doc.line) + " " + formatted + " " + snippet(doc.file->lines[doc.line - 1]);
    }
    json::Value out;
    out.set("ok", true);
    out.set("output", output.empty() ? "(no match)" : output);
    return json::dump(out);
}

std::string Searcher::grep(const json::Value& args) {
    const json::Value* pattern_arg = args.find("pattern");
    if (!pattern_arg || !pattern_arg->is_string() || pattern_arg->as_string().empty()) return fail("pattern must be a non-empty string");
    const std::string& pattern = pattern_arg->as_string();
    std::size_t pattern_chars = char_count(pattern);
    if (pattern_chars > MAX_PATTERN_CHARS)
        return fail("pattern must be at most " + std::to_string(MAX_PATTERN_CHARS) + " characters; got " + std::to_string(pattern_chars));
    std::string mode = "literal";
    if (const json::Value* given = args.find("mode")) {
        mode = given->is_string() ? given->as_string() : "";
        if (mode == "content") mode = "literal";
        if (mode != "literal" && mode != "regex" && mode != "word") return fail("mode must be one of literal, regex, word");
    }
    bool all = false;
    if (const json::Value* given = args.find("scope")) {
        std::string scope = given->is_string() ? given->as_string() : "";
        if (scope != "tracked" && scope != "all") return fail("scope must be one of tracked, all");
        all = scope == "all";
    }
    int limit = DEFAULT_LIMIT;
    if (const json::Value* given = args.find("limit")) {
        if (!is_whole(*given) || given->as_number() < 1 || given->as_number() > MAX_LIMIT)
            return fail("limit must be an integer from 1 to " + std::to_string(MAX_LIMIT));
        limit = static_cast<int>(given->as_number());
    }
    bool vendor = false;
    if (const json::Value* given = args.find("vendor")) {
        if (!given->is_bool()) return fail("vendor must be true or false");
        vendor = given->as_bool();
    }
    const json::Value* path_arg = args.find("path");
    if (path_arg && (!path_arg->is_string() || path_arg->as_string().empty())) return fail("path must be a non-empty string");
    const json::Value* ignore = args.find("ignoreCase");
    bool ignore_case = ignore && ignore->is_bool() && ignore->as_bool();

    std::unique_ptr<Matcher> matches;
    try {
        matches = std::make_unique<Matcher>(pattern, mode, ignore_case);
    } catch (const std::regex_error& err) {
        return fail(std::string("bad pattern: ") + err.what());
    }

    fs::path scope = (root_ / (path_arg ? fs::path(path_arg->as_string()) : fs::path("."))).lexically_normal();
    std::error_code ec;
    if (!fs::exists(fs::symlink_status(scope, ec))) return fail("no such path: " + path_arg->as_string());
    std::string rel_scope = generic(scope.lexically_relative(root_));
    if (rel_scope == ".") rel_scope.clear();
    bool inside = rel_scope.compare(0, 2, "..") != 0 && !scope.lexically_relative(root_).empty();

    Listing tracked = inside ? list({"ls-files", "-z"}, true) : Listing{};
    bool use_git = tracked.ok;
    fs::path base = use_git ? root_ : scope;
    std::vector<std::string> names;
    std::size_t skipped_dirs = 0;
    Listing visible = use_git && !all ? list({"ls-files", "-z", "-c", "-o", "--exclude-standard"}, false) : Listing{};
    if (!use_git) {
        if (fs::is_regular_file(scope, ec)) {
            names.push_back("");
        } else {
            std::vector<std::string> pending = {""};
            while (!pending.empty()) {
                std::string dir = pending.back();
                pending.pop_back();
                std::error_code walk_ec;
                for (const fs::directory_entry& entry : fs::directory_iterator(base / dir, walk_ec)) {
                    std::string name = entry.path().filename().string();
                    std::string rel = dir.empty() ? name : dir + "/" + name;
                    std::error_code type_ec;
                    if (entry.is_symlink(type_ec)) continue;
                    if (entry.is_directory(type_ec)) {
                        if (STATE_DIRS.count(name)) continue;
                        bool skip = !all && ((!name.empty() && name[0] == '.') || name == "runs" || (!vendor && (name == "node_modules" || name == "vendor")));
                        if (skip) ++skipped_dirs;
                        else pending.push_back(rel);
                    } else if (entry.is_regular_file(type_ec)) {
                        names.push_back(rel);
                    }
                }
            }
            std::sort(names.begin(), names.end());
        }
    } else if (all) {
        Listing every = list({"ls-files", "-z", "-c", "-o"}, false);
        if (!every.ok) return fail("scope all: git ls-files failed or ran past its 30 s limit");
        std::set<std::string> known(tracked.paths.begin(), tracked.paths.end());
        for (const std::string& rel : under(every.paths, rel_scope, true))
            if (rel.back() != '/' && (known.count(rel) || !in_state(rel))) names.push_back(rel);
    } else {
        std::set<std::string> known(tracked.paths.begin(), tracked.paths.end());
        for (const std::string& rel : under(visible.ok ? visible.paths : tracked.paths, rel_scope, vendor))
            if (known.count(rel) || !in_state(rel)) names.push_back(rel);
    }

    if (fs::is_regular_file(scope, ec)) {
        std::string reason;
        std::set<std::string> tracked_set(tracked.paths.begin(), tracked.paths.end());
        struct stat info;
        std::string data;
        if (use_git && !all && !tracked_set.count(rel_scope)) reason = "is not tracked by git";
        else if (use_git && !vendor && in_vendor(rel_scope)) reason = "is in node_modules or vendor; pass vendor: true to search it";
        else if (use_git && std::find(names.begin(), names.end(), rel_scope) == names.end()) reason = "is gitignored; pass scope: all to search it";
        else if (!stat_file(scope, info) || static_cast<std::uintmax_t>(info.st_size) > MAX_FILE_BYTES)
            reason = "is larger than " + std::to_string(MAX_FILE_BYTES) + " bytes";
        else if (!read_text(scope, data) || looks_binary(data)) reason = "is not text";
        if (!reason.empty()) {
            std::string message = (inside && root_ == workspace_ ? rel_scope : generic(scope)) + " " + reason + "; grep does not search it";
            json::Value skipped;
            skipped.set("ok", false);
            skipped.set("files", use_git ? "git" : "walk");
            skipped.set("error", message);
            skipped.set("output", message);
            return json::dump(skipped);
        }
    }

    long long offset = 0;
    if (const json::Value* given = args.find("offset")) {
        if (!is_whole(*given) || given->as_number() < 0) return fail("offset must be a whole number, zero or more");
        offset = static_cast<long long>(given->as_number());
    }

    bool show_relative = inside && root_ == workspace_;
    auto scan = [&](const Matcher& matcher) {
        Scan result;
        std::size_t size = 0;
        for (const std::string& name : names) {
            fs::path at = name.empty() ? base : base / name;
            struct stat info;
            if (!stat_file(at, info) || !S_ISREG(info.st_mode) || static_cast<std::uintmax_t>(info.st_size) > MAX_FILE_BYTES) continue;
            std::string data;
            if (!read_text(at, data) || looks_binary(data)) continue;
            std::string shown = show_relative ? name : generic(at);
            std::vector<std::string> lines = split_lines(data);
            for (std::size_t i = 0; i < lines.size(); ++i) {
                if (!matcher(lines[i])) continue;
                ++result.total;
                if (static_cast<long long>(result.total) <= offset || result.next >= 0) continue;
                std::string row = shown + ":" + std::to_string(i + 1) + " " + snippet(lines[i]);
                if (result.found.size() >= static_cast<std::size_t>(limit) || size + row.size() > OUTPUT_PAGE) {
                    result.next = static_cast<long long>(result.total) - 1;
                    continue;
                }
                size += row.size() + 1;
                result.found.push_back(std::move(row));
            }
        }
        return result;
    };

    Scan scanned = scan(*matches);
    std::vector<std::string> hints;
    if (scanned.total == 0 && mode == "literal" && has_regex_char(pattern)) {
        std::unique_ptr<Matcher> as_regex;
        try {
            as_regex = std::make_unique<Matcher>(pattern, "regex", ignore_case);
        } catch (const std::regex_error& err) {
            return fail(std::string("no literal match, and the pattern is not a valid regex: ") + err.what());
        }
        scanned = scan(*as_regex);
        hints.push_back(scanned.total > 0 ? "no literal match; matched as regex" : "no match as literal or regex");
    }

    std::string footer = "(" + std::to_string(scanned.total) + " matches; showing " + std::to_string(scanned.found.empty() ? 0 : offset) +
                         " to " + std::to_string(offset + static_cast<long long>(scanned.found.size())) + "; " +
                         (scanned.next < 0 ? std::string("no more") : "next offset " + std::to_string(scanned.next)) + ")";

    if (!all && scanned.total == 0) {
        if (!use_git) {
            if (skipped_dirs > 0)
                hints.insert(hints.begin(), plural(skipped_dirs, "directory", "directories") +
                                                " skipped (dot-directories, node_modules, vendor or runs); use scope: 'all' to include them");
        } else {
            Listing every = list({"ls-files", "-z", "-c", "-o"}, false);
            if (!every.ok || !visible.ok) {
                hints.insert(hints.begin(), "skipped files not counted: git ls-files failed or ran past its limit");
            } else {
                std::set<std::string> known(tracked.paths.begin(), tracked.paths.end());
                std::set<std::string> searched(names.begin(), names.end());
                std::size_t in_vendor_count = 0;
                std::size_t ignored_count = 0;
                for (const std::string& rel : under(every.paths, rel_scope, true)) {
                    if (rel.back() == '/' || searched.count(rel) || (!known.count(rel) && in_state(rel))) continue;
                    if (!vendor && in_vendor(rel)) ++in_vendor_count;
                    else ++ignored_count;
                }
                std::size_t skipped = in_vendor_count + ignored_count;
                if (skipped > 0)
                    hints.insert(hints.begin(), plural(skipped, "file", "files") + " skipped (" + std::to_string(in_vendor_count) +
                                                " in node_modules or vendor, " + std::to_string(ignored_count) +
                                                " gitignored); use scope: 'all' to include them");
            }
        }
    }

    std::string output;
    std::string joined;
    for (const std::string& hint : hints) {
        output += "hint: " + hint + "\n";
        joined += (joined.empty() ? "" : " | ") + hint;
    }
    for (const std::string& row : scanned.found) output += row + "\n";
    output += footer;
    json::Value out;
    out.set("ok", true);
    out.set("files", use_git ? "git" : "walk");
    out.set("output", output);
    if (!hints.empty()) out.set("hint", joined);
    return json::dump(out);
}

}
