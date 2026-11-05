#include <algorithm>
#include <chrono>
#include <cstdio>
#include <fstream>
#include <optional>
#include <regex>
#include <sstream>

#include "gm/mcp.hpp"
#include "internal.hpp"

namespace gm::mcp::detail {

namespace {

bool is_space(char c) { return c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\f' || c == '\v'; }

std::string iso_of(std::chrono::system_clock::time_point when) {
    using namespace std::chrono;
    auto ms_point = time_point_cast<milliseconds>(when);
    auto day = floor<days>(ms_point);
    year_month_day ymd{day};
    auto ms = duration_cast<milliseconds>(ms_point - day).count();
    char buf[40];
    std::snprintf(buf, sizeof buf, "%04d-%02u-%02uT%02d:%02d:%02d.%03dZ", static_cast<int>(ymd.year()),
                  static_cast<unsigned>(ymd.month()), static_cast<unsigned>(ymd.day()), static_cast<int>(ms / 3600000),
                  static_cast<int>(ms / 60000 % 60), static_cast<int>(ms / 1000 % 60), static_cast<int>(ms % 1000));
    return buf;
}

void files_under(const std::filesystem::path& dir, const std::string& rel, std::vector<std::string>& out) {
    for (const auto& entry : std::filesystem::directory_iterator(rel.empty() ? dir : dir / rel)) {
        std::string name = entry.path().filename().string();
        std::string path = rel.empty() ? name : rel + "/" + name;
        if (entry.is_directory()) files_under(dir, path, out);
        else if (entry.is_regular_file()) out.push_back(path);
    }
}

std::optional<std::string> plain_problem(const std::string& value) {
    static constexpr std::string_view kSyntax = "-?:,[]{}#&*!|>'\"%@`";
    if (!value.empty() && kSyntax.find(value[0]) != std::string_view::npos) {
        return "starts with a character YAML reads as syntax";
    }
    if (value.find(": ") != std::string::npos || (!value.empty() && value.back() == ':')) {
        return "has ': ' inside it, which YAML reads as a mapping";
    }
    if (value.find(" #") != std::string::npos) return "has ' #' inside it, which YAML reads as a comment";
    return std::nullopt;
}

bool is_key_start(char c) { return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z'); }
bool is_key_char(char c) { return is_key_start(c) || (c >= '0' && c <= '9') || c == '_' || c == '-'; }

deoxidene::Result<std::pair<Value, std::string>, std::string> parse_skill(const std::string& raw, const std::string& dir) {
    using Fail = deoxidene::Err<std::string>;
    std::string prefix = "skills/" + dir + "/SKILL.md";
    std::string text;
    text.reserve(raw.size());
    for (char c : raw) {
        if (c != '\r') text.push_back(c);
    }
    std::size_t close = text.rfind("---\n", 0) == 0 ? text.find("\n---", 4) : std::string::npos;
    if (close == std::string::npos) return Fail{prefix + " has no frontmatter"};
    std::size_t end = close + 4;
    if (end < text.size() && text[end] == '\n') end += 1;
    std::string block = text.substr(4, close >= 4 ? close - 4 : 0);
    Value frontmatter = object();
    std::size_t at = 0;
    while (true) {
        std::size_t nl = block.find('\n', at);
        std::string line = block.substr(at, nl == std::string::npos ? std::string::npos : nl - at);
        std::size_t i = 0;
        bool ok = !line.empty() && is_key_start(line[0]);
        if (ok) {
            while (i < line.size() && is_key_char(line[i])) ++i;
            ok = i < line.size() && line[i] == ':' && i + 1 < line.size() && is_space(line[i + 1]);
        }
        if (!ok) return Fail{prefix + ": frontmatter line is not key: value: " + line.substr(0, 40)};
        std::string key = line.substr(0, i);
        std::size_t v = i + 1;
        while (v < line.size() && is_space(line[v])) ++v;
        std::string value = line.substr(v);
        if (auto problem = plain_problem(value)) return Fail{prefix + ": " + key + " " + *problem + "; reword it"};
        frontmatter.set(key, value);
        if (nl == std::string::npos) break;
        at = nl + 1;
    }
    for (const char* key : {"name", "description"}) {
        const Value* field = frontmatter.find(key);
        if (field == nullptr || trim(field->as_string()).empty()) return Fail{prefix + " has no " + key};
    }
    const std::string& name = frontmatter.find("name")->as_string();
    if (name != dir) {
        return Fail{prefix + ": name is " + name + ", and its URI ends in " + dir + "; they must match"};
    }
    return std::pair<Value, std::string>{std::move(frontmatter), trim(std::string_view(text).substr(end))};
}

}

std::size_t js_length(std::string_view utf8) {
    std::size_t units = 0;
    for (unsigned char c : utf8) {
        if ((c & 0xC0) != 0x80) units += 1;
        if ((c & 0xF8) == 0xF0) units += 1;
    }
    return units;
}

std::string js_prefix(std::string_view utf8, std::size_t units) {
    std::size_t taken = 0;
    std::size_t at = 0;
    while (at < utf8.size()) {
        unsigned char c = static_cast<unsigned char>(utf8[at]);
        std::size_t width = c < 0x80 ? 1 : (c & 0xE0) == 0xC0 ? 2 : (c & 0xF0) == 0xE0 ? 3 : 4;
        std::size_t cost = width == 4 ? 2 : 1;
        if (taken + cost > units) break;
        taken += cost;
        at += width;
    }
    return std::string(utf8.substr(0, std::min(at, utf8.size())));
}

std::string trim(std::string_view text) {
    std::size_t begin = 0;
    std::size_t end = text.size();
    while (begin < end && is_space(text[begin])) ++begin;
    while (end > begin && is_space(text[end - 1])) --end;
    return std::string(text.substr(begin, end - begin));
}

std::string iso_time(std::filesystem::file_time_type when) {
    using namespace std::chrono;
    return iso_of(system_clock::now() + duration_cast<system_clock::duration>(when - std::filesystem::file_time_type::clock::now()));
}

std::string iso_now() { return iso_of(std::chrono::system_clock::now()); }

bool read_file(const std::filesystem::path& file, std::string& out) {
    std::ifstream in(file, std::ios::binary);
    if (!in) return false;
    std::ostringstream ss;
    ss << in.rdbuf();
    out = ss.str();
    return true;
}

bool write_file(const std::filesystem::path& file, std::string_view bytes) {
    std::ofstream out(file, std::ios::binary | std::ios::trunc);
    if (!out) return false;
    out.write(bytes.data(), static_cast<std::streamsize>(bytes.size()));
    out.flush();
    return static_cast<bool>(out);
}

deoxidene::Result<Skill, std::string> read_skill(const std::filesystem::path& skills_dir, const std::string& name) {
    using Fail = deoxidene::Err<std::string>;
    std::filesystem::path dir = skills_dir / name;
    std::vector<std::string> paths;
    try {
        files_under(dir, "", paths);
    } catch (const std::filesystem::filesystem_error&) {
        return Fail{"ENOENT: no such file or directory, scandir '" + dir.string() + "'"};
    }
    std::sort(paths.begin(), paths.end());
    Skill skill;
    skill.name = name;
    for (const std::string& path : paths) {
        SkillFile file;
        file.path = path;
        file.uri = "skill://" + name + "/" + path;
        if (!read_file(dir / path, file.bytes)) return Fail{"cannot read " + (dir / path).string()};
        file.digest = "sha256:" + sha256_hex(file.bytes);
        file.size = file.bytes.size();
        file.mime_type = path.size() >= 3 && path.ends_with(".md") ? "text/markdown" : "text/plain";
        std::error_code ec;
        file.last_modified = iso_time(std::filesystem::last_write_time(dir / path, ec));
        skill.files.push_back(std::move(file));
    }
    auto skill_md = std::find_if(skill.files.begin(), skill.files.end(), [](const SkillFile& f) { return f.path == "SKILL.md"; });
    if (skill_md == skill.files.end()) return Fail{"skills/" + name + "/SKILL.md is missing"};
    auto parsed = parse_skill(skill_md->bytes, name);
    if (!parsed) return Fail{parsed.error()};
    skill.uri = skill_md->uri;
    skill.frontmatter = std::move(parsed->first);
    skill.body = std::move(parsed->second);
    return skill;
}

Skill SkillCache::get(const std::string& name) {
    auto fresh = read_skill(dir_, name);
    if (fresh) {
        last_[name] = std::move(*fresh);
        return last_[name];
    }
    auto kept = last_.find(name);
    if (kept == last_.end()) throw std::runtime_error(fresh.error());
    return kept->second;
}

}

namespace gm::mcp {

std::optional<std::string> served_skill_text(const std::filesystem::path& skills, const std::string& uri) {
    static const std::regex kSkillFileUri(R"(^skill://([^/]+)/.+$)");
    std::smatch match;
    if (!std::regex_match(uri, match, kSkillFileUri)) return std::nullopt;
    const auto& served = detail::served_skills();
    if (std::find(served.begin(), served.end(), match[1].str()) == served.end()) return std::nullopt;
    auto fresh = detail::read_skill(skills, match[1].str());
    if (!fresh) return std::nullopt;
    for (const detail::SkillFile& file : fresh->files) {
        if (file.uri == uri) return file.bytes;
    }
    return std::nullopt;
}

}
