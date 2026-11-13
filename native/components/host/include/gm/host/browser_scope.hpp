#pragma once

#include <cstddef>
#include <filesystem>
#include <mutex>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "gm/verbs.hpp"

namespace gm::host {

class BrowserScope final : public VerbTable {
public:
    BrowserScope(VerbTable& inner, std::filesystem::path pages_file);

    std::vector<VerbInfo> list() const override;
    json::Value call_sibling(std::string_view sibling, std::string_view tool, const json::Value& args) override;
    json::Value call(std::string_view name, const json::Value& args) override;

private:
    json::Value user_execute(const json::Value& args);
    json::Value browsers_call(const json::Value& args);
    json::Value browsers(const json::Value& args);
    json::Value close_machine(const json::Value& args);
    json::Value tabs();
    json::Value close_run();
    void record_owned_pages();
    std::vector<std::string> recorded_pages() const;
    void write_recorded_pages(const std::vector<std::string>& ids) const;

    VerbTable& inner_;
    std::filesystem::path pages_file_;
    std::mutex mutex_;
    bool used_ = false;
    std::optional<std::string> last_view_;
    std::size_t last_count_ = 0;
};

}
