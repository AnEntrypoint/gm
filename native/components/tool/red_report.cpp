#include "gm/tool.hpp"

#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <set>
#include <sstream>
#include <system_error>

namespace gm::tool {
namespace fs = std::filesystem;
namespace {

constexpr int kLogLines = 14;
constexpr int kCandidateCommits = 6;

std::string trim_trailing(std::string text) {
    while (!text.empty() && (text.back() == '\n' || text.back() == '\r')) text.pop_back();
    return text;
}

std::string read_whole(const fs::path& file) {
    std::ifstream in(file, std::ios::binary);
    std::ostringstream text;
    text << in.rdbuf();
    return text.str();
}

std::vector<std::string> lines_of(const std::string& text) {
    std::vector<std::string> lines;
    std::istringstream in(text);
    for (std::string line; std::getline(in, line);) {
        while (!line.empty() && (line.back() == '\r' || line.back() == '\n')) line.pop_back();
        lines.push_back(line);
    }
    return lines;
}

std::string head_of(const std::vector<std::string>& lines, int count) {
    std::string shown;
    for (int i = 0; i < count && i < static_cast<int>(lines.size()); ++i) shown += "    " + lines[static_cast<std::size_t>(i)].substr(0, 400) + "\n";
    return shown;
}

std::string tail_lines(const std::vector<std::string>& lines, int count) {
    std::string shown;
    const int from = static_cast<int>(lines.size()) > count ? static_cast<int>(lines.size()) - count : 0;
    for (int i = from; i < static_cast<int>(lines.size()); ++i) shown += "    " + lines[static_cast<std::size_t>(i)].substr(0, 400) + "\n";
    return shown;
}

}

int red_report_command(const fs::path& root, const std::vector<std::string>& args) {
    if (args.empty()) {
        std::fputs("usage: gm-tool red-report <phase-b log> [phase-b-logs dir]\n", stderr);
        return 2;
    }
    const fs::path log_file = args[0];
    const fs::path logs_dir = args.size() > 1 ? fs::path(args[1]) : fs::path();
    const std::vector<std::string> log_lines = lines_of(read_whole(log_file));
    std::vector<std::string> failed;
    std::set<std::string> seen;
    for (const std::string& line : log_lines) {
        const std::string head = "phase-b: ";
        const auto at = line.find(" FAILED ");
        if (line.compare(0, head.size(), head) != 0 || at == std::string::npos) continue;
        const std::string name = line.substr(head.size(), at - head.size());
        if (seen.insert(name).second) failed.push_back(name);
    }
    const std::string commits = trim_trailing(git_output(root, {"log", "-" + std::to_string(kCandidateCommits), "--format=%h %an <%ae> %s"}).value_or("(git log unavailable)"));
    const std::string tip = trim_trailing(git_output(root, {"log", "-1", "--format=%h %an <%ae>: %s"}).value_or("(git log unavailable)"));
    std::ostringstream report;
    report << "Phase B is red at " << tip << "\n";
    if (failed.empty()) {
        report << "no check was named FAILED in " << log_file.string() << "; the last lines of it:\n" << tail_lines(log_lines, kLogLines);
    } else {
        report << failed.size() << " failed check(s):";
        for (const std::string& name : failed) report << " " << name;
        report << "\n";
        for (const std::string& name : failed) {
            report << "\n" << name << ":\n";
            const std::string own = logs_dir.empty() ? std::string() : read_whole(logs_dir / (name + ".log"));
            report << (own.empty() ? std::string("    (no log file)\n") : head_of(lines_of(own), kLogLines));
        }
    }
    report << "\nthe latest commits, one of which broke it:\n" << commits << "\n";
    std::fputs(report.str().c_str(), stdout);
    for (const std::string& name : failed) std::printf("::error title=Phase B red::%s failed at %s\n", name.c_str(), tip.c_str());
    if (failed.empty()) std::printf("::error title=Phase B red::Phase B failed at %s with no check named\n", tip.c_str());
    if (const char* summary = std::getenv("GITHUB_STEP_SUMMARY"); summary != nullptr && *summary != '\0') {
        std::ofstream out(summary, std::ios::app);
        out << "### Phase B is red\n\n```\n" << report.str() << "```\n";
    }
    return 0;
}

}
