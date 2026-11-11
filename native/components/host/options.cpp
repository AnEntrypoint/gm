#include "gm/host/options.hpp"

#include <chrono>
#include <ctime>
#include <fstream>
#include <random>
#include <sstream>
#include <system_error>

#include "gm/host/child.hpp"

namespace gm::host {

std::optional<std::string> HostArgs::flag(std::string_view name) const {
    for (std::size_t i = 0; i + 1 < rest.size(); ++i) {
        if (rest[i] == name) return rest[i + 1];
    }
    return std::nullopt;
}

std::filesystem::path HostArgs::path_or(std::string_view name, const std::filesystem::path& fallback) const {
    auto value = flag(name);
    return value ? std::filesystem::absolute(*value) : fallback;
}

HostArgs parse_args(int argc, char** argv) {
    HostArgs args;
    if (argc > 1) args.mode = argv[1];
    for (int i = 2; i < argc; ++i) args.rest.emplace_back(argv[i]);
    return args;
}

std::vector<std::string> without_flags(const std::vector<std::string>& args,
                                       std::initializer_list<std::string_view> names) {
    std::vector<std::string> out;
    for (std::size_t i = 0; i < args.size(); ++i) {
        bool named = false;
        for (std::string_view name : names) named = named || args[i] == name;
        if (named)
            ++i;
        else
            out.push_back(args[i]);
    }
    return out;
}

std::string new_run_id() {
    const std::time_t now = std::chrono::system_clock::to_time_t(std::chrono::system_clock::now());
    std::tm utc{};
#if defined(_WIN32)
    gmtime_s(&utc, &now);
#else
    gmtime_r(&now, &utc);
#endif
    char stamp[32];
    std::strftime(stamp, sizeof stamp, "%Y-%m-%d-%H-%M-%S", &utc);
    std::random_device device;
    char suffix[8];
    std::snprintf(suffix, sizeof suffix, "%06x", static_cast<unsigned>(device()) & 0xffffffu);
    return std::string(stamp) + "-" + suffix;
}

deoxidene::Result<std::filesystem::path, std::string> choose_run_dir(const HostArgs& args,
                                                                     const std::filesystem::path& workspace) {
    if (auto explicit_dir = args.flag("--run-dir")) return std::filesystem::absolute(*explicit_dir);
    auto runs = args.flag("--runs");
    auto resume = args.flag("--resume");
    if (!runs) {
        if (resume) return deoxidene::Err<std::string>("--resume needs --runs");
        return workspace / "runs" / new_run_id();
    }
    const auto root = std::filesystem::absolute(*runs);
    if (resume) {
        const bool valid = !resume->empty() && resume->find_first_not_of(
                                                   "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-") ==
                                                   std::string::npos;
        if (!valid) return deoxidene::Err<std::string>("--resume takes a run id");
        const auto dir = root / *resume;
        if (!std::filesystem::exists(dir / "log.jsonl"))
            return deoxidene::Err<std::string>("no run " + *resume + " under " + root.string());
        return dir;
    }
    return root / new_run_id();
}

static std::filesystem::path install_dir() { return current_executable().parent_path(); }

std::filesystem::path workspace_of(const HostArgs& args) {
    return args.path_or("--workspace", std::filesystem::current_path());
}

deoxidene::Result<std::string, std::string> task_of(const HostArgs& args) {
    const auto value = args.flag("--task");
    if (!value) return std::string{};
    std::string task = *value;
    std::error_code ec;
    if (!value->empty() && std::filesystem::is_regular_file(std::filesystem::absolute(*value), ec)) {
        std::ifstream in(*value, std::ios::binary);
        if (!in) return deoxidene::Err<std::string>("cannot read the task file " + *value);
        std::ostringstream text;
        text << in.rdbuf();
        task = text.str();
    }
    const auto first = task.find_first_not_of(" \t\r\n");
    const auto last = task.find_last_not_of(" \t\r\n");
    task = first == std::string::npos ? std::string{} : task.substr(first, last - first + 1);
    if (task.empty()) return deoxidene::Err<std::string>("--task is empty");
    return task;
}

deoxidene::Result<int, std::string> positive_int_flag(const HostArgs& args, std::string_view name, int fallback) {
    const auto flag = args.flag(name);
    if (!flag) return fallback;
    const bool digits = !flag->empty() && flag->size() <= 9 && flag->find_first_not_of("0123456789") == std::string::npos;
    if (!digits || std::stoi(*flag) < 1) return deoxidene::Err<std::string>(std::string(name) + " must be a positive integer");
    return std::stoi(*flag);
}

std::filesystem::path leaves_dir_of(const HostArgs& args) { return args.path_or("--leaves", install_dir() / "leaves"); }

std::filesystem::path skills_dir_of(const HostArgs& args) { return args.path_or("--skills", install_dir() / "skills"); }

std::filesystem::path defaults_dir_of() { return install_dir() / "defaults"; }

}
