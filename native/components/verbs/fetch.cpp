#include <algorithm>
#include <cctype>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <future>
#include <memory>
#include <fstream>
#include <map>
#include <random>
#include <regex>
#include <sstream>
#include <string>
#include <system_error>
#include <thread>

#include "core_internal.hpp"
#include "gm/proc.hpp"

namespace gm::core {
namespace {

namespace fs = std::filesystem;

constexpr std::uint64_t kDefaultTimeoutMs = 15000;
constexpr std::uint64_t kMaxTimeoutMs = 60000;
constexpr std::uint64_t kMaxBodyBytes = 16777216;
constexpr std::size_t kMaxMatchChars = 4096;
constexpr int kRetries = 3;
constexpr double kBaseMs = 1000;
constexpr double kCapMs = 16000;
constexpr double kJitter = 0.2;
const std::string kMark = "\n--gm-fetch-meta--";

const std::map<int, std::string> kCurlCodes{{6, "ENOTFOUND"}, {7, "ECONNREFUSED"}, {28, "ETIMEDOUT"}, {35, "ECONNRESET"}, {52, "ECONNRESET"}, {56, "ECONNRESET"}};
const std::vector<std::string> kTransient{"ECONNRESET", "ECONNREFUSED", "ECONNABORTED", "ETIMEDOUT", "EAI_AGAIN"};

std::size_t utf8_length(std::string_view text) { return text.size(); }

std::string take_utf8(std::string_view text, std::size_t max_bytes) {
    if (text.size() <= max_bytes) return std::string(text);
    std::size_t cut = max_bytes;
    while (cut > 0 && (static_cast<unsigned char>(text[cut]) & 0xC0) == 0x80) --cut;
    return std::string(text.substr(0, cut));
}

std::uint32_t next_code_point(std::string_view text, std::size_t& at) {
    const auto lead = static_cast<unsigned char>(text[at]);
    std::size_t size = lead < 0x80 ? 1 : lead < 0xE0 ? 2 : lead < 0xF0 ? 3 : 4;
    std::uint32_t code = size == 1 ? lead : size == 2 ? lead & 0x1F : size == 3 ? lead & 0x0F : lead & 0x07;
    for (std::size_t i = 1; i < size && at + i < text.size(); ++i) code = (code << 6) | (static_cast<unsigned char>(text[at + i]) & 0x3F);
    at += size;
    return code;
}

std::string ascii_escape(std::string_view text) {
    std::string out;
    std::size_t at = 0;
    char buf[8];
    while (at < text.size()) {
        const std::uint32_t code = next_code_point(text, at);
        if (code < 0x80) {
            out += static_cast<char>(code);
            continue;
        }
        const std::uint32_t units[2] = {code >= 0x10000 ? 0xD800 + ((code - 0x10000) >> 10) : code, code >= 0x10000 ? 0xDC00 + ((code - 0x10000) & 0x3FF) : 0};
        for (std::size_t i = 0; i < (code >= 0x10000 ? 2u : 1u); ++i) {
            std::snprintf(buf, sizeof(buf), "\\u%04x", units[i]);
            out += buf;
        }
    }
    return out;
}

std::string utf8_encode(std::uint32_t code) {
    std::string out;
    if (code < 0x80) {
        out += static_cast<char>(code);
    } else if (code < 0x800) {
        out += static_cast<char>(0xC0 | (code >> 6));
        out += static_cast<char>(0x80 | (code & 0x3F));
    } else if (code < 0x10000) {
        out += static_cast<char>(0xE0 | (code >> 12));
        out += static_cast<char>(0x80 | ((code >> 6) & 0x3F));
        out += static_cast<char>(0x80 | (code & 0x3F));
    } else {
        out += static_cast<char>(0xF0 | (code >> 18));
        out += static_cast<char>(0x80 | ((code >> 12) & 0x3F));
        out += static_cast<char>(0x80 | ((code >> 6) & 0x3F));
        out += static_cast<char>(0x80 | (code & 0x3F));
    }
    return out;
}

std::string sha256_hex(std::string_view text) {
    static const std::uint32_t k[64] = {
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2};
    std::uint32_t state[8] = {0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19};
    std::string bytes(text);
    const std::uint64_t bit_length = static_cast<std::uint64_t>(bytes.size()) * 8;
    bytes += static_cast<char>(0x80);
    while (bytes.size() % 64 != 56) bytes += static_cast<char>(0);
    for (int shift = 56; shift >= 0; shift -= 8) bytes += static_cast<char>((bit_length >> shift) & 0xFF);
    auto rotr = [](std::uint32_t x, int n) { return (x >> n) | (x << (32 - n)); };
    for (std::size_t at = 0; at < bytes.size(); at += 64) {
        std::uint32_t w[64];
        for (int t = 0; t < 16; ++t) {
            const auto* p = reinterpret_cast<const unsigned char*>(bytes.data() + at + 4 * t);
            w[t] = (static_cast<std::uint32_t>(p[0]) << 24) | (static_cast<std::uint32_t>(p[1]) << 16) | (static_cast<std::uint32_t>(p[2]) << 8) | p[3];
        }
        for (int t = 16; t < 64; ++t) {
            const std::uint32_t s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >> 3);
            const std::uint32_t s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >> 10);
            w[t] = w[t - 16] + s0 + w[t - 7] + s1;
        }
        std::uint32_t a = state[0], b = state[1], c = state[2], d = state[3], e = state[4], f = state[5], g = state[6], h = state[7];
        for (int t = 0; t < 64; ++t) {
            const std::uint32_t t1 = h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + k[t] + w[t];
            const std::uint32_t t2 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c));
            h = g; g = f; f = e; e = d + t1; d = c; c = b; b = a; a = t1 + t2;
        }
        const std::uint32_t add[8] = {a, b, c, d, e, f, g, h};
        for (int i = 0; i < 8; ++i) state[i] += add[i];
    }
    char out[65];
    for (int i = 0; i < 8; ++i) std::snprintf(out + 8 * i, 9, "%08x", state[i]);
    return std::string(out, 64);
}

std::string decode_entity(const std::string& code, const std::string& match) {
    static const std::map<std::string, std::string> named{{"amp", "&"}, {"lt", "<"}, {"gt", ">"}, {"quot", "\""}, {"apos", "'"}, {"nbsp", " "}};
    if (!code.empty() && code[0] == '#') {
        const bool hex = code.size() > 1 && (code[1] == 'x' || code[1] == 'X');
        const std::string digits = code.substr(hex ? 2 : 1);
        const unsigned long long value = std::strtoull(digits.c_str(), nullptr, hex ? 16 : 10);
        return value <= 0x10FFFF ? utf8_encode(static_cast<std::uint32_t>(value)) : match;
    }
    std::string lower = code;
    std::transform(lower.begin(), lower.end(), lower.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    const auto found = named.find(lower);
    return found == named.end() ? match : found->second;
}

std::string html_to_text(const std::string& html) {
    static const std::regex comment(R"(<!--[\s\S]*?-->)");
    static const std::regex hidden(R"(<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>)", std::regex::icase);
    static const std::regex block(R"(<\/?(p|div|br|li|tr|h[1-6]|section|article|header|footer|table|ul|ol|pre|blockquote)\b[^>]*>)", std::regex::icase);
    static const std::regex tag(R"(<[^>]+>)");
    static const std::regex entity(R"(&(#x[0-9a-f]+|#\d+|[a-z]+);)", std::regex::icase);
    static const std::regex spaces(R"(\s+)");
    std::string text = std::regex_replace(html, comment, " ");
    text = std::regex_replace(text, hidden, " ");
    text = std::regex_replace(text, block, "\n");
    text = std::regex_replace(text, tag, " ");
    std::string decoded;
    std::sregex_iterator at(text.begin(), text.end(), entity), end;
    std::size_t last = 0;
    for (; at != end; ++at) {
        decoded += text.substr(last, at->position() - last);
        decoded += decode_entity((*at)[1].str(), at->str());
        last = at->position() + at->length();
    }
    decoded += text.substr(last);
    std::string out;
    std::istringstream lines(decoded);
    for (std::string line; std::getline(lines, line);) {
        line = std::regex_replace(line, spaces, " ");
        const auto first = line.find_first_not_of(' ');
        if (first == std::string::npos) continue;
        if (!out.empty()) out += "\n";
        out += line.substr(first, line.find_last_not_of(' ') - first + 1);
    }
    return out;
}

struct Parsed {
    int status = 0;
    std::map<std::string, std::string> headers;
    std::string body;
};

Parsed parse_headers(std::string text) {
    static const std::regex blank(R"(\r?\n\r?\n)");
    Parsed parsed;
    while (text.rfind("HTTP/", 0) == 0) {
        std::smatch end;
        const bool found = std::regex_search(text, end, blank);
        const std::string block = found ? text.substr(0, end.position()) : text;
        text = found ? text.substr(end.position() + end.length()) : std::string();
        std::istringstream lines(block);
        std::string status_line;
        std::getline(lines, status_line);
        if (!status_line.empty() && status_line.back() == '\r') status_line.pop_back();
        std::istringstream words(status_line);
        std::string skip;
        words >> skip;
        words >> skip;
        parsed.status = std::atoi(skip.c_str());
        parsed.headers.clear();
        for (std::string line; std::getline(lines, line);) {
            if (!line.empty() && line.back() == '\r') line.pop_back();
            const auto at = line.find(':');
            if (at == std::string::npos || at < 1) continue;
            std::string name = line.substr(0, at);
            std::transform(name.begin(), name.end(), name.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
            std::string value = line.substr(at + 1);
            const auto first = value.find_first_not_of(" \t");
            value = first == std::string::npos ? "" : value.substr(first, value.find_last_not_of(" \t") - first + 1);
            const auto existing = parsed.headers.find(name);
            parsed.headers[name] = existing == parsed.headers.end() ? value : existing->second + ", " + value;
        }
    }
    parsed.body = text;
    return parsed;
}

struct Archive {
    std::string id;
    bool created = false;
};

Archive archive_source(const fs::path& workspace, const std::string& body, const std::string& url) {
    const std::string stored = ascii_escape(body);
    const std::string id = sha256_hex(stored).substr(0, 12);
    const fs::path file = workspace / "sources" / (id + ".txt");
    Archive archive{id, false};
    std::error_code ec;
    if (!fs::exists(file, ec)) {
        archive.created = true;
        fs::create_directories(file.parent_path(), ec);
        write_text(file, stored);
    }
    const fs::path registry = workspace / "sources" / "index.jsonl";
    const std::string line = "{\"url\":" + json::dump(json::Value(url)) + ",\"id\":\"" + id + "\",\"at\":\"" + iso_now() + "\"}\n";
    const auto previous = read_text(registry, "open");
    write_text(registry, (previous.ok ? previous.text : std::string()) + line);
    return archive;
}

std::string redact(std::string value) {
    static const std::vector<std::pair<std::regex, std::string>> patterns = {
        {std::regex(R"(Bearer\s+[^\s]+)", std::regex::icase), "Bearer [redacted]"},
        {std::regex(R"(access_token=[^\s&]+)", std::regex::icase), "access_token=[redacted]"},
        {std::regex(R"(refresh_token=[^\s&]+)", std::regex::icase), "refresh_token=[redacted]"},
        {std::regex(R"(api_key=[^\s&]+)", std::regex::icase), "api_key=[redacted]"},
        {std::regex(R"(password=[^\s&]+)", std::regex::icase), "password=[redacted]"},
    };
    for (const auto& [pattern, replacement] : patterns) value = std::regex_replace(value, pattern, replacement);
    return value;
}

json::Value store_artifact(const fs::path& run_dir, const std::string& value) {
    const std::string clean = redact(value);
    const std::string bounded = clean.size() > 20000 ? take_utf8(clean, 10000) + "\n[gm: middle omitted]\n" + clean.substr(clean.size() - 10000) : clean;
    const std::string digest = sha256_hex(bounded).substr(0, 12);
    const fs::path path = run_dir / "outputs" / (digest + "-fetch.txt");
    write_text(path, bounded);
    const std::string notice = "[gm: full output at " + path.string() + "; page with gm.read_file({ path: " + json::dump(json::Value(path.string())) + ", unit: \"chars\", offset: 0, limit: 20000 })]";
    json::Value out;
    out.set("outputPath", path.string());
    out.set("totalChars", static_cast<std::uint64_t>(utf16_length(clean)));
    out.set("totalBytes", static_cast<std::uint64_t>(utf8_length(clean)));
    out.set("digest", digest);
    out.set("offset", static_cast<std::uint64_t>(0));
    out.set("next", static_cast<std::uint64_t>(0));
    out.set("truncated", true);
    out.set("notice", notice);
    return out;
}

std::string shown_text(const std::string& text, const json::Value& args) {
    std::string shown = text;
    if (const json::Value* match = args.find("match"); match != nullptr && match->is_string()) {
        const std::regex pattern(match->as_string());
        std::string kept;
        std::istringstream lines(text);
        for (std::string line; std::getline(lines, line);)
            if (std::regex_search(line, pattern)) kept += (kept.empty() ? "" : "\n") + line;
        shown = kept;
    }
    const json::Value* max = args.find("maxBytes");
    if (max == nullptr || !max->is_number()) return shown;
    const auto limit = static_cast<std::size_t>(max->as_number());
    if (utf8_length(shown) <= limit) return shown;
    const std::string kept = take_utf8(shown, limit);
    return kept + (kept.empty() || kept.back() == '\n' ? "" : "\n") + "[gm-fetch: body truncated to " + std::to_string(utf8_length(kept)) + " bytes of " + std::to_string(utf8_length(shown)) + " bytes]";
}

std::optional<std::string> shown_before(const std::string& text, const json::Value& args, std::chrono::steady_clock::time_point deadline) {
    if (args.find("match") == nullptr) return shown_text(text, args);
    auto task = std::make_shared<std::packaged_task<std::string()>>([text, args] { return shown_text(text, args); });
    std::future<std::string> done = task->get_future();
    std::thread([task] { (*task)(); }).detach();
    if (done.wait_until(deadline) != std::future_status::ready) return std::nullopt;
    return done.get();
}

bool capped(const std::string& text, const json::Value& args) {
    const json::Value* max = args.find("maxBytes");
    return max != nullptr && max->is_number() && utf8_length(text) > static_cast<std::size_t>(max->as_number());
}

json::Value timed_out(std::uint64_t timeout_ms) {
    json::Value reply;
    reply.set("ok", false);
    reply.set("error", "timed out after " + std::to_string(timeout_ms) + " ms");
    reply.set("code", "ETIMEDOUT");
    return reply;
}

json::Value error_of(std::string message, const std::string& code = "") {
    json::Value reply;
    reply.set("ok", false);
    reply.set("error", std::move(message));
    if (!code.empty()) reply.set("code", code);
    return reply;
}

std::string percent_decode(const std::string& raw, bool& valid) {
    std::string out;
    valid = true;
    for (std::size_t i = 0; i < raw.size(); ++i) {
        if (raw[i] == '+') {
            out += ' ';
        } else if (raw[i] == '%') {
            if (i + 2 >= raw.size() || !std::isxdigit(static_cast<unsigned char>(raw[i + 1])) || !std::isxdigit(static_cast<unsigned char>(raw[i + 2]))) {
                valid = false;
                return out;
            }
            out += static_cast<char>(std::stoi(raw.substr(i + 1, 2), nullptr, 16));
            i += 2;
        } else {
            out += raw[i];
        }
    }
    return out;
}

json::Value get_data_url(const std::string& url, const json::Value& args, std::uint64_t timeout_ms, std::chrono::steady_clock::time_point deadline) {
    const auto comma = url.find(',');
    if (comma == std::string::npos || comma < 5) return error_of("url is not a valid URL");
    const std::string meta = url.substr(5, comma - 5);
    if (std::regex_search(meta, std::regex(";base64", std::regex::icase))) return error_of("base64 data URLs are not supported");
    bool valid = true;
    const std::string body = percent_decode(url.substr(comma + 1), valid);
    if (!valid) return error_of("url is not a valid URL");
    const std::string type = meta.substr(0, meta.find(';')).empty() ? "text/plain" : meta.substr(0, meta.find(';'));
    const std::string text = type.rfind("text/", 0) == 0 ? body : "(binary content not shown: " + type + ")";
    const auto shown = shown_before(text, args, deadline);
    if (!shown) return timed_out(timeout_ms);
    const std::string full = "200 " + std::to_string(utf8_length(body)) + " bytes " + url + "\n" + *shown;
    json::Value reply;
    reply.set("ok", true);
    reply.set("status", 200);
    reply.set("bytes", static_cast<std::uint64_t>(utf8_length(body)));
    reply.set("finalUrl", url);
    reply.set("redirects", 0);
    reply.set("source", "");
    reply.set("sourceNew", false);
    reply.set("output", full);
    return reply;
}

json::Value get_http(const fs::path& workspace, const fs::path& run_dir, const std::string& url, const json::Value& args, std::uint64_t timeout_ms, std::chrono::steady_clock::time_point deadline) {
    const auto left = std::chrono::duration_cast<std::chrono::milliseconds>(deadline - std::chrono::steady_clock::now()).count();
    if (left < 1) return timed_out(timeout_ms);
    char max_time[32];
    std::snprintf(max_time, sizeof(max_time), "%.3f", static_cast<double>(left) / 1000.0);
    const auto outcome = proc::run({"curl", "-sS", "-L", "-i", "--proto", "=http,https", "--proto-redir", "=http,https", "--max-time", max_time, "--max-filesize", std::to_string(kMaxBodyBytes), "-A", "gm-fetch/1", "-H", "accept: text/html,text/plain;q=0.9,*/*;q=0.5", "-w", kMark + "%{url_effective}\n%{num_redirects}", "--url", url}, workspace, {}, static_cast<std::uint64_t>(left) + 5000);
    if (!outcome.started) return error_of("request failed: could not start curl");
    if (outcome.timed_out || outcome.exit_code == 28) return timed_out(timeout_ms);
    if (outcome.exit_code == 1 || outcome.exit_code == 3) return error_of("request failed: fetch failed");
    if (outcome.exit_code != 0) {
        const auto found = kCurlCodes.find(outcome.exit_code);
        const std::string code = found == kCurlCodes.end() ? "" : found->second;
        std::string detail = outcome.err;
        while (!detail.empty() && std::isspace(static_cast<unsigned char>(detail.back()))) detail.pop_back();
        return error_of("request failed: " + (code.empty() ? (detail.empty() ? "curl exited " + std::to_string(outcome.exit_code) : detail) : code), code);
    }
    const auto mark_at = outcome.out.rfind(kMark);
    const std::string meta = outcome.out.substr(mark_at + kMark.size());
    const auto newline = meta.find('\n');
    const std::string final_url = meta.substr(0, newline);
    const int redirects = std::atoi(newline == std::string::npos ? "0" : meta.substr(newline + 1).c_str());
    const Parsed parsed = parse_headers(outcome.out.substr(0, mark_at));
    const auto type_found = parsed.headers.find("content-type");
    const std::string type = type_found == parsed.headers.end() ? "" : type_found->second;
    std::string text;
    if (type.find("text/html") != std::string::npos || type.find("application/xhtml") != std::string::npos) text = html_to_text(parsed.body);
    else if (type.empty() || type.rfind("text/", 0) == 0 || type.find("json") != std::string::npos || type.find("xml") != std::string::npos || type.find("javascript") != std::string::npos) text = parsed.body;
    else text = "(binary content not shown: " + type + ")";
    const Archive archived = archive_source(workspace, parsed.body, final_url);
    const auto shown = shown_before(text, args, deadline);
    if (!shown) return timed_out(timeout_ms);
    const std::string full = std::to_string(parsed.status) + " " + std::to_string(utf8_length(parsed.body)) + " bytes " + final_url + "\n" + *shown;
    json::Value reply;
    reply.set("ok", parsed.status >= 200 && parsed.status < 300);
    reply.set("status", parsed.status);
    reply.set("bytes", static_cast<std::uint64_t>(utf8_length(parsed.body)));
    reply.set("finalUrl", final_url);
    reply.set("redirects", redirects);
    reply.set("source", archived.id);
    reply.set("sourceNew", archived.created);
    if (!capped(text, args)) {
        reply.set("output", full);
        return reply;
    }
    const json::Value artifact = store_artifact(run_dir, full);
    reply.set("output", full + "\n" + artifact.find("notice")->as_string());
    for (const auto& member : artifact.as_object()) reply.set(member.first, member.second);
    return reply;
}

std::optional<std::string> status_type(int status) {
    if (status == 408 || status == 429 || (status >= 500 && status <= 599)) return "HTTP-" + std::to_string(status);
    return std::nullopt;
}

std::optional<std::string> classify(const json::Value& result) {
    if (const json::Value* status = result.find("status"); status != nullptr && status->is_number()) return status_type(static_cast<int>(status->as_number()));
    const json::Value* code = result.find("code");
    if (code == nullptr || !code->is_string()) return std::nullopt;
    if (std::find(kTransient.begin(), kTransient.end(), code->as_string()) != kTransient.end()) return code->as_string();
    return std::nullopt;
}

double backoff_ms(int attempt) {
    static std::mt19937 engine{std::random_device{}()};
    const double base = std::min(kBaseMs * static_cast<double>(1ull << (attempt - 1)), kCapMs);
    std::uniform_real_distribution<double> jitter(-1.0, 1.0);
    return std::round(base * (1 + kJitter * jitter(engine)));
}

}

json::Value fetch_call(const json::Value& args, const fs::path& workspace, LockedLog& log, const fs::path& run_dir) {
    const json::Value* url_value = args.find("url");
    if (url_value == nullptr || !url_value->is_string()) return error_of("url must be a string");
    const std::string url = url_value->as_string();
    std::uint64_t timeout_ms = kDefaultTimeoutMs;
    if (const json::Value* t = args.find("timeoutMs"); t != nullptr && !t->is_null()) {
        if (!t->is_number() || t->as_number() != static_cast<double>(static_cast<std::uint64_t>(t->as_number())) || t->as_number() < 1 || t->as_number() > static_cast<double>(kMaxTimeoutMs))
            return error_of("timeoutMs must be an integer from 1 to " + std::to_string(kMaxTimeoutMs));
        timeout_ms = static_cast<std::uint64_t>(t->as_number());
    }
    if (const json::Value* max = args.find("maxBytes"); max != nullptr && !max->is_null()) {
        if (!max->is_number() || max->as_number() < 0 || max->as_number() > static_cast<double>(kMaxBodyBytes) || max->as_number() != static_cast<double>(static_cast<std::uint64_t>(max->as_number())))
            return error_of("maxBytes must be an integer from 0 to " + std::to_string(kMaxBodyBytes));
    }
    if (const json::Value* match = args.find("match"); match != nullptr && !match->is_null()) {
        if (!match->is_string() || match->as_string().size() > kMaxMatchChars) return error_of("match must be a string of at most " + std::to_string(kMaxMatchChars) + " characters");
        try {
            std::regex check(match->as_string());
        } catch (const std::regex_error& error) {
            return error_of(std::string("match is not a valid regular expression: ") + error.what());
        }
    }
    std::string scheme = url.substr(0, 5);
    std::transform(scheme.begin(), scheme.end(), scheme.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    const bool data = scheme == "data:";
    if (!data && !std::regex_match(url, std::regex(R"(^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/?\S+$)"))) return error_of("url is not a valid URL");
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(timeout_ms);
    int attempt = 0;
    for (;;) {
        ++attempt;
        json::Value result = data ? get_data_url(url, args, timeout_ms, deadline) : get_http(workspace, run_dir, url, args, timeout_ms, deadline);
        const auto error_type = classify(result);
        if (!error_type) {
            result.set("attempts", attempt);
            return result;
        }
        if (attempt > kRetries) {
            result.set("attempts", attempt);
            result.set("exhausted", true);
            return result;
        }
        const double delay = backoff_ms(attempt);
        if (std::chrono::steady_clock::now() + std::chrono::milliseconds(static_cast<std::int64_t>(delay)) >= deadline) {
            result.set("attempts", attempt);
            result.set("exhausted", true);
            return result;
        }
        json::Value fields;
        fields.set("tool", "fetch");
        fields.set("attempt", attempt);
        fields.set("errorType", *error_type);
        fields.set("delayMs", delay);
        log.append("retry", std::move(fields));
        std::this_thread::sleep_for(std::chrono::milliseconds(static_cast<std::int64_t>(delay)));
    }
}

}
