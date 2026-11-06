#include "gm/log.hpp"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <limits>
#include <optional>
#include <sstream>
#include <system_error>
#include <utility>

namespace gm {

namespace {

constexpr std::size_t kRecordBytes = 16;

double round_millis(double ms) { return std::round(ms * 1000) / 1000; }

constexpr std::string_view kRedacted = "[redacted]";

std::string lowered(std::string text) {
    for (char& c : text) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    return text;
}

bool may_hold_secret(const std::string& text) {
    const std::string lower = lowered(text);
    for (const char* marker : {"ya29.", "aiza", "sk-", "private key", "bearer", "token", "secret", "password", "key"}) {
        if (lower.find(marker) != std::string::npos) return true;
    }
    return false;
}

bool word_char(char c) { return std::isalnum(static_cast<unsigned char>(c)) || c == '_' || c == '-'; }

bool token_char(char c) { return word_char(c) || c == '.' || c == '~' || c == '+' || c == '/' || c == '='; }

bool value_char(char c) { return !std::isspace(static_cast<unsigned char>(c)) && c != '"' && c != '&' && c != ',' && c != '}'; }

std::size_t run_end(const std::string& text, std::size_t from, bool (*accept)(char)) {
    std::size_t end = from;
    while (end < text.size() && accept(text[end])) ++end;
    return end;
}

void replace_span(std::string& text, std::size_t begin, std::size_t end) {
    text.replace(begin, end - begin, kRedacted);
}

void redact_prefixed(std::string& text, std::string_view prefix, bool (*accept)(char), std::size_t min_token) {
    std::size_t at = text.find(prefix);
    while (at != std::string::npos) {
        const std::size_t end = run_end(text, at + prefix.size(), accept);
        if (end - at >= min_token) {
            replace_span(text, at, end);
            at += kRedacted.size();
        } else {
            at += prefix.size();
        }
        at = text.find(prefix, at);
    }
}

void replace_span(std::string& text, std::string& lower, std::size_t begin, std::size_t end) {
    text.replace(begin, end - begin, kRedacted);
    lower.replace(begin, end - begin, kRedacted);
}

void redact_bearer(std::string& text) {
    std::string lower = lowered(text);
    std::size_t at = lower.find("bearer");
    while (at != std::string::npos) {
        std::size_t begin = at + 6;
        while (begin < text.size() && std::isspace(static_cast<unsigned char>(text[begin]))) ++begin;
        const std::size_t end = run_end(text, begin, token_char);
        if (begin < end && text.compare(begin, end - begin, kRedacted) != 0) {
            replace_span(text, lower, begin, end);
            at = lower.find("bearer", begin + kRedacted.size());
        } else {
            at = lower.find("bearer", at + 6);
        }
    }
}

void redact_assignments(std::string& text) {
    static const std::vector<std::string> keys = {"access_token", "refresh_token", "id_token", "client_secret", "api_key", "api-key", "apikey", "password"};
    std::string lower = lowered(text);
    for (const std::string& key : keys) {
        std::size_t at = lower.find(key);
        while (at != std::string::npos) {
            std::size_t cursor = at + key.size();
            if (cursor < text.size() && text[cursor] == '"') ++cursor;
            while (cursor < text.size() && std::isspace(static_cast<unsigned char>(text[cursor]))) ++cursor;
            if (cursor < text.size() && (text[cursor] == '=' || text[cursor] == ':')) {
                ++cursor;
                while (cursor < text.size() && std::isspace(static_cast<unsigned char>(text[cursor]))) ++cursor;
                if (cursor < text.size() && text[cursor] == '"') ++cursor;
                const std::size_t end = run_end(text, cursor, value_char);
                if (end > cursor && text.compare(cursor, end - cursor, kRedacted) != 0) {
                    replace_span(text, lower, cursor, end);
                }
            }
            at = lower.find(key, at + key.size());
        }
    }
}

void redact_private_keys(std::string& text) {
    std::size_t begin = text.find("-----BEGIN ");
    while (begin != std::string::npos) {
        const std::size_t line_end = text.find('\n', begin);
        const std::size_t header_end = line_end == std::string::npos ? text.size() : line_end;
        const std::size_t end_at = text.find("-----END ", begin);
        if (text.substr(begin, header_end - begin).find("PRIVATE KEY") != std::string::npos && end_at != std::string::npos) {
            const std::size_t close = text.find("PRIVATE KEY-----", end_at);
            if (close != std::string::npos) {
                replace_span(text, begin, close + std::string_view("PRIVATE KEY-----").size());
            }
        }
        begin = text.find("-----BEGIN ", begin + kRedacted.size());
    }
}

std::string redact_text(const std::string& text) {
    if (!may_hold_secret(text)) return text;
    std::string out = text;
    redact_private_keys(out);
    redact_prefixed(out, "ya29.", [](char c) { return c == '.' || word_char(c); }, 6);
    redact_prefixed(out, "AIza", word_char, 30);
    redact_prefixed(out, "sk-", word_char, 20);
    redact_bearer(out);
    redact_assignments(out);
    return out;
}

json::Value redact_value(const json::Value& value) {
    if (value.is_string()) return json::Value(redact_text(value.as_string()));
    if (value.is_array()) {
        json::Array out;
        for (const json::Value& item : value.as_array()) out.push_back(redact_value(item));
        return json::Value(std::move(out));
    }
    if (value.is_object()) {
        json::Object out;
        for (const json::Member& m : value.as_object()) out.emplace_back(m.first, redact_value(m.second));
        return json::Value(std::move(out));
    }
    return value;
}

std::string iso_now() {
    using namespace std::chrono;
    auto now = time_point_cast<milliseconds>(system_clock::now());
    auto day = floor<days>(now);
    year_month_day ymd{day};
    auto ms = duration_cast<milliseconds>(now - day).count();
    char buf[40];
    std::snprintf(buf, sizeof buf, "%04d-%02u-%02uT%02d:%02d:%02d.%03dZ", static_cast<int>(ymd.year()),
                  static_cast<unsigned>(ymd.month()), static_cast<unsigned>(ymd.day()),
                  static_cast<int>(ms / 3600000), static_cast<int>(ms / 60000 % 60), static_cast<int>(ms / 1000 % 60),
                  static_cast<int>(ms % 1000));
    return buf;
}

bool read_text(const std::filesystem::path& file, std::string& out) {
    std::ifstream in(file, std::ios::binary);
    if (!in) return false;
    std::ostringstream ss;
    ss << in.rdbuf();
    out = ss.str();
    return true;
}

bool append_bytes(const std::filesystem::path& file, const std::string& bytes) {
    std::ofstream out(file, std::ios::binary | std::ios::app);
    if (!out) return false;
    out.write(bytes.data(), static_cast<std::streamsize>(bytes.size()));
    out.flush();
    return static_cast<bool>(out);
}

std::string record(std::uint64_t offset, std::uint32_t length) {
    std::string r(kRecordBytes, '\0');
    double d = static_cast<double>(offset);
    for (std::size_t i = 0; i < 8; ++i) {
        std::uint64_t bits;
        static_assert(sizeof bits == sizeof d);
        std::memcpy(&bits, &d, sizeof bits);
        r[i] = static_cast<char>((bits >> (8 * i)) & 0xFF);
    }
    for (std::size_t i = 0; i < 4; ++i) r[8 + i] = static_cast<char>((length >> (8 * i)) & 0xFF);
    return r;
}

struct Scan {
    std::vector<std::string> lines;
    std::string index;
    std::uint64_t seq = 0;
    double mono = 0;
};

struct ParsedLine {
    std::optional<json::Value> event;
    std::string error;
};

ParsedLine parse_line(std::string_view line) {
    if (line.find_first_not_of(" \t\r") == std::string_view::npos) return {};
    auto event = json::parse(line);
    if (!event) return {std::nullopt, event.error()};
    return {std::move(*event), {}};
}

std::vector<ParsedLine> parse_line_set(const std::string& text) {
    std::vector<ParsedLine> lines;
    std::size_t begin = 0;
    while (begin < text.size()) {
        std::size_t nl = text.find('\n', begin);
        std::size_t end = nl == std::string::npos ? text.size() : nl;
        lines.push_back(parse_line(std::string_view(text.data() + begin, end - begin)));
        begin = end + 1;
    }
    return lines;
}

deoxidene::Result<std::vector<json::Value>, std::string> parse_lines(const std::string& text) {
    std::vector<json::Value> events;
    for (ParsedLine& parsed : parse_line_set(text)) {
        if (!parsed.error.empty()) return deoxidene::Err<std::string>{parsed.error};
        if (parsed.event) events.push_back(std::move(*parsed.event));
    }
    return events;
}

std::uint64_t seq_field(const json::Value& event) {
    const json::Value* s = event.find("seq");
    return s != nullptr && s->is_number() ? static_cast<std::uint64_t>(s->as_number()) : 0;
}

struct IndexRecord {
    std::uint64_t offset = 0;
    std::uint32_t length = 0;
};

bool read_index_record(std::ifstream& index, std::uint64_t position, IndexRecord& out) {
    if (position > std::numeric_limits<std::uint64_t>::max() / kRecordBytes) return false;
    char rec[kRecordBytes];
    index.clear();
    index.seekg(static_cast<std::streamoff>(position * kRecordBytes));
    if (!index.read(rec, kRecordBytes)) return false;
    std::uint64_t bits = 0;
    for (std::size_t i = 0; i < 8; ++i) bits |= static_cast<std::uint64_t>(static_cast<unsigned char>(rec[i])) << (8 * i);
    double offset;
    std::memcpy(&offset, &bits, sizeof offset);
    if (!std::isfinite(offset) || offset < 0 || offset > static_cast<double>(std::numeric_limits<std::uint64_t>::max())) return false;
    std::uint32_t length = 0;
    for (std::size_t i = 0; i < 4; ++i) length |= static_cast<std::uint32_t>(static_cast<unsigned char>(rec[8 + i])) << (8 * i);
    out.offset = static_cast<std::uint64_t>(offset);
    out.length = length;
    return true;
}

struct LineSet {
    std::ifstream index;
    std::ifstream log;
    std::uint64_t indexed = 0;
    std::uint64_t last_seq = 0;
    std::vector<ParsedLine> tail;
    std::string error;

    std::uint64_t size() const { return indexed + tail.size(); }

    ParsedLine at(std::uint64_t seq) {
        if (seq <= indexed) {
            IndexRecord rec;
            if (!read_index_record(index, seq - 1, rec)) return {std::nullopt, "cannot read log.index"};
            std::string bytes(rec.length, '\0');
            log.clear();
            log.seekg(static_cast<std::streamoff>(rec.offset));
            if (!log.read(bytes.data(), static_cast<std::streamsize>(rec.length))) return {std::nullopt, "cannot read log.jsonl"};
            std::string_view line(bytes.data(), rec.length);
            if (!line.empty() && line.back() == '\n') line.remove_suffix(1);
            return parse_line(line);
        }
        std::size_t position = static_cast<std::size_t>(seq - indexed - 1);
        if (position >= tail.size()) return {};
        return tail[position];
    }
};

LineSet open_lines(const std::filesystem::path& dir, std::uint64_t next_seq) {
    LineSet lines;
    lines.last_seq = next_seq - 1;
    auto index_path = dir / "log.index";
    auto log_path = dir / "log.jsonl";
    std::error_code ec;
    std::uint64_t index_bytes = std::filesystem::file_size(index_path, ec);
    if (ec) index_bytes = 0;
    lines.indexed = std::min(index_bytes / kRecordBytes, lines.last_seq);
    lines.index.open(index_path, std::ios::binary);
    lines.log.open(log_path, std::ios::binary);
    if (!lines.log) {
        lines.error = "cannot read " + log_path.string();
        return lines;
    }
    std::uint64_t end = 0;
    if (lines.indexed > 0) {
        IndexRecord rec;
        if (!read_index_record(lines.index, lines.indexed - 1, rec)) {
            lines.error = "cannot read log.index";
            return lines;
        }
        end = rec.offset + rec.length;
    }
    std::uint64_t log_bytes = std::filesystem::file_size(log_path, ec);
    if (ec) log_bytes = 0;
    if (log_bytes > end) {
        lines.log.clear();
        lines.log.seekg(static_cast<std::streamoff>(end));
        std::ostringstream rest;
        rest << lines.log.rdbuf();
        lines.tail = parse_line_set(rest.str());
        for (const ParsedLine& parsed : lines.tail) {
            if (!parsed.error.empty()) {
                lines.error = parsed.error;
                return lines;
            }
        }
    }
    return lines;
}

Scan scan(const std::string& text) {
    Scan s;
    std::size_t begin = 0;
    while (begin < text.size()) {
        std::size_t nl = text.find('\n', begin);
        if (nl == std::string::npos) break;
        s.index += record(begin, static_cast<std::uint32_t>(nl + 1 - begin));
        s.lines.push_back(text.substr(begin, nl - begin));
        begin = nl + 1;
    }
    if (!s.lines.empty()) {
        auto last = json::parse(s.lines.back());
        if (last) {
            if (const json::Value* v = last->find("seq")) s.seq = static_cast<std::uint64_t>(v->as_number());
            if (const json::Value* v = last->find("mono")) s.mono = v->as_number();
        }
    }
    return s;
}

}

RunLog::RunLog(std::filesystem::path dir, std::uint64_t next_seq) : dir_(std::move(dir)), next_seq_(next_seq) {}

deoxidene::Result<RunLog, std::string> RunLog::open(std::filesystem::path run_dir) {
    std::error_code ec;
    std::filesystem::create_directories(run_dir, ec);
    if (ec) return deoxidene::Err<std::string>{"cannot create " + run_dir.string() + ": " + ec.message()};
    auto file = run_dir / "log.jsonl";
    auto index_file = run_dir / "log.index";
    std::string text;
    if (std::filesystem::exists(file)) {
        if (!read_text(file, text)) return deoxidene::Err<std::string>{"cannot read " + file.string()};
    } else if (!append_bytes(file, "")) {
        return deoxidene::Err<std::string>{"cannot create " + file.string()};
    }
    Scan s = scan(text);
    std::string existing;
    read_text(index_file, existing);
    if (existing != s.index) {
        std::ofstream out(index_file, std::ios::binary | std::ios::trunc);
        out.write(s.index.data(), static_cast<std::streamsize>(s.index.size()));
        if (!out) return deoxidene::Err<std::string>{"cannot write " + index_file.string()};
    }
    RunLog log(std::move(run_dir), s.seq + 1);
    log.mono_base_ = s.mono;
    return log;
}

double RunLog::now_ms() const {
    using namespace std::chrono;
    return round_millis(mono_base_ + duration<double, std::milli>(steady_clock::now() - opened_).count());
}

std::uint64_t RunLog::append(std::string_view kind, json::Value fields) {
    std::lock_guard<std::mutex> guard(*lock_);
    double mono = now_ms();
    std::uint64_t seq = next_seq_++;
    json::Value safe = redact_value(fields);
    json::Value event = json::Object{};
    event.set("seq", seq).set("t", iso_now()).set("mono", mono).set("inFlight", 0).set("kind", std::string(kind));
    for (const json::Member& m : safe.as_object()) event.set(m.first, m.second);
    if (const json::Value* start = safe.find("startMono"); start && start->is_number()) {
        event.set("durMs", round_millis(mono - start->as_number()));
    }
    std::string line = json::dump(event) + "\n";
    auto file = dir_ / "log.jsonl";
    std::error_code ec;
    std::uint64_t size = std::filesystem::exists(file, ec) ? std::filesystem::file_size(file, ec) : 0;
    append_bytes(file, line);
    append_bytes(dir_ / "log.index", record(size, static_cast<std::uint32_t>(line.size())));
    return seq;
}

std::uint64_t RunLog::count() const {
    std::lock_guard<std::mutex> guard(*lock_);
    return next_seq_ - 1;
}

deoxidene::Result<std::vector<json::Value>, std::string> RunLog::read_all() const {
    std::lock_guard<std::mutex> guard(*lock_);
    std::string text;
    auto file = dir_ / "log.jsonl";
    if (!read_text(file, text)) return deoxidene::Err<std::string>{"cannot read " + file.string()};
    return parse_lines(text);
}

deoxidene::Result<std::vector<json::Value>, std::string> RunLog::read_from(std::uint64_t after_seq) const {
    std::lock_guard<std::mutex> guard(*lock_);
    if (after_seq + 1 >= next_seq_) return std::vector<json::Value>{};
    std::ifstream index(dir_ / "log.index", std::ios::binary);
    char rec[8];
    index.seekg(static_cast<std::streamoff>(after_seq * kRecordBytes));
    if (!index.read(rec, 8)) return deoxidene::Err<std::string>{"cannot read log.index"};
    std::uint64_t bits = 0;
    for (std::size_t i = 0; i < 8; ++i) bits |= static_cast<std::uint64_t>(static_cast<unsigned char>(rec[i])) << (8 * i);
    double offset;
    std::memcpy(&offset, &bits, sizeof offset);
    std::ifstream in(dir_ / "log.jsonl", std::ios::binary);
    in.seekg(static_cast<std::streamoff>(offset));
    std::ostringstream ss;
    ss << in.rdbuf();
    return parse_lines(ss.str());
}

deoxidene::Result<LogWindow, std::string> RunLog::read_window(std::uint64_t after_seq, std::size_t max_events, std::size_t max_bytes, LogMatch match) const {
    std::lock_guard<std::mutex> guard(*lock_);
    LogWindow window;
    window.scanned_last = after_seq;
    window.count = next_seq_ - 1;
    LineSet lines = open_lines(dir_, next_seq_);
    if (!lines.error.empty()) return deoxidene::Err<std::string>{lines.error};
    std::uint64_t total = lines.size();
    if (after_seq == std::numeric_limits<std::uint64_t>::max() || after_seq >= total || max_events == 0) return window;
    for (std::uint64_t seq = after_seq + 1; seq <= total && window.events.size() < max_events; ++seq) {
        if (window.bytes_read >= max_bytes && window.scanned_last != after_seq) break;
        ParsedLine parsed = lines.at(seq);
        if (!parsed.error.empty()) return deoxidene::Err<std::string>{parsed.error};
        if (!parsed.event) continue;
        const json::Value& event = *parsed.event;
        std::uint64_t event_seq = seq_field(event);
        if (event_seq <= after_seq) continue;
        window.bytes_read += json::dump(event).size() + 1;
        window.scanned_last = event_seq;
        if (!match || match(event)) window.events.push_back(event);
    }
    return window;
}

deoxidene::Result<std::vector<json::Value>, std::string> RunLog::read_last(std::size_t n, std::uint64_t after_seq, LogMatch match) const {
    std::lock_guard<std::mutex> guard(*lock_);
    LineSet lines = open_lines(dir_, next_seq_);
    if (!lines.error.empty()) return deoxidene::Err<std::string>{lines.error};
    std::vector<json::Value> newest;
    if (n == 0) return newest;
    for (std::uint64_t seq = lines.size(); seq > 0 && newest.size() < n; --seq) {
        ParsedLine parsed = lines.at(seq);
        if (!parsed.error.empty()) return deoxidene::Err<std::string>{parsed.error};
        if (!parsed.event) continue;
        const json::Value& event = *parsed.event;
        if (seq_field(event) <= after_seq) break;
        if (!match || match(event)) newest.push_back(event);
    }
    std::reverse(newest.begin(), newest.end());
    return newest;
}

}
