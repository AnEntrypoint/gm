#include "gm/tool.hpp"
#include "support.hpp"

#include <algorithm>
#include <cctype>
#include <filesystem>
#include <map>
#include <set>
#include <sstream>
#include <string>
#include <system_error>
#include <vector>

namespace gm::tool {
namespace {

namespace fs = std::filesystem;

constexpr const char* kExecutables[] = {"host/gm", "host/gm-core", "tool/gm-tool"};
constexpr const char* kSkipped[] = {"lambda", "[clone", "{", "std::", "operator", "~", "__", "<"};

std::set<std::string> defined_functions(const fs::path& file) {
    std::set<std::string> names;
    const proc::Outcome listed = proc::run({"nm", "--defined-only", "--demangle", file.string()}, {}, {}, 60000);
    std::istringstream lines(listed.out);
    for (std::string address, kind, name; lines >> address >> kind && std::getline(lines >> std::ws, name);) {
        if (kind == "T" || kind == "t" || kind == "W" || kind == "w") names.insert(name);
    }
    return names;
}

std::string short_name(std::string demangled) {
    for (std::size_t at = demangled.find("(anonymous namespace)::"); at != std::string::npos; at = demangled.find("(anonymous namespace)::")) demangled.erase(at, 23);
    const std::string head = demangled.substr(0, std::min(demangled.find('('), demangled.find("[abi:")));
    const std::size_t colons = head.rfind("::");
    return colons == std::string::npos ? head : head.substr(colons + 2);
}

void count_words(const std::string& text, std::map<std::string, std::size_t>& counts) {
    const auto is_word = [](char c) { return std::isalnum(static_cast<unsigned char>(c)) || c == '_'; };
    for (std::size_t at = 0; at < text.size();) {
        if (!is_word(text[at])) {
            ++at;
            continue;
        }
        const std::size_t begin = at;
        while (at < text.size() && is_word(text[at])) ++at;
        ++counts[text.substr(begin, at - begin)];
    }
}

}

CheckResult check_dead_symbols(const std::string& binary) {
    CheckResult result;
#if !defined(__linux__)
    result.summary = "skipped (not on this platform: the witness reads the Linux linker's section garbage collection)";
    return result;
#else
    const fs::path root = support::checkout_root();
    const fs::path components = fs::path(binary).parent_path().parent_path();
    if (root.empty() || !fs::exists(components / "tool" / "gm-tool")) {
        result.failures.push_back("run from the checkout against a build tree that holds gm, gm-core and gm-tool");
        return result;
    }
    std::set<std::string> linked;
    for (const char* executable : kExecutables) {
        const std::set<std::string> names = defined_functions(components / executable);
        linked.insert(names.begin(), names.end());
    }
    if (linked.empty()) {
        result.failures.push_back("nm listed no functions in the executables; is binutils installed?");
        return result;
    }
    std::map<std::string, std::size_t> words;
    std::map<std::string, std::size_t> declared;
    for (const std::string& file : nul_split(git_output(root, {"ls-files", "-z", "native", "tools/txiki/extras"}).value_or(""))) {
        if (file.find("third_party") != std::string::npos) continue;
        const bool header = file.ends_with(".hpp") || file.ends_with(".h");
        if (header || file.ends_with(".cpp") || file.ends_with(".c")) count_words(support::read_text(root / file), header ? declared : words);
    }
    std::vector<std::string> unlinked;
    std::size_t objects = 0;
    std::error_code ec;
    for (const auto& entry : fs::recursive_directory_iterator(components, ec)) {
        const std::string path = entry.path().string();
        if (entry.path().extension() != ".o" || path.find("third_party") != std::string::npos || path.find("libuv") != std::string::npos) continue;
        ++objects;
        for (const std::string& name : defined_functions(entry.path())) {
            if (!linked.contains(name)) unlinked.push_back(name);
        }
    }
    std::set<std::string> dead;
    for (const std::string& line : unlinked) {
        if (!line.starts_with("gm::")) continue;
        bool skipped = false;
        for (const char* marker : kSkipped) skipped = skipped || line.find(marker) != std::string::npos;
        if (skipped) continue;
        const std::string name = short_name(line);
        if (words[name] + declared[name] <= 1 + std::min<std::size_t>(declared[name], 1) && words[name] <= 1) dead.insert(line);
    }
    for (const std::string& name : dead) result.failures.push_back("no caller: " + name + " is dropped by the linker and its name appears only where it is declared and defined");
    if (result.failures.empty()) result.summary = "every gm function in " + std::to_string(objects) + " objects that the linker drops from gm, gm-core and gm-tool is still named somewhere besides its declaration and definition (none is dead)";
    return result;
#endif
}

}
