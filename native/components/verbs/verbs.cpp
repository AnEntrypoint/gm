#include "gm/core_verbs.hpp"

#include <algorithm>
#include <array>
#include <cerrno>
#include <chrono>
#include <cmath>
#include <ctime>
#include <exception>
#include <limits>
#include <system_error>

#include "core_internal.hpp"
#include "engine.hpp"
#include "gm/proc.hpp"

#if !defined(_WIN32)
#include <sys/stat.h>
#endif

namespace gm {

namespace {

using core::failure;
using core::output_page;
using core::present;
using core::refusal;
using core::utf16_length;
using core::utf16_slice;

constexpr double default_timeout_ms = 60000;
constexpr double default_job_timeout_ms = 300000;
constexpr double max_timeout_ms = 600000;
constexpr double max_job_timeout_ms = 3600000;
constexpr std::size_t shell_output_cap = 200000;
constexpr std::size_t query_page_events = 50;
constexpr std::size_t query_reply_chars = 20000;
constexpr std::size_t query_window_events = 1000;
constexpr std::size_t query_window_bytes = 4 * 1024 * 1024;
constexpr std::size_t query_cap = 20000;
constexpr std::chrono::milliseconds query_js_deadline{5000};
constexpr std::array<std::string_view, 7> query_args = {"js", "kind", "fromMono", "toMono", "after", "last", "limit"};

const std::vector<VerbInfo>& verb_table() {
    static const std::vector<VerbInfo> table = {
    {"read_file", "Read a text file, inside or outside the workspace, one page of at most 20000 characters. Lines are the default unit: offset is a 0-based line index, limit a line count (default: as many whole lines as fit), and total (the file in lines) and next (the line index of the next page, null at the end) count lines. truncated is true when the page stops before the end, totalBytes is the file size in bytes, and hint names the read that gets the rest. A line longer than the page is cut to its first 20000 characters, with cutLine true, and next is the line after it. unit \"chars\" counts offset, limit (1 to 20000, default 20000), total and next in characters instead. A path that starts with skill:// reads a served skill file, the text resources/read returns, and a skill:// uri that no served skill has is an error that names it.", R"json({"type":"object","properties":{"path":{"type":"string"},"offset":{"type":"number"},"limit":{"type":"number"},"unit":{"type":"string"}},"required":["path"]})json"},
    {"write_file", "Write a text file, inside or outside the workspace, creating parent directories.", R"json({"type":"object","properties":{"path":{"type":"string"},"content":{"type":"string"}},"required":["path","content"]})json"},
    {"edit_file", "Replace old with new in a text file, inside or outside the workspace. old must occur once, unless replaceAll is true.", R"json({"type":"object","properties":{"path":{"type":"string"},"old":{"type":"string"},"new":{"type":"string"},"replaceAll":{"type":"boolean"}},"required":["path","old","new"]})json"},
    {"stat_file", "Type, size and mtime of a path, inside or outside the workspace, as JSON.", R"json({"type":"object","properties":{"path":{"type":"string"}},"required":["path"]})json"},
    {"list_dir", "List a directory, inside or outside the workspace. Directories end with \"/\".", R"json({"type":"object","properties":{"path":{"type":"string"}},"required":[]})json"},
    {"run_shell", "Run a shell command in the workspace and wait for it. Default timeout 60000 ms. Its process group is killed when it returns, so background work must go through job_start.", R"json({"type":"object","properties":{"command":{"type":"string"},"timeoutMs":{"type":"number"}},"required":["command"]})json"},
    {"job_start", "Start a shell command as a named background job and return at once. Poll it with job_status. timeoutMs is the job's deadline in milliseconds: default 300000, at most 3600000 (and never past the job lifetime, 3600000 by default). At the deadline the job's process group gets SIGTERM, then SIGKILL, and the job ends killed with reason timeout. job_status reports the deadline as timeoutMs.", R"json({"type":"object","properties":{"job":{"type":"string"},"command":{"type":"string"},"timeoutMs":{"type":"number"}},"required":["job","command"]})json"},
    {"job_status", "State (running, exited or killed), exitCode, signal and output of a job as plain fields, with logPath (the job output file). output is the last 20000 characters, with total (its length) and truncated; with offset, output is the 20000 characters from that offset, with next. waitMs polls until the job leaves running, at most 30000 ms. Offsets and lengths count characters, not lines.", R"json({"type":"object","properties":{"job":{"type":"string"},"waitMs":{"type":"number"},"offset":{"type":"number"}},"required":["job"]})json"},
    {"job_stop", "Stop a background shell job: its process group is killed, and the job ends killed with reason cancelled. The job event is logged before the answer. A job that already ended is an error result. stopBackground stops run_code bodies only.", R"json({"type":"object","properties":{"job":{"type":"string"}},"required":["job"]})json"},
    {"query_log", "Read the run events, as JSON. after is a seq: only the events after it are read (since), so after the last seq you saw reads on from there. kind keeps events of one kind, and fromMono and toMono keep events in a time window (monotonic milliseconds). last N returns the newest N matching events instead, oldest first, at most 50, and has no next. js is a JavaScript expression over the matching events, and defaults to returning them: js sees one window of at most 1000 events or 4 MB of log. Without js, a reply holds at most 50 events and about 20 KB; limit (1 to 50) lowers that count, and is refused with last or js. When events remain, next is the seq to pass back as after; with js, next is set when the window ends before the end of the log. An unknown argument is refused, and the reply names the arguments query_log takes.", R"json({"type":"object","properties":{"js":{"type":"string"},"kind":{"type":"string"},"fromMono":{"type":"number"},"toMono":{"type":"number"},"after":{"type":"number"},"last":{"type":"number"},"limit":{"type":"number"}},"required":[]})json"},
    };
    return table;
}

json::Value number_or_null(bool has, std::size_t n) {
    return has ? json::Value(static_cast<std::uint64_t>(n)) : json::Value(nullptr);
}

void set_cut_notice(json::Value& reply, std::string_view text, const std::string* rest) {
    reply.set("truncated", rest != nullptr);
    reply.set("totalBytes", static_cast<std::uint64_t>(text.size()));
    if (rest != nullptr) reply.set("hint", *rest);
}

std::vector<std::size_t> line_starts(std::string_view text) {
    std::vector<std::size_t> starts{0};
    for (std::size_t at = text.find('\n'); at != std::string_view::npos; at = text.find('\n', at + 1)) starts.push_back(at + 1);
    if (starts.back() == text.size()) starts.pop_back();
    return starts;
}

std::string time_iso(std::int64_t seconds, std::int64_t millis) {
    std::time_t t = static_cast<std::time_t>(seconds);
    std::tm parts{};
#if defined(_WIN32)
    gmtime_s(&parts, &t);
#else
    gmtime_r(&t, &parts);
#endif
    char buffer[96];
    std::snprintf(buffer, sizeof buffer, "%04d-%02d-%02dT%02d:%02d:%02d.%03dZ", parts.tm_year + 1900, parts.tm_mon + 1, parts.tm_mday,
                  parts.tm_hour, parts.tm_min, parts.tm_sec, static_cast<int>(millis));
    return buffer;
}

std::string trim_ascii(std::string_view s) {
    auto space = [](char c) { return c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\f' || c == '\v'; };
    while (!s.empty() && space(s.front())) s.remove_prefix(1);
    while (!s.empty() && space(s.back())) s.remove_suffix(1);
    return std::string(s);
}

double timeout_of(const json::Value& args, double fallback = default_timeout_ms, double cap = max_timeout_ms) {
    const json::Value* t = args.find("timeoutMs");
    double ms = t != nullptr && t->is_number() && std::isfinite(t->as_number()) && t->as_number() != 0 ? t->as_number() : fallback;
    return std::min(ms, cap);
}

std::size_t escaped_units(const json::Value& event) { return utf16_length(json::quote(json::dump(event))) - 2; }

std::size_t reply_chars_of(std::size_t escaped_sum, std::size_t count) {
    std::size_t commas = count > 0 ? count - 1 : 0;
    return 21 + 2 + 2 + escaped_sum + commas;
}

json::Value clipped(const json::Value& event) {
    std::string text = json::dump(event);
    std::size_t size = std::min(utf16_length(text), query_reply_chars);
    auto shown_of = [&](std::size_t n) {
        json::Value shown;
        shown.set("seq", event.find("seq") != nullptr ? *event.find("seq") : json::Value(nullptr));
        shown.set("kind", event.find("kind") != nullptr ? *event.find("kind") : json::Value(nullptr));
        shown.set("truncated", utf16_slice(text, 0, n));
        return shown;
    };
    json::Value shown = shown_of(size);
    while (reply_chars_of(escaped_units(shown), 1) > query_reply_chars) {
        size = static_cast<std::size_t>(std::floor(static_cast<double>(size) * 0.8));
        shown = shown_of(size);
    }
    return shown;
}

json::Array page_of(const std::vector<const json::Value*>& events, std::size_t limit) {
    json::Array page;
    std::size_t escaped_sum = 0;
    for (const json::Value* event : events) {
        if (page.size() == limit) break;
        std::size_t units = escaped_units(*event);
        if (reply_chars_of(escaped_sum + units, page.size() + 1) <= query_reply_chars) {
            page.push_back(*event);
            escaped_sum += units;
            continue;
        }
        if (page.empty()) page.push_back(clipped(*event));
        break;
    }
    return page;
}

json::Value capped_query_reply(std::string text) {
    json::Value reply;
    reply.set("ok", true);
    if (utf16_length(text) <= query_cap) {
        reply.set("output", std::move(text));
    } else {
        reply.set("output", utf16_slice(text, 0, query_cap) + " ...[cut at 20000 chars, narrow the filter]");
    }
    return reply;
}

json::Value run_query_text(const json::Array& events) { return capped_query_reply(json::dump(json::Value(events))); }

json::Value run_query_js(const std::vector<const json::Value*>& events, const std::string& js) {
    json::Array copied;
    copied.reserve(events.size());
    for (const json::Value* event : events) copied.push_back(*event);
    auto text = engine::stringify_function_of("events", js, json::Value(std::move(copied)), query_js_deadline);
    if (!text) return failure(text.error());
    return capped_query_reply(std::move(*text));
}

std::uint64_t seq_of(const json::Value& event) {
    const json::Value* s = event.find("seq");
    return s != nullptr && s->is_number() ? static_cast<std::uint64_t>(s->as_number()) : 0;
}

}

struct CoreVerbs::Impl {
    Impl(CoreVerbsOptions opts, std::shared_ptr<RunLog> run_log)
        : options(std::move(opts)),
          root(resolve_root(options.workspace)),
          log(std::move(run_log), options.on_append),
          jobs(root, log, options.job_lifetime_ms) {}

    static std::filesystem::path resolve_root(const std::filesystem::path& workspace) {
        std::error_code ec;
        auto absolute = std::filesystem::absolute(workspace, ec);
        return strip_trailing(absolute.lexically_normal());
    }

    static std::filesystem::path strip_trailing(std::filesystem::path p) {
        std::string s = p.string();
        while (s.size() > 1 && (s.back() == '/' || s.back() == '\\')) s.pop_back();
        return std::filesystem::path(s);
    }

    std::optional<std::filesystem::path> locate(const json::Value* rel) const {
        if (rel == nullptr || !rel->is_string() || rel->as_string().empty()) return std::nullopt;
        std::filesystem::path p(rel->as_string());
        if (!p.is_absolute()) p = root / p;
        return strip_trailing(p.lexically_normal());
    }

    std::string relative_text(const std::filesystem::path& target) const {
        std::string rel = target.lexically_relative(root).string();
        return rel == "." ? std::string() : rel;
    }

    json::Value read_file(const json::Value& args) {
        const json::Value* path_value = args.find("path");
        const bool served = path_value != nullptr && path_value->is_string() && path_value->as_string().starts_with("skill://");
        std::optional<std::filesystem::path> at;
        if (!served) {
            at = locate(path_value);
            if (!at) return refusal("path must be a non-empty string");
        }
        const json::Value* unit_value = present(args, "unit");
        std::string unit = unit_value == nullptr ? "lines" : (unit_value->is_string() ? unit_value->as_string() : "?");
        if (unit != "chars" && unit != "lines") return failure("unit must be lines or chars");
        if (served) {
            std::string uri = path_value->as_string();
            auto text = options.serve_skill ? options.serve_skill(uri) : std::nullopt;
            if (!text) return failure("no served skill file has the uri " + uri);
            return unit == "chars" ? char_page(*text, args) : line_page(*text, args);
        }
        return unit == "chars" ? read_char_page(*at, args) : read_line_page(*at, args);
    }

    std::optional<std::string> char_args_problem(const json::Value& args) {
        const json::Value* offset_value = present(args, "offset");
        const json::Value* limit_value = present(args, "limit");
        if (offset_value != nullptr && (!core::is_whole_number(offset_value) || offset_value->as_number() < 0)) {
            return "offset must be a whole number of characters, zero or more";
        }
        if (limit_value != nullptr && (!core::is_whole_number(limit_value) || limit_value->as_number() < 1 || limit_value->as_number() > static_cast<double>(output_page))) {
            return "limit must be a whole number from 1 to 20000";
        }
        return std::nullopt;
    }

    json::Value read_char_page(const std::filesystem::path& path, const json::Value& args) {
        if (auto problem = char_args_problem(args)) return failure(*problem);
        auto file = core::read_text(path, "stat");
        if (!file.ok) return failure(file.error);
        return char_page(file.text, args);
    }

    json::Value char_page(const std::string& text, const json::Value& args) {
        const json::Value* offset_value = present(args, "offset");
        const json::Value* limit_value = present(args, "limit");
        std::size_t offset = offset_value != nullptr ? static_cast<std::size_t>(offset_value->as_number()) : 0;
        std::size_t limit = limit_value != nullptr ? static_cast<std::size_t>(limit_value->as_number()) : output_page;
        std::size_t length = utf16_length(text);
        std::size_t end = std::min(offset + limit, length);
        bool more = end < length;
        json::Value reply;
        reply.set("ok", true);
        reply.set("output", utf16_slice(text, offset, end));
        reply.set("total", static_cast<std::uint64_t>(length));
        reply.set("offset", static_cast<std::uint64_t>(offset));
        reply.set("next", number_or_null(more, end));
        std::string hint = "pass unit: \"chars\", offset: " + std::to_string(end) + " and limit: 20000 to read the rest";
        set_cut_notice(reply, text, more ? &hint : nullptr);
        return reply;
    }

    std::optional<std::string> line_args_problem(const json::Value& args) {
        const json::Value* offset_value = present(args, "offset");
        const json::Value* limit_value = present(args, "limit");
        if (offset_value != nullptr && (!core::is_whole_number(offset_value) || offset_value->as_number() < 0)) {
            return "offset must be a whole number of lines, zero or more";
        }
        if (limit_value != nullptr && (!core::is_whole_number(limit_value) || limit_value->as_number() < 1)) {
            return "limit must be a whole number of lines, one or more";
        }
        return std::nullopt;
    }

    json::Value read_line_page(const std::filesystem::path& path, const json::Value& args) {
        if (auto problem = line_args_problem(args)) return failure(*problem);
        auto file = core::read_text(path, "stat");
        if (!file.ok) return failure(file.error);
        return line_page(file.text, args);
    }

    json::Value line_page(const std::string& text, const json::Value& args) {
        const json::Value* offset_value = present(args, "offset");
        const json::Value* limit_value = present(args, "limit");
        std::size_t offset = offset_value != nullptr ? static_cast<std::size_t>(offset_value->as_number()) : 0;
        std::size_t limit = limit_value != nullptr ? static_cast<std::size_t>(limit_value->as_number()) : std::numeric_limits<std::size_t>::max();
        auto starts = line_starts(text);
        std::size_t total = starts.size();
        json::Value reply;
        reply.set("ok", true);
        reply.set("unit", "lines");
        if (offset >= total) {
            reply.set("output", "");
            reply.set("total", static_cast<std::uint64_t>(total));
            reply.set("offset", static_cast<std::uint64_t>(offset));
            reply.set("next", nullptr);
            set_cut_notice(reply, text, nullptr);
            return reply;
        }
        auto line_end = [&](std::size_t line) { return line + 1 < total ? starts[line + 1] : text.size(); };
        auto units_between = [&](std::size_t a, std::size_t b) { return utf16_length(std::string_view(text).substr(a, b - a)); };
        std::size_t begin = starts[offset];
        std::size_t used = units_between(begin, line_end(offset));
        if (used > output_page) {
            std::string_view rest_of_text = std::string_view(text).substr(begin);
            std::size_t cut = core::byte_at_utf16(rest_of_text, output_page);
            std::size_t begin_units = utf16_length(std::string_view(text).substr(0, begin));
            reply.set("output", std::string(rest_of_text.substr(0, cut)));
            reply.set("cutLine", true);
            reply.set("total", static_cast<std::uint64_t>(total));
            reply.set("offset", static_cast<std::uint64_t>(offset));
            reply.set("next", number_or_null(offset + 1 < total, offset + 1));
            std::string hint = "line " + std::to_string(offset) + " is longer than a page: pass unit: \"chars\", offset: " +
                               std::to_string(begin_units + output_page) + " and limit: 20000 to read the rest";
            set_cut_notice(reply, text, &hint);
            return reply;
        }
        std::size_t last = offset + 1;
        while (last < total && last - offset < limit) {
            std::size_t grown = used + units_between(starts[last], line_end(last));
            if (grown > output_page) break;
            used = grown;
            ++last;
        }
        bool more = last < total;
        reply.set("output", text.substr(begin, line_end(last - 1) - begin));
        reply.set("total", static_cast<std::uint64_t>(total));
        reply.set("offset", static_cast<std::uint64_t>(offset));
        reply.set("next", number_or_null(more, last));
        std::string hint = more ? "pass offset: " + std::to_string(last) + " and limit: " + std::to_string(total - last) + " to read the rest" : std::string();
        set_cut_notice(reply, text, more ? &hint : nullptr);
        return reply;
    }

    json::Value write_file(const json::Value& args) {
        auto at = locate(args.find("path"));
        if (!at) return refusal("path must be a non-empty string");
        const json::Value* content = args.find("content");
        if (content == nullptr || !content->is_string()) return failure("content must be a string");
        auto parent = at->parent_path();
        std::error_code ec;
        std::filesystem::create_directories(parent, ec);
        if (ec) return failure(core::node_error(ec.value(), "mkdir", &parent));
        std::string error = core::write_text(*at, content->as_string());
        if (!error.empty()) return failure(error);
        json::Value reply;
        reply.set("ok", true);
        reply.set("output", "wrote " + relative_text(*at) + " (" + std::to_string(utf16_length(content->as_string())) + " chars)");
        return reply;
    }

    json::Value edit_file(const json::Value& args) {
        const json::Value* path_value = args.find("path");
        auto at = locate(path_value);
        if (!at) return refusal("path must be a non-empty string");
        const json::Value* old_value = args.find("old");
        const json::Value* new_value = args.find("new");
        if (old_value == nullptr || !old_value->is_string() || old_value->as_string().empty()) return failure("old must be a non-empty string");
        if (new_value == nullptr || !new_value->is_string()) return failure("new must be a string");
        auto file = core::read_text(*at, "open");
        if (!file.ok) return failure(file.error);
        const std::string& old_text = old_value->as_string();
        const std::string& new_text = new_value->as_string();
        std::size_t count = 0;
        std::string edited;
        std::size_t from = 0;
        for (std::size_t hit = file.text.find(old_text); hit != std::string::npos; hit = file.text.find(old_text, from)) {
            edited.append(file.text, from, hit - from);
            edited.append(new_text);
            from = hit + old_text.size();
            ++count;
        }
        edited.append(file.text, from, std::string::npos);
        const std::string& shown_path = path_value->as_string();
        if (count == 0) return failure("old text not found in " + shown_path);
        const json::Value* replace_all = args.find("replaceAll");
        if (count > 1 && !(replace_all != nullptr && replace_all->is_bool() && replace_all->as_bool())) {
            return failure("old text occurs " + std::to_string(count) + " times in " + shown_path + "; add context to make it unique, or set replaceAll");
        }
        std::string error = core::write_text(*at, edited);
        if (!error.empty()) return failure(error);
        json::Value reply;
        reply.set("ok", true);
        reply.set("output", "edited " + relative_text(*at) + " (" + std::to_string(count) + " replacement" + (count == 1 ? "" : "s") + ")");
        return reply;
    }

    json::Value stat_file(const json::Value& args) {
        auto at = locate(args.find("path"));
        if (!at) return refusal("path must be a non-empty string");
        json::Value info;
#if defined(_WIN32)
        std::error_code ec;
        auto status = std::filesystem::status(*at, ec);
        if (ec || !std::filesystem::exists(status)) return failure(core::node_error(ENOENT, "stat", &*at));
        bool directory = std::filesystem::is_directory(status);
        bool regular = std::filesystem::is_regular_file(status);
        std::uint64_t size = regular ? std::filesystem::file_size(*at, ec) : 0;
        auto written = std::filesystem::last_write_time(*at, ec);
        auto since_epoch = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::clock_cast<std::chrono::system_clock>(written).time_since_epoch()).count();
        std::int64_t seconds = since_epoch / 1000;
        std::int64_t millis = since_epoch % 1000;
#else
        struct stat raw {};
        if (::stat(at->c_str(), &raw) != 0) return failure(core::node_error(errno, "stat", &*at));
        bool directory = S_ISDIR(raw.st_mode);
        bool regular = S_ISREG(raw.st_mode);
        std::uint64_t size = static_cast<std::uint64_t>(raw.st_size);
#if defined(__APPLE__)
        std::int64_t seconds = raw.st_mtimespec.tv_sec;
        std::int64_t millis = raw.st_mtimespec.tv_nsec / 1000000;
#else
        std::int64_t seconds = raw.st_mtim.tv_sec;
        std::int64_t millis = raw.st_mtim.tv_nsec / 1000000;
#endif
#endif
        info.set("type", directory ? "dir" : regular ? "file" : "other");
        info.set("size", size);
        info.set("mtime", time_iso(seconds, millis));
        json::Value reply;
        reply.set("ok", true);
        reply.set("output", json::dump(info));
        return reply;
    }

    json::Value list_dir(const json::Value& args) {
        const json::Value* path_value = present(args, "path");
        json::Value dot(".");
        auto at = locate(path_value != nullptr ? path_value : &dot);
        if (!at) return refusal("path must be a non-empty string");
        std::error_code ec;
        std::filesystem::directory_iterator it(*at, ec);
        if (ec) return failure(core::node_error(ec.default_error_condition().value(), "scandir", &*at));
        std::vector<std::string> names;
        for (const auto& entry : it) {
            std::error_code type_error;
            bool directory = entry.symlink_status(type_error).type() == std::filesystem::file_type::directory;
            names.push_back(entry.path().filename().string() + (directory ? "/" : ""));
        }
        std::sort(names.begin(), names.end());
        std::string output;
        for (std::size_t i = 0; i < names.size(); ++i) {
            if (i > 0) output.push_back('\n');
            output += names[i];
        }
        json::Value reply;
        reply.set("ok", true);
        reply.set("output", std::move(output));
        return reply;
    }

    json::Value run_shell(const json::Value& args) {
        const json::Value* command = args.find("command");
        if (command == nullptr || !command->is_string() || trim_ascii(command->as_string()).empty()) {
            return failure("command must be a non-empty string");
        }
        double timeout_ms = timeout_of(args);
        auto timeout = static_cast<std::uint64_t>(std::max(1.0, timeout_ms));
#if defined(_WIN32)
        std::string line = command->as_string();
#else
        std::string line = "exec 2>&1\n" + command->as_string();
#endif
        proc::Outcome outcome = proc::shell(line, root, timeout);
        if (!outcome.started) return failure("spawn of the shell failed");
        std::string output = core::to_valid_utf8(outcome.out + outcome.err);
        if (utf16_length(output) > shell_output_cap) output = utf16_slice(output, 0, shell_output_cap);
        json::Value reply;
        if (outcome.timed_out) {
            reply.set("ok", false);
            reply.set("timedOut", true);
            reply.set("error", "timed out after " + json::dump(json::Value(timeout_ms)) + " ms");
            reply.set("output", std::move(output));
            return reply;
        }
        reply.set("ok", outcome.exit_code == 0);
        if (outcome.signal != 0) {
            const char* name = proc::signal_name(outcome.signal);
            reply.set("exitCode", nullptr);
            reply.set("signal", name != nullptr ? json::Value(name) : json::Value(outcome.signal));
        } else {
            reply.set("exitCode", outcome.exit_code);
            reply.set("signal", nullptr);
        }
        reply.set("output", std::move(output));
        return reply;
    }

    json::Value job_start(const json::Value& args) {
        const json::Value* command = args.find("command");
        if (command == nullptr || !command->is_string() || trim_ascii(command->as_string()).empty()) {
            return failure("command must be a non-empty string");
        }
        double timeout_ms = timeout_of(args, default_job_timeout_ms, max_job_timeout_ms);
        const json::Value* job = args.find("job");
        bool named = job != nullptr && job->is_string() && !job->as_string().empty() && job->as_string().size() <= 64 &&
                     std::all_of(job->as_string().begin(), job->as_string().end(), [](char c) {
                         return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_' || c == '-';
                     });
        if (!named) return failure("a background job needs job: 1 to 64 letters, digits, _ or -");
        return jobs.start(job->as_string(), command->as_string(), static_cast<std::uint64_t>(std::max(1.0, timeout_ms)));
    }

    json::Value query_log(const json::Value& args) {
        std::vector<std::string> unknown;
        if (args.is_object()) {
            for (const auto& [key, value] : args.as_object()) {
                if (std::find(query_args.begin(), query_args.end(), key) == query_args.end()) unknown.push_back(key);
            }
        }
        if (!unknown.empty()) {
            std::string names;
            for (std::size_t i = 0; i < unknown.size(); ++i) names += (i > 0 ? ", " : "") + unknown[i];
            return refusal("unknown argument " + names + "; query_log takes js, kind, fromMono, toMono, after, last, limit");
        }
        const json::Value* js = present(args, "js");
        const json::Value* kind = present(args, "kind");
        if (js != nullptr && !js->is_string()) return failure("js must be a string");
        if (kind != nullptr && !kind->is_string()) return failure("kind must be a string");
        for (std::string_view name : {"after", "fromMono", "toMono"}) {
            const json::Value* v = present(args, name);
            if (v != nullptr && (!v->is_number() || !std::isfinite(v->as_number()))) return failure(std::string(name) + " must be a number");
        }
        const json::Value* last = present(args, "last");
        if (last != nullptr && (!core::is_whole_number(last) || last->as_number() < 1 || last->as_number() > static_cast<double>(query_page_events))) {
            return failure("last must be a whole number from 1 to 50");
        }
        const json::Value* limit = present(args, "limit");
        if (limit != nullptr) {
            if (last != nullptr) return refusal("limit cannot be used with last, which already sets how many events a reply returns");
            if (js != nullptr) return refusal("limit cannot be used with js, whose expression sees the whole window of matching events");
            if (!core::is_whole_number(limit) || limit->as_number() < 1 || limit->as_number() > static_cast<double>(query_page_events)) {
                return failure("limit must be a whole number from 1 to 50");
            }
        }
        auto events = log.read_all();
        if (!events) return failure(events.error());
        const json::Value* after_value = present(args, "after");
        double after_raw = after_value != nullptr ? std::floor(after_value->as_number()) : 0;
        auto after = static_cast<std::uint64_t>(std::max(0.0, after_raw));
        const json::Value* from_mono = present(args, "fromMono");
        const json::Value* to_mono = present(args, "toMono");
        auto match = [&](const json::Value& event) {
            if (kind != nullptr) {
                const json::Value* k = event.find("kind");
                if (k == nullptr || !k->is_string() || k->as_string() != kind->as_string()) return false;
            }
            if (from_mono != nullptr || to_mono != nullptr) {
                const json::Value* m = event.find("mono");
                if (m == nullptr || !m->is_number()) return false;
                if (from_mono != nullptr && m->as_number() < from_mono->as_number()) return false;
                if (to_mono != nullptr && m->as_number() > to_mono->as_number()) return false;
            }
            return true;
        };
        std::uint64_t count = events->empty() ? 0 : seq_of(events->back());

        if (last != nullptr) {
            auto wanted = static_cast<std::size_t>(last->as_number());
            std::vector<const json::Value*> newest;
            for (auto it = events->rbegin(); it != events->rend() && newest.size() < wanted; ++it) {
                if (seq_of(*it) <= after) break;
                if (match(*it)) newest.push_back(&*it);
            }
            std::reverse(newest.begin(), newest.end());
            if (js != nullptr) return run_query_js(newest, js->as_string());
            std::vector<std::size_t> units;
            std::size_t sum = 0;
            for (const json::Value* e : newest) {
                units.push_back(escaped_units(*e));
                sum += units.back();
            }
            std::size_t from = 0;
            while (from + 1 < newest.size() && reply_chars_of(sum, newest.size() - from) > query_reply_chars) {
                sum -= units[from];
                ++from;
            }
            json::Array kept;
            std::size_t omitted = from;
            if (newest.empty() || reply_chars_of(sum, newest.size() - from) <= query_reply_chars) {
                for (std::size_t i = from; i < newest.size(); ++i) kept.push_back(*newest[i]);
            } else {
                kept.push_back(clipped(*newest.back()));
                omitted = newest.size() - 1;
            }
            json::Value reply = run_query_text(kept);
            if (omitted > 0) reply.set("omitted", static_cast<std::uint64_t>(omitted));
            return reply;
        }

        std::vector<const json::Value*> window;
        std::uint64_t scanned_last = after;
        std::size_t bytes_read = 0;
        for (const json::Value& event : *events) {
            std::uint64_t seq = seq_of(event);
            if (seq <= after) continue;
            if (window.size() >= query_window_events) break;
            if (bytes_read >= query_window_bytes && scanned_last != after) break;
            bytes_read += json::dump(event).size() + 1;
            scanned_last = seq;
            if (match(event)) window.push_back(&event);
        }
        bool more = scanned_last < count;
        if (js != nullptr) {
            json::Value reply = run_query_js(window, js->as_string());
            if (more) reply.set("next", scanned_last);
            return reply;
        }
        std::size_t page_limit = limit != nullptr ? static_cast<std::size_t>(limit->as_number()) : query_page_events;
        json::Array page = page_of(window, page_limit);
        json::Value reply = run_query_text(page);
        if (page.size() < window.size()) {
            reply.set("next", static_cast<std::uint64_t>(seq_of(page.back())));
        } else if (more) {
            reply.set("next", scanned_last);
        }
        return reply;
    }

    CoreVerbsOptions options;
    std::filesystem::path root;
    core::LockedLog log;
    core::JobTable jobs;
};

CoreVerbs::CoreVerbs(CoreVerbsOptions options, RunLog& log)
    : impl_(std::make_unique<Impl>(std::move(options), std::shared_ptr<RunLog>(std::shared_ptr<void>{}, &log))) {
    impl_->jobs.stop_orphans();
}

CoreVerbs::CoreVerbs(CoreVerbsOptions options) : impl_(std::make_unique<Impl>(std::move(options), nullptr)) {}

void CoreVerbs::bind_run(std::shared_ptr<RunLog> log) {
    impl_->log.bind(std::move(log));
    impl_->jobs.stop_orphans();
}

CoreVerbs::~CoreVerbs() = default;

std::vector<VerbInfo> CoreVerbs::list() const { return verb_table(); }

void CoreVerbs::close(std::string_view reason) { impl_->jobs.close(reason); }

void CoreVerbs::flush_job_events() { impl_->jobs.flush_ended(); }

json::Value CoreVerbs::job_snapshot() { return impl_->jobs.snapshot(impl_->options.job_stuck_ms); }

json::Value CoreVerbs::call(std::string_view name, const json::Value& raw_args) {
    static const json::Value empty_object = json::Value(json::Object{});
    const json::Value& args = raw_args.is_object() ? raw_args : empty_object;
    try {
        impl_->jobs.flush_ended();
        if (name == "read_file") return impl_->read_file(args);
        if (name == "write_file") return impl_->write_file(args);
        if (name == "edit_file") return impl_->edit_file(args);
        if (name == "stat_file") return impl_->stat_file(args);
        if (name == "list_dir") return impl_->list_dir(args);
        if (name == "run_shell") return impl_->run_shell(args);
        if (name == "job_start") return impl_->job_start(args);
        if (name == "job_status") return impl_->jobs.status(args);
        if (name == "job_stop") return impl_->jobs.stop(args);
        if (name == "query_log") return impl_->query_log(args);
    } catch (const std::exception& error) {
        return failure(error.what());
    }
    return failure("unknown tool: " + std::string(name));
}

}
