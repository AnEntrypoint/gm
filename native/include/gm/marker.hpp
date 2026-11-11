#pragma once

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>

namespace gm::marker {

inline constexpr std::string_view kCutMarker = "<<<gm-cut";
inline constexpr std::string_view kPointerMarker = "<<<gm-pointer";
inline constexpr std::string_view kCutHere = "<<<gm-cut-here>>>";

inline std::string cut_line(std::size_t omitted, const std::string& path) {
    return std::string(kCutMarker) + " omitted=" + std::to_string(omitted) + " outputPath=" + path + " full=true>>>";
}

inline std::string pointer_line(std::uint64_t step) {
    return std::string(kPointerMarker) + " step=" + std::to_string(step) + " fresh=true>>>";
}

inline std::optional<std::string> write_refusal(std::string_view text, std::string_view verb) {
    const std::size_t cut = text.find(kCutMarker);
    if (cut != std::string_view::npos) {
        const std::size_t key = text.find("outputPath=", cut);
        const std::size_t end = key == std::string_view::npos ? key : text.find(" full=", key);
        const std::string path = end == std::string_view::npos ? std::string("(not in the marker)") : std::string(text.substr(key + 11, end - key - 11));
        return std::string(verb) + " refused: the text holds a cut from a bounded reply, not file text; the whole text is at outputPath " + path +
               ", so call the read with full: true and write that text";
    }
    if (text.find(kPointerMarker) != std::string_view::npos) {
        return std::string(verb) + " refused: the text is a repeat-read pointer, not file text; call the read again with fresh: true, then write its output with full: true";
    }
    return std::nullopt;
}

}
