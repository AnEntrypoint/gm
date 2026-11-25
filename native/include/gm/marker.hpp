#pragma once

#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>

namespace gm::marker {

inline constexpr std::string_view kCutMarker = "<<<gm-cut";
inline constexpr std::string_view kPointerMarker = "<<<gm-pointer";
inline constexpr std::string_view kCutHere = "<<<gm-cut-here>>>";
inline constexpr std::size_t kInlineChars = 12000;

inline std::string cut_line(std::size_t omitted, const std::string& path) {
    return std::string(kCutMarker) + " omitted=" + std::to_string(omitted) + " outputPath=" + path + " full=true>>>";
}

inline std::string pointer_line(std::uint64_t step) {
    return std::string(kPointerMarker) + " step=" + std::to_string(step) + " fresh=true>>>";
}

inline bool expect(std::string_view text, std::size_t& at, std::string_view part) {
    if (text.substr(at, part.size()) != part) return false;
    at += part.size();
    return true;
}

inline bool digits(std::string_view text, std::size_t& at) {
    const std::size_t begin = at;
    while (at < text.size() && text[at] >= '0' && text[at] <= '9') ++at;
    return at > begin;
}

inline std::optional<std::string> cut_path(std::string_view text) {
    for (std::size_t at = text.find(kCutMarker); at != std::string_view::npos; at = text.find(kCutMarker, at + 1)) {
        std::size_t cursor = at + kCutMarker.size();
        if (!expect(text, cursor, " omitted=") || !digits(text, cursor) || !expect(text, cursor, " outputPath=")) continue;
        const std::size_t end = text.find(" full=true>>>", cursor);
        const std::size_t newline = text.find('\n', cursor);
        if (end == std::string_view::npos || (newline != std::string_view::npos && newline < end)) continue;
        return std::string(text.substr(cursor, end - cursor));
    }
    return std::nullopt;
}

inline bool has_pointer(std::string_view text) {
    for (std::size_t at = text.find(kPointerMarker); at != std::string_view::npos; at = text.find(kPointerMarker, at + 1)) {
        std::size_t cursor = at + kPointerMarker.size();
        if (expect(text, cursor, " step=") && digits(text, cursor) && expect(text, cursor, " fresh=true>>>")) return true;
    }
    return false;
}

inline std::optional<std::string> write_refusal(std::string_view text, std::string_view verb) {
    if (const std::optional<std::string> path = cut_path(text)) {
        return std::string(verb) + " refused: the text holds a cut from a bounded reply, not file text; the whole text is at outputPath " + *path +
               ", so call the read with full: true and write that text";
    }
    if (has_pointer(text)) {
        return std::string(verb) + " refused: the text is a repeat-read pointer, not file text; call the read again with fresh: true, then write its output as the content";
    }
    return std::nullopt;
}

}
