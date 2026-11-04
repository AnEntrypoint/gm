#include "gmnew/log.hpp"

#include <cmath>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <sstream>
#include <system_error>

namespace gmnew {

namespace {

constexpr std::size_t kRecordBytes = 16;

double round_millis(double ms) { return std::round(ms * 1000) / 1000; }

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

}  // namespace

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

double RunLog::now() const {
    using namespace std::chrono;
    return round_millis(mono_base_ + duration<double, std::milli>(steady_clock::now() - opened_).count());
}

std::uint64_t RunLog::append(std::string_view kind, json::Value fields) {
    std::lock_guard<std::mutex> guard(*lock_);
    double mono = now();
    std::uint64_t seq = next_seq_++;
    json::Value event = json::Object{};
    event.set("seq", seq).set("t", iso_now()).set("mono", mono).set("inFlight", 0).set("kind", std::string(kind));
    for (const json::Member& m : fields.as_object()) event.set(m.first, m.second);
    if (const json::Value* start = fields.find("startMono"); start && start->is_number()) {
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

namespace {

deoxidene::Result<std::vector<json::Value>, std::string> parse_lines(const std::string& text) {
    std::vector<json::Value> events;
    std::size_t begin = 0;
    while (begin < text.size()) {
        std::size_t nl = text.find('\n', begin);
        std::size_t end = nl == std::string::npos ? text.size() : nl;
        std::string_view line(text.data() + begin, end - begin);
        begin = end + 1;
        if (line.find_first_not_of(" \t\r") == std::string_view::npos) continue;
        auto event = json::parse(line);
        if (!event) return deoxidene::Err<std::string>{event.error()};
        events.push_back(std::move(*event));
    }
    return events;
}

}  // namespace

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

}  // namespace gmnew
