#pragma once

#include <cstddef>
#include <mutex>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "gm/verbs.hpp"

namespace gm::host {

class BrowserScope final : public VerbTable {
public:
    explicit BrowserScope(VerbTable& inner);

    std::vector<VerbInfo> list() const override;
    json::Value call(std::string_view name, const json::Value& args) override;

private:
    json::Value user_execute(const json::Value& args);
    json::Value browsers(const json::Value& args);
    json::Value close_machine(const json::Value& args);
    json::Value tabs();
    json::Value close_run();

    VerbTable& inner_;
    std::mutex mutex_;
    bool used_ = false;
    std::optional<std::string> last_view_;
    std::size_t last_count_ = 0;
};

}
