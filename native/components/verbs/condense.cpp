#include "condense.hpp"

#include <algorithm>
#include <cctype>
#include <vector>

namespace gm::verbs {
namespace {

constexpr std::size_t kMinLines = 200;
constexpr std::size_t kMinChars = 16384;
constexpr std::size_t kMaxChars = 8000;
constexpr std::size_t kHeadLines = 20;
constexpr std::size_t kTailLines = 20;
constexpr std::size_t kMaxSignals = 40;

const char* const kSignals[] = {"error", "fail", "warn", "pass", "assert", "panic", "fatal", "traceback", "exception", "exit code", "##[error]"};

bool signal_line(const std::string& line) {
    std::string lower = line;
    for (char& c : lower) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    for (const char* word : kSignals) if (lower.find(word) != std::string::npos) return true;
    return false;
}

std::vector<std::string> split(const std::string& text) {
    std::vector<std::string> lines;
    std::size_t start = 0;
    while (start <= text.size()) {
        const std::size_t end = text.find('\n', start);
        std::string line = text.substr(start, end == std::string::npos ? std::string::npos : end - start);
        if (!line.empty() && line.back() == '\r') line.pop_back();
        lines.push_back(std::move(line));
        if (end == std::string::npos) break;
        start = end + 1;
    }
    return lines;
}

std::string strip_ansi(const std::string& text) {
    std::string out;
    out.reserve(text.size());
    for (std::size_t i = 0; i < text.size();) {
        if (text[i] == 0x1b && i + 1 < text.size() && text[i + 1] == '[') {
            std::size_t j = i + 2;
            while (j < text.size() && (std::isdigit(static_cast<unsigned char>(text[j])) || text[j] == ';' || text[j] == '?')) ++j;
            if (j < text.size()) { i = j + 1; continue; }
        }
        out.push_back(text[i++]);
    }
    return out;
}

}

std::optional<Condensed> condense_output(const std::string& text) {
    const std::size_t original = text.size();
    if (original <= kMinChars && split(text).size() <= kMinLines) return std::nullopt;
    const std::vector<std::string> raw = split(strip_ansi(text));
    std::vector<std::string> unique;
    std::string previous;
    std::size_t repeats = 0;
    bool have = false;
    const auto flush = [&]() {
        if (!have) return;
        unique.push_back(previous);
        if (repeats > 1) unique.push_back("[gm: repeated " + std::to_string(repeats) + " times]");
        previous.clear();
        repeats = 0;
        have = false;
    };
    for (const std::string& line : raw) {
        if (line.find_first_not_of(" \t") == std::string::npos) continue;
        if (have && line == previous) { ++repeats; continue; }
        flush();
        previous = line;
        repeats = 1;
        have = true;
    }
    flush();
    const std::size_t head_end = std::min(kHeadLines, unique.size());
    const std::size_t tail_start = unique.size() > kTailLines ? std::max(head_end, unique.size() - kTailLines) : head_end;
    std::vector<std::string> shown(unique.begin(), unique.begin() + static_cast<std::ptrdiff_t>(head_end));
    const bool middle = tail_start > head_end;
    if (middle) shown.push_back("[gm: ...]");
    std::size_t signals = 0;
    for (std::size_t i = head_end; i < tail_start && signals < kMaxSignals; ++i) {
        if (!signal_line(unique[i])) continue;
        shown.push_back(unique[i]);
        ++signals;
    }
    if (middle) shown.push_back("[gm: ...]");
    shown.insert(shown.end(), unique.begin() + static_cast<std::ptrdiff_t>(tail_start), unique.end());
    std::string output;
    for (const std::string& line : shown) { output += line; output.push_back('\n'); }
    if (output.size() > kMaxChars) output.resize(kMaxChars);
    const std::size_t dropped = raw.size() > head_end + signals + (unique.size() - tail_start) ? raw.size() - head_end - signals - (unique.size() - tail_start) : 0;
    output += "\n[gm: kept " + std::to_string(head_end + signals + (unique.size() - tail_start)) + " of " + std::to_string(unique.size()) + " lines; dropped " + std::to_string(dropped) + "; " + std::to_string(original) + " chars; use raw:true or the job log for the full output]";
    return Condensed{output, original, output.size(), dropped};
}

}
