#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <initializer_list>
#include <iterator>
#include <map>
#include <memory>
#include <regex>
#include <set>
#include <string>
#include <string_view>
#include <vector>

#include <tree_sitter/api.h>

#include "core_internal.hpp"
#include "gm/proc.hpp"

extern "C" {
const TSLanguage* tree_sitter_javascript(void);
const TSLanguage* tree_sitter_typescript(void);
}

namespace gm::core {
namespace {

namespace fs = std::filesystem;

constexpr std::size_t kMaxFileBytes = 1000000;
constexpr std::uint64_t kListTimeoutMs = 30000;
constexpr std::size_t kOutputPage = 20000;
constexpr int kDefaultLimit = 100;
constexpr int kMaxLimit = 1000;
constexpr int kDefaultDepth = 2;
constexpr int kMaxDepth = 5;
const std::set<std::string> kKeywords{"await", "break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete", "do", "else", "enum", "export", "extends", "false", "finally", "for", "function", "if", "import", "in", "instanceof", "let", "new", "null", "return", "static", "super", "switch", "this", "throw", "true", "try", "typeof", "var", "void", "while", "with", "yield"};
const std::string kNote = "Exact for parsed JavaScript and TypeScript: a call is a call expression whose callee is the name, or a member call .name(). Not resolved: shadowing, aliases and dynamic calls. A file that does not parse cleanly is scanned by lines and marked approximate.";
const std::regex kLineDef(R"(\b(?:function|class)\s+([A-Za-z_$][\w$]*)|\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=)");
const std::regex kLineCall(R"((\.)?\b([A-Za-z_$][\w$]*)\s*\()");
const std::regex kLineSpec(R"(\bfrom\s+['"]([^'"\n]+)['"]|\bimport\s*\(\s*['"]([^'"\n]+)['"]\s*\)|\brequire\s*\(\s*['"]([^'"\n]+)['"]\s*\))");

struct Call {
    std::size_t line;
    bool member;
};

struct Entry {
    std::string rel;
    std::vector<std::string> lines;
    std::set<std::string> defs;
    std::map<std::string, std::vector<Call>> calls;
    std::vector<std::string> specs;
    std::vector<std::string> edges;
    bool approximate = false;
};

struct Site {
    std::string rel;
    std::size_t line;
    std::string kind;
    std::string text;
};

json::Value failure(const std::string& message) {
    json::Value reply;
    reply.set("ok", false);
    reply.set("error", message);
    return reply;
}

json::Value success(const std::string& output) {
    json::Value reply;
    reply.set("ok", true);
    reply.set("output", output.size() > kOutputPage ? output.substr(0, kOutputPage) : output);
    return reply;
}

bool is_source(const std::string& path) {
    for (const std::string_view suffix : {".js", ".mjs", ".cjs", ".ts"}) {
        if (path.size() >= suffix.size() && path.compare(path.size() - suffix.size(), suffix.size(), suffix) == 0) return true;
    }
    return false;
}

bool is_identifier(const std::string& name) {
    if (name.empty()) return false;
    const auto head = static_cast<unsigned char>(name[0]);
    if (!(std::isalpha(head) || head == '_' || head == '$')) return false;
    return std::all_of(name.begin(), name.end(), [](char c) {
        const auto u = static_cast<unsigned char>(c);
        return std::isalnum(u) || c == '_' || c == '$';
    });
}

std::string bad_name(const json::Value* value) {
    if (value == nullptr || !value->is_string() || !is_identifier(value->as_string())) return "name must be a JavaScript identifier";
    if (kKeywords.count(value->as_string()) > 0) return value->as_string() + " is a JavaScript keyword, so it has no callers to list";
    return "";
}

std::string normalize_posix(const std::string& path) {
    std::vector<std::string> parts;
    std::size_t start = 0;
    while (start <= path.size()) {
        const std::size_t slash = path.find('/', start);
        const std::string part = path.substr(start, slash == std::string::npos ? std::string::npos : slash - start);
        start = slash == std::string::npos ? path.size() + 1 : slash + 1;
        if (part.empty() || part == ".") continue;
        if (part == ".." && !parts.empty() && parts.back() != "..") parts.pop_back();
        else parts.push_back(part);
    }
    std::string joined;
    for (const auto& part : parts) joined += (joined.empty() ? "" : "/") + part;
    return joined.empty() ? "." : joined;
}

std::string dirname_of(const std::string& rel) {
    const std::size_t slash = rel.rfind('/');
    return slash == std::string::npos ? "." : rel.substr(0, slash);
}

std::string node_text(TSNode node, const std::string& text) {
    const std::uint32_t begin = ts_node_start_byte(node);
    return text.substr(begin, ts_node_end_byte(node) - begin);
}

bool is_null_node(TSNode node) { return ts_node_is_null(node); }

bool type_is(TSNode node, std::string_view type) { return !is_null_node(node) && std::string_view(ts_node_type(node)) == type; }

TSNode field_of(TSNode node, std::string_view name) { return ts_node_child_by_field_name(node, name.data(), static_cast<std::uint32_t>(name.size())); }

std::string string_literal_value(TSNode node, const std::string& text) {
    const std::string raw = node_text(node, text);
    if (raw.size() < 2) return "";
    return raw.substr(1, raw.size() - 2);
}

void define(Entry& entry, TSNode name, const std::string& text, std::initializer_list<std::string_view> types) {
    if (is_null_node(name)) return;
    const std::string_view type = ts_node_type(name);
    if (std::find(types.begin(), types.end(), type) != types.end()) entry.defs.insert(node_text(name, text));
}

void record_call(Entry& entry, const std::string& name, std::size_t line, bool member) {
    entry.calls[name].push_back(Call{line, member});
}

void collect(Entry& entry, TSNode node, const std::string& text) {
    const std::string_view type = ts_node_type(node);
    if (type == "function_declaration" || type == "generator_function_declaration" || type == "class_declaration" || type == "abstract_class_declaration") {
        define(entry, field_of(node, "name"), text, {"identifier", "type_identifier"});
    } else if (type == "variable_declarator") {
        define(entry, field_of(node, "name"), text, {"identifier"});
    } else if (type == "method_definition") {
        define(entry, field_of(node, "name"), text, {"property_identifier"});
    } else if (type == "pair") {
        const TSNode value = field_of(node, "value");
        if (type_is(value, "arrow_function") || type_is(value, "function_expression") || type_is(value, "function")) define(entry, field_of(node, "key"), text, {"property_identifier"});
    } else if (type == "import_statement" || type == "export_statement") {
        const TSNode source = field_of(node, "source");
        if (type_is(source, "string")) entry.specs.push_back(string_literal_value(source, text));
    } else if (type == "call_expression") {
        const TSNode callee = field_of(node, "function");
        const TSNode args = field_of(node, "arguments");
        const TSNode first = is_null_node(args) ? TSNode{} : ts_node_named_child(args, 0);
        const std::size_t line = ts_node_start_point(node).row + 1;
        if (type_is(callee, "identifier")) {
            const std::string name = node_text(callee, text);
            if (name == "require" && type_is(first, "string")) entry.specs.push_back(string_literal_value(first, text));
            record_call(entry, name, line, false);
        } else if (type_is(callee, "import")) {
            if (type_is(first, "string")) entry.specs.push_back(string_literal_value(first, text));
        } else if (type_is(callee, "member_expression")) {
            const TSNode property = field_of(callee, "property");
            if (type_is(property, "property_identifier")) record_call(entry, node_text(property, text), line, true);
        }
    }
}

void scan_lines(Entry& entry) {
    for (std::size_t index = 0; index < entry.lines.size(); ++index) {
        const std::string& line = entry.lines[index];
        const std::size_t first = line.find_first_not_of(" \t\r");
        if (first != std::string::npos && line.compare(first, 2, "//") == 0) continue;
        std::set<std::string> defined;
        for (auto it = std::sregex_iterator(line.begin(), line.end(), kLineDef); it != std::sregex_iterator(); ++it) {
            const std::smatch& match = *it;
            const std::string name = match[1].matched ? match[1].str() : match[2].str();
            defined.insert(name);
            entry.defs.insert(name);
        }
        for (auto it = std::sregex_iterator(line.begin(), line.end(), kLineCall); it != std::sregex_iterator(); ++it) {
            const std::smatch& match = *it;
            const std::string name = match[2].str();
            if (kKeywords.count(name) > 0 || defined.count(name) > 0) continue;
            record_call(entry, name, index + 1, match[1].matched);
        }
        for (auto it = std::sregex_iterator(line.begin(), line.end(), kLineSpec); it != std::sregex_iterator(); ++it) {
            const std::smatch& match = *it;
            entry.specs.push_back(match[1].matched ? match[1].str() : match[2].matched ? match[2].str() : match[3].str());
        }
    }
}

Entry analyse(const std::string& rel, const std::string& text) {
    Entry entry;
    entry.rel = rel;
    std::string line;
    for (const char c : text) {
        if (c == '\n') {
            entry.lines.push_back(line);
            line.clear();
        } else {
            line.push_back(c);
        }
    }
    entry.lines.push_back(line);

    std::unique_ptr<TSParser, decltype(&ts_parser_delete)> parser(ts_parser_new(), ts_parser_delete);
    const bool typed = rel.size() >= 3 && rel.compare(rel.size() - 3, 3, ".ts") == 0;
    ts_parser_set_language(parser.get(), typed ? tree_sitter_typescript() : tree_sitter_javascript());
    std::unique_ptr<TSTree, decltype(&ts_tree_delete)> tree(ts_parser_parse_string(parser.get(), nullptr, text.data(), static_cast<std::uint32_t>(text.size())), ts_tree_delete);
    const TSNode root = ts_tree_root_node(tree.get());
    if (ts_node_has_error(root)) {
        entry.approximate = true;
        scan_lines(entry);
        return entry;
    }
    std::vector<TSNode> stack{root};
    while (!stack.empty()) {
        const TSNode node = stack.back();
        stack.pop_back();
        collect(entry, node, text);
        const std::uint32_t count = ts_node_named_child_count(node);
        for (std::uint32_t i = 0; i < count; ++i) stack.push_back(ts_node_named_child(node, i));
    }
    return entry;
}

std::string resolve_spec(const std::string& from, const std::string& spec, const std::set<std::string>& present) {
    if (spec.empty() || spec[0] != '.') return "";
    const std::string base = normalize_posix(dirname_of(from) + "/" + spec);
    const std::vector<std::string> candidates{base, base + ".js", base + ".mjs", base + ".cjs", base + ".ts", base + "/index.js", base + "/index.mjs", base + "/index.ts"};
    for (const auto& candidate : candidates) {
        if (present.count(candidate) > 0) return candidate;
    }
    return "";
}

struct Index {
    std::vector<Entry> files;
};

std::string load_index(const fs::path& root, Index& index) {
    const auto outcome = proc::run({"git", "ls-files", "-co", "--exclude-standard", "-z"}, root, {}, kListTimeoutMs);
    if (!outcome.started || outcome.timed_out || outcome.exit_code != 0) return "callers and impact need a git repository: git ls-files failed";
    std::size_t start = 0;
    const std::string& listing = outcome.out;
    while (start <= listing.size()) {
        const std::size_t end = listing.find('\0', start);
        const std::string rel = listing.substr(start, end == std::string::npos ? std::string::npos : end - start);
        start = end == std::string::npos ? listing.size() + 1 : end + 1;
        if (rel.empty() || !is_source(rel) || rel.rfind("vendor/", 0) == 0) continue;
        const fs::path at = root / rel;
        std::error_code ec;
        if (!fs::is_regular_file(at, ec)) continue;
        const auto size = fs::file_size(at, ec);
        if (ec || size > kMaxFileBytes) continue;
        std::ifstream in(at, std::ios::binary);
        if (!in) continue;
        std::string text((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
        index.files.push_back(analyse(rel, text));
    }
    std::set<std::string> present;
    for (const auto& entry : index.files) present.insert(entry.rel);
    for (auto& entry : index.files) {
        for (const auto& spec : entry.specs) {
            const std::string to = resolve_spec(entry.rel, spec, present);
            if (!to.empty()) entry.edges.push_back(to);
        }
    }
    return "";
}

struct Scan {
    std::set<std::string> defs;
    std::set<std::string> call_files;
    std::vector<Site> sites;
};

Scan scan(const std::vector<Entry>& files, const std::string& name) {
    Scan result;
    for (const auto& entry : files) {
        if (entry.defs.count(name) > 0) result.defs.insert(entry.rel);
    }
    for (const auto& entry : files) {
        const auto found = entry.calls.find(name);
        if (found == entry.calls.end()) continue;
        result.call_files.insert(entry.rel);
        const bool linked = std::any_of(entry.edges.begin(), entry.edges.end(), [&](const std::string& to) { return result.defs.count(to) > 0; });
        for (const auto& call : found->second) {
            std::string kind = call.member ? "member" : linked ? "linked" : "direct";
            if (entry.approximate) kind += ", line scan";
            const std::string text = call.line - 1 < entry.lines.size() ? entry.lines[call.line - 1] : "";
            result.sites.push_back(Site{entry.rel, call.line, kind, text});
        }
    }
    std::sort(result.sites.begin(), result.sites.end(), [](const Site& a, const Site& b) { return a.rel != b.rel ? a.rel < b.rel : a.line < b.line; });
    return result;
}

std::string trim(const std::string& text) {
    const std::size_t first = text.find_first_not_of(" \t\r\n");
    if (first == std::string::npos) return "";
    const std::size_t last = text.find_last_not_of(" \t\r\n");
    return text.substr(first, last - first + 1);
}

std::string join(const std::set<std::string>& values) {
    std::string out;
    for (const auto& value : values) out += (out.empty() ? "" : ", ") + value;
    return out;
}

std::string join(const std::vector<std::string>& values) {
    std::string out;
    for (const auto& value : values) out += (out.empty() ? "" : ", ") + value;
    return out;
}

json::Value callers(const json::Value& args, const fs::path& root) {
    const json::Value* name = args.find("name");
    const std::string bad = bad_name(name);
    if (!bad.empty()) return failure(bad);
    double limit = kDefaultLimit;
    if (const json::Value* value = args.find("limit"); value != nullptr) {
        if (!value->is_number() || std::floor(value->as_number()) != value->as_number() || value->as_number() < 1 || value->as_number() > kMaxLimit) {
            return failure("limit must be an integer from 1 to " + std::to_string(kMaxLimit));
        }
        limit = value->as_number();
    }
    Index index;
    const std::string error = load_index(root, index);
    if (!error.empty()) return failure(error);
    const Scan found = scan(index.files, name->as_string());
    std::string output;
    const std::size_t shown = std::min(found.sites.size(), static_cast<std::size_t>(limit));
    for (std::size_t i = 0; i < shown; ++i) {
        const Site& site = found.sites[i];
        output += site.rel + ":" + std::to_string(site.line) + " [" + site.kind + "] " + trim(site.text) + "\n";
    }
    output += "(" + std::to_string(found.sites.size()) + " call sites in " + std::to_string(index.files.size()) + " files; " + kNote + ")";
    return success(output);
}

json::Value impact(const json::Value& args, const fs::path& root) {
    const json::Value* name = args.find("name");
    const std::string bad = bad_name(name);
    if (!bad.empty()) return failure(bad);
    double depth = kDefaultDepth;
    if (const json::Value* value = args.find("depth"); value != nullptr) {
        if (!value->is_number() || std::floor(value->as_number()) != value->as_number() || value->as_number() < 0 || value->as_number() > kMaxDepth) {
            return failure("depth must be an integer from 0 to " + std::to_string(kMaxDepth));
        }
        depth = value->as_number();
    }
    Index index;
    const std::string error = load_index(root, index);
    if (!error.empty()) return failure(error);
    const std::string target = name->as_string();
    const Scan found = scan(index.files, target);
    std::set<std::string> reached = found.defs;
    reached.insert(found.call_files.begin(), found.call_files.end());
    std::vector<std::vector<std::string>> importers;
    std::set<std::string> frontier = reached;
    for (int level = 1; level <= depth && !frontier.empty(); ++level) {
        std::vector<std::string> next;
        for (const auto& entry : index.files) {
            if (reached.count(entry.rel) > 0) continue;
            const bool imports = std::any_of(entry.edges.begin(), entry.edges.end(), [&](const std::string& to) { return frontier.count(to) > 0; });
            if (imports) next.push_back(entry.rel);
        }
        std::sort(next.begin(), next.end());
        for (const auto& rel : next) reached.insert(rel);
        importers.push_back(next);
        frontier = std::set<std::string>(next.begin(), next.end());
    }
    std::string output = "impact of " + target + ": " + std::to_string(found.defs.size()) + " defining file(s), " + std::to_string(found.call_files.size()) + " calling file(s)\n";
    output += "defines: " + (found.defs.empty() ? std::string("(none)") : join(found.defs)) + "\n";
    output += "calls: " + (found.call_files.empty() ? std::string("(none)") : join(found.call_files)) + "\n";
    for (std::size_t i = 0; i < importers.size(); ++i) {
        output += "importers at depth " + std::to_string(i + 1) + ": " + (importers[i].empty() ? std::string("(none)") : join(importers[i])) + "\n";
    }
    output += "(" + kNote + ")";
    return success(output);
}

}

bool is_code_ast_verb(std::string_view name) { return name == "callers" || name == "impact"; }

json::Value code_ast_call(std::string_view name, const json::Value& args, const std::filesystem::path& root) {
    if (name == "callers") return callers(args, root);
    return impact(args, root);
}

}
