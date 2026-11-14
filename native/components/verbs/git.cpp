#include <algorithm>
#include <cctype>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <functional>
#include <filesystem>
#include <optional>
#include <regex>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

#include "core_internal.hpp"
#include "gm/proc.hpp"

namespace gm::core {
namespace {

namespace fs = std::filesystem;

constexpr std::uint64_t kGitTimeoutMs = 120000;
constexpr std::uint64_t kGhTimeoutMs = 60000;
constexpr std::uint64_t kCheckTimeoutMs = 15000;
constexpr std::int64_t kMaxCount = 200;
constexpr int kRetries = 3;
constexpr double kBaseMs = 1000;
constexpr double kCapMs = 16000;
constexpr double kJitter = 0.2;
const std::string kScope = " cwd, when given, is the directory whose repository the verb acts on: absolute, or relative to the workspace root; a directory outside a git repository is refused. Omitted, the workspace is used.";

struct Exec {
    bool ok = false;
    std::optional<std::string> error;
    std::string output;
    int exit_code = -1;
};

std::string trimmed(const std::string& text) {
    const auto first = text.find_first_not_of(" \t\r\n");
    if (first == std::string::npos) return "";
    return text.substr(first, text.find_last_not_of(" \t\r\n") - first + 1);
}

json::Value fail(std::string error) {
    json::Value reply;
    reply.set("ok", false);
    reply.set("error", std::move(error));
    return reply;
}

json::Value succeed(std::string output) {
    json::Value reply;
    reply.set("ok", true);
    reply.set("output", std::move(output));
    return reply;
}

Exec exec_program(const std::string& program, std::vector<std::string> argv, const fs::path& cwd, std::uint64_t timeout_ms) {
    std::vector<std::string> full{program};
    if (program == "git") full.push_back("--literal-pathspecs");
    full.insert(full.end(), argv.begin(), argv.end());
    const auto outcome = proc::run(full, cwd, {}, timeout_ms);
    Exec reply;
    reply.output = outcome.out + outcome.err;
    reply.exit_code = outcome.exit_code;
    if (!outcome.started) {
        reply.error = "could not start " + program;
        return reply;
    }
    if (outcome.timed_out) {
        reply.error = program + " timed out after " + std::to_string(timeout_ms) + " ms";
        return reply;
    }
    reply.ok = outcome.exit_code == 0;
    return reply;
}

Exec git_in(const fs::path& dir, const std::vector<std::string>& argv, std::uint64_t timeout_ms = kGitTimeoutMs) { return exec_program("git", argv, dir, timeout_ms); }

bool is_repository(const fs::path& dir) { return git_in(dir, {"rev-parse", "--is-inside-work-tree"}, kCheckTimeoutMs).ok; }

json::Value verb_of(const std::string& sub, const Exec& result) {
    if (result.ok) {
        const std::string text = trimmed(result.output);
        return succeed(text.empty() ? "(no output)" : text);
    }
    json::Value reply;
    reply.set("ok", false);
    reply.set("error", result.error ? *result.error : "git " + sub + " exited " + std::to_string(result.exit_code));
    reply.set("output", trimmed(result.output));
    return reply;
}

json::Value git(const fs::path& dir, const std::vector<std::string>& argv, std::uint64_t timeout_ms = kGitTimeoutMs) { return verb_of(argv.front(), git_in(dir, argv, timeout_ms)); }

std::optional<std::string> transient_type(const std::string& raw) {
    static const std::regex url(R"([a-z][a-z0-9+.-]*:\/\/\S*)", std::regex::icase);
    static const std::regex host(R"(\b[a-z0-9-]+(?:\.[a-z0-9-]+)+\b)", std::regex::icase);
    static const std::vector<std::pair<std::regex, std::string>> patterns = {
        {std::regex("connection refused|econnrefused", std::regex::icase), "ECONNREFUSED"},
        {std::regex("failed to connect|error connecting to", std::regex::icase), "connect"},
        {std::regex("connection reset|econnreset|reset by peer|und_err_socket", std::regex::icase), "ECONNRESET"},
        {std::regex("timed out|timeout|etimedout|aborterror|aborted", std::regex::icase), "ETIMEDOUT"},
        {std::regex("hung up unexpectedly|remote end hung up|socket hang up", std::regex::icase), "hung-up"},
        {std::regex("temporary failure in name resolution", std::regex::icase), "EAI_AGAIN"},
    };
    static const std::regex http(R"((?:HTTP|returned error:?|status code)\s*(408|429|5\d\d)\b)", std::regex::icase);
    const std::string message = std::regex_replace(std::regex_replace(raw, url, " "), host, " ");
    for (const auto& [pattern, type] : patterns)
        if (std::regex_search(message, pattern)) return type;
    std::smatch match;
    if (std::regex_search(message, match, http)) return "HTTP-" + match[1].str();
    return std::nullopt;
}

std::optional<std::string> error_type_of(const json::Value& result) {
    const json::Value* ok = result.find("ok");
    if (ok != nullptr && ok->is_bool() && ok->as_bool()) return std::nullopt;
    const json::Value* error = result.find("error");
    const json::Value* output = result.find("output");
    const std::string text = (error != nullptr && error->is_string() ? error->as_string() : "") + "\n" + (output != nullptr && output->is_string() ? output->as_string() : "");
    return transient_type(text);
}

double backoff_ms(int attempt) {
    const double base = std::min(kBaseMs * static_cast<double>(1ull << (attempt - 1)), kCapMs);
    static std::uint64_t state = 0x9E3779B97F4A7C15ull;
    state = state * 6364136223846793005ull + 1442695040888963407ull;
    const double unit = static_cast<double>(state >> 11) / 9007199254740992.0;
    return std::round(base * (1 + kJitter * (2 * unit - 1)));
}

json::Value retrying(LockedLog& log, const std::string& tool, const std::function<json::Value()>& attempt) {
    for (int n = 1;; ++n) {
        json::Value result = attempt();
        const auto type = error_type_of(result);
        if (!type) {
            result.set("attempts", n);
            return result;
        }
        if (n > kRetries) {
            result.set("attempts", n);
            result.set("exhausted", true);
            return result;
        }
        const double delay = backoff_ms(n);
        json::Value fields{json::Object{}};
        fields.set("tool", tool);
        fields.set("attempt", n);
        fields.set("errorType", *type);
        fields.set("delayMs", delay);
        log.append("retry", std::move(fields));
        std::this_thread::sleep_for(std::chrono::milliseconds(static_cast<std::int64_t>(delay)));
    }
}

std::string resolve_path(const fs::path& base, const std::string& path) { return normalize_path(is_absolute(path) ? path : (base / path).string()); }

std::string relative_path(const std::string& base, const std::string& path) {
    auto split = [](const std::string& text) {
        std::vector<std::string> parts;
        std::string piece;
        for (char c : text) {
            if (c == '/') {
                if (!piece.empty()) parts.push_back(piece);
                piece.clear();
            } else {
                piece += c;
            }
        }
        if (!piece.empty()) parts.push_back(piece);
        return parts;
    };
    const auto from = split(normalize_path(base));
    const auto to = split(normalize_path(path));
    std::size_t i = 0;
    while (i < from.size() && i < to.size() && from[i] == to[i]) ++i;
    std::string out;
    for (std::size_t k = i; k < from.size(); ++k) out += (out.empty() ? "" : "/") + std::string("..");
    for (std::size_t k = i; k < to.size(); ++k) out += (out.empty() ? "" : "/") + to[k];
    return out;
}

std::optional<json::Value> repo_at(const json::Value& args, const fs::path& workspace, fs::path& dir) {
    const json::Value* cwd = args.find("cwd");
    if (cwd == nullptr || cwd->is_null()) {
        dir = workspace;
        return std::nullopt;
    }
    if (!cwd->is_string() || cwd->as_string().empty()) return fail("cwd must be a non-empty path");
    dir = resolve_path(workspace, cwd->as_string());
    std::error_code ec;
    if (!fs::is_directory(dir, ec)) return fail("no such directory: " + cwd->as_string());
    const auto inside = git_in(dir, {"rev-parse", "--show-toplevel"}, kCheckTimeoutMs);
    if (!inside.ok) return fail("cwd " + cwd->as_string() + " is not inside a git repository");
    return std::nullopt;
}

std::optional<json::Value> path_args(const fs::path& dir, const json::Value* list, const fs::path& workspace, std::vector<std::string>& out) {
    if (list == nullptr || !list->is_array() || list->as_array().empty()) return fail("paths must be a non-empty array of strings");
    for (const auto& item : list->as_array())
        if (!item.is_string()) return fail("paths must be a non-empty array of strings");
    for (const auto& item : list->as_array()) {
        const std::string absolute = resolve_path(dir, item.as_string());
        if (dir == workspace) {
            const std::string outside = relative_path(workspace.string(), absolute);
            if (outside == ".." || outside.rfind("../", 0) == 0) return fail("refused: path is outside the workspace: " + item.as_string());
        }
        const std::string rel = relative_path(dir.string(), absolute);
        if (rel.empty()) return fail("refused: \".\" names the whole workspace; name each path explicitly");
        out.push_back(rel);
    }
    return std::nullopt;
}

std::optional<json::Value> bad_ref(const json::Value* ref) {
    static const std::regex pattern(R"(^[A-Za-z0-9._/@-]{1,200}$)");
    if (ref == nullptr || !ref->is_string() || !std::regex_match(ref->as_string(), pattern) || ref->as_string().rfind("-", 0) == 0) return fail("ref must be a branch, tag or commit name");
    return std::nullopt;
}

std::string str_or(const json::Value& args, const char* key, const std::string& fallback) {
    const json::Value* v = args.find(key);
    return v != nullptr && v->is_string() ? v->as_string() : fallback;
}

json::Value git_state(const fs::path& dir) {
    const auto status = git_in(dir, {"status", "--porcelain=v1", "--branch"});
    if (!status.ok) return verb_of("status", status);
    auto shortstat = [&](std::vector<std::string> args) {
        std::vector<std::string> argv{"diff", "--shortstat"};
        argv.insert(argv.end(), args.begin(), args.end());
        const auto stat = git_in(dir, argv);
        return stat.ok && !trimmed(stat.output).empty() ? trimmed(stat.output) : std::string("none");
    };
    std::vector<std::string> lines;
    std::istringstream all(status.output);
    for (std::string line; std::getline(all, line);) {
        if (!line.empty() && line.back() == '\r') line.pop_back();
        if (!line.empty()) lines.push_back(line);
    }
    const std::string head = lines.empty() ? "" : lines.front();
    if (!lines.empty()) lines.erase(lines.begin());
    static const std::regex tracking(R"(^## (\S+?)(?:\.\.\.(\S+))?(?: \[([^\]]*)\])?$)");
    std::smatch match;
    const bool tracked_head = std::regex_match(head, match, tracking);
    const std::string counts_text = tracked_head && match[3].matched ? match[3].str() : "";
    auto count = [&](const std::string& word) {
        static const std::regex item(R"((?:ahead|behind) \d+)");
        for (auto it = std::sregex_iterator(counts_text.begin(), counts_text.end(), item), end = std::sregex_iterator(); it != end; ++it)
            if (it->str().rfind(word, 0) == 0) return std::stoi(it->str().substr(word.size() + 1));
        return 0;
    };
    std::vector<std::string> changed;
    std::size_t untracked = 0;
    for (const auto& line : lines) {
        if (line.rfind("??", 0) == 0) ++untracked;
        else changed.push_back(line);
    }
    std::size_t staged = 0;
    std::size_t unstaged = 0;
    for (const auto& line : changed) {
        if (line.size() > 0 && line[0] != ' ') ++staged;
        if (line.size() > 1 && line[1] != ' ') ++unstaged;
    }
    std::string branch = tracked_head ? match[1].str() : head.substr(std::min<std::size_t>(3, head.size()));
    if (tracked_head && match[2].matched) branch += " upstream " + match[2].str();
    const std::string output = "branch " + branch + " ahead " + std::to_string(count("ahead")) + " behind " + std::to_string(count("behind")) + "\n" +
                               "changed " + std::to_string(lines.size()) + " staged " + std::to_string(staged) + " unstaged " + std::to_string(unstaged) + " untracked " + std::to_string(untracked) + "\n" +
                               "diff unstaged: " + shortstat({}) + "\n" + "diff staged: " + shortstat({"--cached"});
    return succeed(output);
}

json::Value ci_status(const fs::path& dir, const json::Value& args, LockedLog& log) {
    static const std::regex sha_pattern("^[0-9a-f]{7,40}$");
    static const std::regex repo_pattern("^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$");
    static const std::regex origin_pattern(R"(^(?:[a-z][a-z0-9+.-]*:\/\/)?(?:[^@\/\s]+@)?([^\/:\s]+)(?::\d+)?[\/:]([^\/\s]+)\/([^\/\s]+?)(?:\.git)?\/?$)", std::regex::icase);
    const std::string sha = str_or(args, "sha", "");
    const bool has_sha = args.find("sha") != nullptr && args.find("sha")->is_string();
    if (has_sha && !std::regex_match(sha, sha_pattern)) return fail("sha must be 7 to 40 lowercase hex digits");
    const bool has_repo = args.find("repo") != nullptr && args.find("repo")->is_string();
    const std::string repo = str_or(args, "repo", "");
    if (has_repo && !std::regex_match(repo, repo_pattern)) return fail("repo must be owner/name");
    const std::string target = has_sha ? sha : "HEAD";
    const auto head = git_in(dir, {"rev-parse", "--verify", target + "^{commit}"}, kCheckTimeoutMs);
    if (!head.ok) return fail(is_repository(dir) ? "no commit " + target + " in this repository" : "cannot check commit " + target + ": " + dir.string() + " is not a git repository");
    std::string origin_name = repo;
    std::string origin_host;
    if (!has_repo) {
        const auto url = git_in(dir, {"remote", "get-url", "origin"}, kCheckTimeoutMs);
        std::smatch match;
        const std::string url_text = trimmed(url.output);
        if (!url.ok || !std::regex_match(url_text, match, origin_pattern)) return fail("origin has no owner/name path; pass repo as owner/name");
        origin_host = match[1].str();
        origin_name = match[2].str() + "/" + match[3].str();
    }
    if (!std::regex_match(origin_name, repo_pattern)) return fail("origin has no owner/name path; pass repo as owner/name");
    const std::string full = trimmed(head.output);
    const std::string endpoint = "repos/" + origin_name + "/actions/runs?head_sha=" + full + "&per_page=100";
    json::Value api = retrying(log, "ci_status", [&] {
        std::vector<std::string> argv = {"api"};
        if (!origin_host.empty()) argv.insert(argv.end(), {"--hostname", origin_host});
        argv.insert(argv.end(), {"--paginate", "--jq", "(.workflow_runs // []) | map({name, status, conclusion, html_url})", endpoint});
        const auto reply = exec_program("gh", argv, dir, kGhTimeoutMs);
        if (reply.ok) {
            json::Value out;
            out.set("ok", true);
            out.set("output", reply.output);
            return out;
        }
        json::Value out;
        out.set("ok", false);
        out.set("error", reply.error ? *reply.error : "gh api exited " + std::to_string(reply.exit_code));
        out.set("output", trimmed(reply.output));
        return out;
    });
    const json::Value* api_ok = api.find("ok");
    if (api_ok == nullptr || !api_ok->as_bool()) {
        json::Value reply = fail(api.find("error") ? api.find("error")->as_string() : "gh api failed");
        reply.set("output", trimmed(api.find("output") ? api.find("output")->as_string() : ""));
        reply.set("attempts", api.find("attempts") ? *api.find("attempts") : json::Value(0));
        return reply;
    }
    std::vector<std::string> lines_in;
    std::istringstream raw(api.find("output")->as_string());
    for (std::string line; std::getline(raw, line);) {
        const std::string t = trimmed(line);
        if (!t.empty()) lines_in.push_back(t);
    }
    if (lines_in.empty()) return fail("gh api did not return JSON");
    std::string listing = origin_name + " " + full;
    std::size_t runs = 0;
    for (const auto& line : lines_in) {
        auto page = json::parse(line);
        if (!page) return fail("gh api did not return JSON");
        std::vector<json::Value> items;
        if (page->is_array()) items = page->as_array();
        else if (const json::Value* wr = page->find("workflow_runs"); wr != nullptr && wr->is_array()) items = wr->as_array();
        for (const auto& run : items) {
            ++runs;
            auto field = [&](const char* key) {
                const json::Value* v = run.find(key);
                return v == nullptr || v->is_null() ? std::string("-") : (v->is_string() ? v->as_string() : json::dump(*v));
            };
            listing += "\n" + field("name") + " " + field("status") + " " + field("conclusion") + " " + field("html_url");
        }
    }
    if (runs == 0) listing += "\nno workflow runs";
    return succeed(listing);
}

json::Value run_verb(const std::string& name, const json::Value& args, const fs::path& dir, LockedLog& log) {
    auto list_arg = [&](const char* key) { return args.find(key); };
    if (name == "git_status") return git(dir, {"status", "--porcelain=v1", "--branch"});
    if (name == "git_state") return git_state(dir);
    if (name == "git_add" || name == "git_rm") {
        std::vector<std::string> paths;
        if (auto refused = path_args(dir, list_arg("paths"), dir, paths)) return *refused;
        std::vector<std::string> argv{name == "git_add" ? "add" : "rm", "--"};
        argv.insert(argv.end(), paths.begin(), paths.end());
        return git(dir, argv);
    }
    if (name == "git_commit") {
        const std::string message = str_or(args, "message", "");
        if (trimmed(message).empty()) return fail("message must be a non-empty string");
        std::vector<std::string> paths;
        if (auto refused = path_args(dir, list_arg("paths"), dir, paths)) return *refused;
        const json::Value* author = list_arg("author");
        std::vector<std::string> author_args;
        if (author != nullptr && !author->is_null()) {
            if (!author->is_string() || trimmed(author->as_string()).empty() || author->as_string().find_first_of("<>\r\n") != std::string::npos)
                return fail("author must be a name without <, > or line breaks; the configured git email is kept");
            const auto email = git_in(dir, {"config", "user.email"}, kCheckTimeoutMs);
            if (!email.ok || trimmed(email.output).empty()) return fail("author needs user.email set in this repository");
            author_args.push_back("--author=" + trimmed(author->as_string()) + " <" + trimmed(email.output) + ">");
        }
        std::vector<std::string> argv{"commit"};
        argv.insert(argv.end(), author_args.begin(), author_args.end());
        argv.insert(argv.end(), {"-m", message, "--"});
        argv.insert(argv.end(), paths.begin(), paths.end());
        json::Value result = git(dir, argv);
        if (result.find("ok")->as_bool()) {
            const auto head = git_in(dir, {"rev-parse", "--short", "HEAD"}, kCheckTimeoutMs);
            json::Value fields{json::Object{}};
            fields.set("sha", head.ok ? json::Value(trimmed(head.output)) : json::Value(nullptr));
            fields.set("message", message.substr(0, message.find('\n')));
            json::Array shown;
            for (const auto& p : paths) shown.push_back(json::Value(p));
            fields.set("paths", json::Value(shown));
            log.append("commit", std::move(fields));
        }
        return result;
    }
    if (name == "git_push") {
        const auto current = git_in(dir, {"rev-parse", "--abbrev-ref", "HEAD"}, kCheckTimeoutMs);
        const std::string branch = current.ok ? trimmed(current.output) : "unknown";
        if (branch != "main") return fail("refused: git_push sends only main, and the current branch is " + branch);
        return retrying(log, "git_push", [&] { return git(dir, {"push", "--set-upstream", "origin", "main"}); });
    }
    if (name == "git_log") {
        std::int64_t count = 20;
        const json::Value* c = list_arg("count");
        if (c == nullptr || c->is_null()) c = list_arg("limit");
        if (c != nullptr && !c->is_null()) {
            if (!c->is_number() || c->as_number() != static_cast<double>(static_cast<std::int64_t>(c->as_number())) || c->as_number() < 1 || c->as_number() > static_cast<double>(kMaxCount))
                return fail("count must be an integer from 1 to " + std::to_string(kMaxCount));
            count = static_cast<std::int64_t>(c->as_number());
        }
        std::vector<std::string> scope;
        if (const json::Value* p = list_arg("path"); p != nullptr && !p->is_null()) {
            json::Array one{*p};
            json::Value wrapped{one};
            if (auto refused = path_args(dir, &wrapped, dir, scope)) return *refused;
        }
        std::vector<std::string> argv{"log", "--oneline", "--no-color", "-n", std::to_string(count)};
        if (!scope.empty()) {
            argv.push_back("--");
            argv.insert(argv.end(), scope.begin(), scope.end());
        }
        return git(dir, argv);
    }
    if (name == "git_diff") {
        std::vector<std::string> scope;
        if (const json::Value* p = list_arg("paths"); p != nullptr && !p->is_null())
            if (auto refused = path_args(dir, p, dir, scope)) return *refused;
        std::vector<std::string> argv{"diff", "--no-color"};
        const json::Value* staged = list_arg("staged");
        if (staged != nullptr && staged->is_bool() && staged->as_bool()) argv.push_back("--cached");
        if (!scope.empty()) {
            argv.push_back("--");
            argv.insert(argv.end(), scope.begin(), scope.end());
        }
        return git(dir, argv);
    }
    if (name == "git_show") {
        const json::Value* ref = list_arg("ref");
        const json::Value ref_value = ref == nullptr || ref->is_null() ? json::Value("HEAD") : *ref;
        if (auto refused = bad_ref(&ref_value)) return *refused;
        return git(dir, {"show", "--no-color", "--stat", ref_value.as_string()});
    }
    if (name == "git_fetch") return retrying(log, "git_fetch", [&] { return git(dir, {"fetch", "origin"}); });
    if (name == "git_pull") return retrying(log, "git_pull", [&] { return git(dir, {"pull", "--ff-only"}); });
    if (name == "git_checkout") {
        const json::Value* ref = list_arg("ref");
        if (auto refused = bad_ref(ref)) return *refused;
        return git(dir, {"checkout", ref->as_string()});
    }
    if (name == "git_branch") return git(dir, {"branch", "--no-color", "--list"});
    if (name == "ci_status") return ci_status(dir, args, log);
    return fail("unknown git verb: " + name);
}

}

bool is_git_verb(std::string_view name) {
    static const std::vector<std::string_view> names{"git_status", "git_state", "git_add", "git_rm", "git_commit", "git_push", "git_log", "git_diff", "git_show", "git_fetch", "git_pull", "git_checkout", "git_branch", "ci_status"};
    return std::find(names.begin(), names.end(), name) != names.end();
}

json::Value git_call(std::string_view name, const json::Value& args, const fs::path& workspace, LockedLog& log) {
    fs::path dir;
    if (auto refused = repo_at(args, workspace, dir)) return *refused;
    return run_verb(std::string(name), args, dir, log);
}

}
