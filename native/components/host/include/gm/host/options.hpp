#pragma once

#include <filesystem>
#include <initializer_list>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "deoxidene/result.hpp"

namespace gm::host {

struct HostArgs {
    std::string mode;
    std::vector<std::string> rest;

    std::optional<std::string> flag(std::string_view name) const;
    std::filesystem::path path_or(std::string_view name, const std::filesystem::path& fallback) const;
};

HostArgs parse_args(int argc, char** argv);
std::vector<std::string> without_flags(const std::vector<std::string>& args, std::initializer_list<std::string_view> names);
std::string new_run_id();
deoxidene::Result<std::filesystem::path, std::string> choose_run_dir(const HostArgs& args,
                                                                     const std::filesystem::path& workspace);

std::filesystem::path source_root();
std::filesystem::path default_build_dir();
std::filesystem::path workspace_of(const HostArgs& args);
std::filesystem::path leaves_dir_of(const HostArgs& args);
std::filesystem::path skills_dir_of(const HostArgs& args);
std::filesystem::path defaults_dir_of();

int run_serve(const HostArgs& args);
int run_worker(const HostArgs& args);
int run_doctor(const HostArgs& args);

}
