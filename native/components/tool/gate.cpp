#include "gm/tool.hpp"

#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <map>
#include <regex>
#include <set>
#include <sstream>
#include <system_error>

namespace gm::tool {
namespace fs = std::filesystem;
namespace {

constexpr std::uintmax_t kAgentsMaxBytes = 30 * 1024;
const std::vector<std::string> kDocs{"DESIGN.md", "AGENTS.md", "README.md"};
const std::vector<std::string> kScriptExtensions{".sh", ".mjs", ".js", ".cjs", ".py", ".ps1", ".ts", ".bat", ".cmd"};

bool has_suffix(const std::string& text, const std::string& suffix) {
    return text.size() >= suffix.size() && text.compare(text.size() - suffix.size(), suffix.size(), suffix) == 0;
}

std::string read_file(const fs::path& path) {
    std::ifstream in(path, std::ios::binary);
    std::ostringstream text;
    text << in.rdbuf();
    return text.str();
}

bool vendored(const std::string& rel) { return rel.find("third_party/") != std::string::npos || rel.find("vendor/") != std::string::npos; }

bool text_file(const std::string& bytes) { return bytes.substr(0, 8000).find('\0') == std::string::npos; }

bool added_comment(const std::string& line) {
    bool quote = false;
    char delimiter = 0;
    for (std::size_t i = 0; i < line.size(); ++i) {
        const char c = line[i];
        if (quote) {
            if (c == '\\') {
                ++i;
            } else if (c == delimiter) {
                quote = false;
            }
            continue;
        }
        if (c == '"' || c == '\'' || c == '`') {
            quote = true;
            delimiter = c;
            continue;
        }
        if (c == '/' && i + 1 < line.size() && (line[i + 1] == '/' || line[i + 1] == '*')) return true;
    }
    return false;
}

GateCheck ascii_check(const fs::path& root, const std::vector<std::string>& files) {
    std::vector<std::string> bad;
    std::size_t count = 0;
    for (const auto& rel : files) {
        if (vendored(rel)) continue;
        std::error_code ec;
        if (!fs::is_regular_file(root / rel, ec)) continue;
        const std::string bytes = read_file(root / rel);
        if (!text_file(bytes)) continue;
        ++count;
        for (unsigned char c : bytes) {
            if (c >= 0x80) {
                bad.push_back(rel);
                break;
            }
        }
    }
    std::string detail = "non-ASCII in ";
    for (const auto& name : bad) detail += name + ", ";
    if (bad.empty()) return {"ascii", true, std::to_string(count) + " text files are ASCII"};
    return {"ascii", false, detail.substr(0, detail.size() - 2)};
}

GateCheck docs_check(const fs::path& root, const std::vector<std::string>& files) {
    const std::set<std::string> indexed(files.begin(), files.end());
    std::set<std::string> tops;
    for (const auto& file : files) tops.insert(file.substr(0, file.find('/')));
    const std::regex ticked("`([^`\\s]+)`");
    std::vector<std::string> missing;
    std::size_t checked = 0;
    for (const auto& doc : kDocs) {
        std::error_code ec;
        if (!fs::is_regular_file(root / doc, ec)) {
            missing.push_back(doc + " itself");
            continue;
        }
        const std::string text = read_file(root / doc);
        for (std::sregex_iterator it(text.begin(), text.end(), ticked), end; it != end; ++it) {
            std::string token = (*it)[1].str();
            const auto colon = token.find(':');
            if (colon != std::string::npos && token.find_first_not_of("0123456789:", colon) == std::string::npos) token.resize(colon);
            if (token.find_first_of("<*=") != std::string::npos || token.find("://") != std::string::npos || token.starts_with('/')) continue;
            if (token.starts_with("runs") || token.starts_with("node_modules") || token.starts_with(".gm") || token.starts_with(".agentplug-kv")) continue;
            if (token.find('/') == std::string::npos || !tops.contains(token.substr(0, token.find('/')))) continue;
            ++checked;
            bool exists = false;
            if (token.ends_with('/')) {
                for (const auto& file : files)
                    if (file.starts_with(token)) exists = true;
            } else {
                exists = indexed.contains(token);
            }
            if (!exists) missing.push_back(doc + ": " + token);
        }
    }
    if (missing.empty()) return {"docs", true, std::to_string(checked) + " paths in the docs exist"};
    std::string detail = "missing: ";
    for (const auto& name : missing) detail += name + " | ";
    return {"docs", false, detail.substr(0, detail.size() - 3)};
}

GateCheck agents_size_check(const fs::path& root) {
    const auto bytes = fs::file_size(root / "AGENTS.md");
    if (bytes > kAgentsMaxBytes)
        return {"agents-size", false, "AGENTS.md is " + std::to_string(bytes) + " bytes; the limit is " + std::to_string(kAgentsMaxBytes)};
    return {"agents-size", true, "AGENTS.md is " + std::to_string(bytes) + " bytes, within " + std::to_string(kAgentsMaxBytes)};
}

GateCheck added_lines_check(const fs::path& root, const std::vector<std::string>& staged, const std::vector<std::string>& added) {
    std::vector<std::string> hits;
    std::vector<std::string> scripts;
    for (const auto& file : added) {
        if (!vendored(file)) {
            for (const auto& ext : kScriptExtensions)
                if (has_suffix(file, ext)) scripts.push_back(file);
        }
    }
    for (const auto& file : staged) {
        if (vendored(file)) continue;
        const auto diff = git_output(root, {"diff", "--cached", "-U0", "--", file});
        if (!diff) continue;
        std::istringstream lines(*diff);
        std::string line;
        std::size_t number = 0;
        while (std::getline(lines, line)) {
            if (line.starts_with("@@")) {
                const auto plus = line.find('+');
                number = plus == std::string::npos ? 0 : std::strtoul(line.c_str() + plus + 1, nullptr, 10);
                continue;
            }
            if (!line.starts_with('+') || line.starts_with("+++")) continue;
            if (added_comment(line.substr(1))) hits.push_back(file + ":" + std::to_string(number));
            ++number;
        }
    }
    std::string detail;
    if (!scripts.empty()) {
        detail += "new script files (write the witness or tool in C++ instead): ";
        for (const auto& name : scripts) detail += name + ", ";
    }
    if (!hits.empty()) {
        detail += "comments added in staged files: ";
        for (const auto& hit : hits) detail += hit + ", ";
    }
    if (!detail.empty()) return {"added-lines", false, detail.substr(0, detail.size() - 2)};
    return {"added-lines", true, std::to_string(staged.size()) + " staged files add no comment and no script"};
}

}

std::optional<std::string> git_output(const fs::path& root, const std::vector<std::string>& args) {
    std::vector<std::string> argv{"git", "-C", root.string()};
    argv.insert(argv.end(), args.begin(), args.end());
    const auto outcome = proc::run(argv, root, {}, 120000);
    if (!outcome.started || outcome.exit_code != 0) return std::nullopt;
    return outcome.out;
}

std::vector<std::string> nul_split(const std::string& text) {
    std::vector<std::string> parts;
    std::string current;
    for (char c : text) {
        if (c == '\0') {
            if (!current.empty()) parts.push_back(current);
            current.clear();
        } else {
            current.push_back(c);
        }
    }
    if (!current.empty()) parts.push_back(current);
    return parts;
}

std::vector<GateCheck> run_gate(const fs::path& root) {
    const auto tracked = nul_split(git_output(root, {"ls-files", "-z"}).value_or(""));
    const auto staged = nul_split(git_output(root, {"diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"}).value_or(""));
    const auto added = nul_split(git_output(root, {"diff", "--cached", "--name-only", "--diff-filter=A", "-z"}).value_or(""));
    return {ascii_check(root, tracked), docs_check(root, tracked), agents_size_check(root), added_lines_check(root, staged, added)};
}

int gate_command(const fs::path& root) {
    const auto checks = run_gate(root);
    bool all = true;
    std::string failed = "[";
    for (const auto& check : checks) {
        std::printf("gate: %s %s: %s\n", check.name.c_str(), check.ok ? "ok" : "FAILED", check.detail.c_str());
        if (!check.ok) {
            all = false;
            failed += "\"" + check.name + "\",";
        }
    }
    if (failed.size() > 1) failed.pop_back();
    failed += "]";
    std::printf("{\"gate\":%s,\"failed\":%s}\n", all ? "true" : "false", failed.c_str());
    return all ? 0 : 1;
}

}
