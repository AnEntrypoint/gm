#include "gm/tool.hpp"

#include <fstream>
#include <regex>
#include <set>
#include <string>
#include <system_error>
#include <vector>

namespace gm::tool {
namespace fs = std::filesystem;
namespace {

const std::set<std::string> kPosixHeaders{
    "unistd.h", "poll.h", "pthread.h", "dirent.h", "netdb.h", "termios.h", "dlfcn.h", "spawn.h", "sched.h", "semaphore.h",
    "libgen.h", "fnmatch.h", "pwd.h", "grp.h", "sys/wait.h", "sys/socket.h", "sys/ioctl.h", "sys/mman.h", "sys/resource.h",
    "sys/time.h", "sys/select.h", "sys/un.h", "sys/sysctl.h", "sys/file.h", "sys/uio.h", "sys/prctl.h", "sys/syscall.h",
    "sys/param.h", "sys/mount.h", "sys/statvfs.h", "sys/utsname.h", "arpa/inet.h", "netinet/in.h", "netinet/tcp.h"};

const std::regex kInclude(R"(^\s*#\s*include\s*<([A-Za-z0-9_/.]+)>)");
const std::regex kDirective(R"(^\s*#\s*(if|ifdef|ifndef|elif|else|endif)\b(.*))");

struct Frame {
    bool posix_branch = false;
    bool windows_condition = false;
};

bool mentions_windows(const std::string& text) { return text.find("_WIN32") != std::string::npos || text.find("_MSC_VER") != std::string::npos; }

bool negated_windows(const std::string& text) {
    return text.find("!defined(_WIN32)") != std::string::npos || text.find("! defined(_WIN32)") != std::string::npos || text.find("!_WIN32") != std::string::npos ||
           text.find("!defined(_MSC_VER)") != std::string::npos || text.find("!defined _WIN32") != std::string::npos;
}

bool names_posix_platform(const std::string& text) {
    for (const char* name : {"__linux__", "__APPLE__", "__unix__", "__wasi__", "__SANITIZE_ADDRESS__"}) {
        if (text.find(name) != std::string::npos) return true;
    }
    return false;
}

bool excludes_windows(const std::string& keyword, const std::string& condition) {
    if (keyword == "ifndef") return condition.find("_WIN32") != std::string::npos;
    if (keyword == "ifdef") return names_posix_platform(condition);
    if (names_posix_platform(condition) && !mentions_windows(condition)) return true;
    return negated_windows(condition);
}

bool is_windows_condition(const std::string& keyword, const std::string& condition) {
    if (keyword == "ifdef") return mentions_windows(condition);
    if (keyword == "ifndef") return false;
    return mentions_windows(condition) && !negated_windows(condition);
}

bool skipped(const std::string& rel) { return rel.find("third_party/") != std::string::npos || rel.find("vendor/") != std::string::npos; }

std::string checkout_of(const fs::path& start) {
    const auto top = git_output(start, {"rev-parse", "--show-toplevel"});
    std::string text = top.value_or(start.string());
    while (!text.empty() && (text.back() == '\n' || text.back() == '\r')) text.pop_back();
    return text;
}

}

CheckResult check_portable_includes(const std::string&) {
    CheckResult result;
    const fs::path root = checkout_of(fs::current_path());
    std::size_t scanned = 0;
    std::size_t guarded = 0;
    std::error_code ec;
    for (fs::recursive_directory_iterator it(root / "native", ec), end; !ec && it != end; it.increment(ec)) {
        const auto& path = it->path();
        if (!it->is_regular_file(ec)) continue;
        const auto ext = path.extension().string();
        if (ext != ".cpp" && ext != ".hpp" && ext != ".h" && ext != ".cc") continue;
        const std::string rel = path.lexically_relative(root).generic_string();
        if (skipped(rel)) continue;
        ++scanned;
        std::ifstream in(path);
        std::vector<Frame> frames;
        std::size_t number = 0;
        for (std::string line; std::getline(in, line);) {
            ++number;
            std::smatch found;
            if (std::regex_search(line, found, kDirective)) {
                const std::string keyword = found[1].str();
                const std::string condition = found[2].str();
                if (keyword == "if" || keyword == "ifdef" || keyword == "ifndef") {
                    frames.push_back(Frame{excludes_windows(keyword, condition), is_windows_condition(keyword, condition)});
                } else if (keyword == "elif" && !frames.empty()) {
                    Frame& top = frames.back();
                    top.posix_branch = top.windows_condition || excludes_windows("if", condition);
                    top.windows_condition = false;
                } else if (keyword == "else" && !frames.empty()) {
                    Frame& top = frames.back();
                    top.posix_branch = top.windows_condition;
                    top.windows_condition = false;
                } else if (keyword == "endif" && !frames.empty()) {
                    frames.pop_back();
                }
                continue;
            }
            if (!std::regex_search(line, found, kInclude) || kPosixHeaders.count(found[1].str()) == 0) continue;
            bool posix_only = false;
            for (const Frame& frame : frames) posix_only = posix_only || frame.posix_branch;
            if (posix_only) {
                ++guarded;
            } else {
                result.failures.push_back(rel + ":" + std::to_string(number) + ": #include <" + found[1].str() + "> is compiled on Windows, which has no such header; put it under #if !defined(_WIN32)");
            }
        }
    }
    result.summary = std::to_string(scanned) + " native files scanned, " + std::to_string(guarded) + " POSIX header includes, each inside a branch Windows does not compile";
    return result;
}

}
