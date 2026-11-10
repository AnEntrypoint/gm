#include <chrono>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <string>
#include <string_view>
#include <vector>

#include "deoxidene/result.hpp"
#include "gm/json.hpp"
#include "gm/runcode.hpp"
#include "gm/verbs.hpp"

namespace {

constexpr std::chrono::milliseconds run_entry_deadline{120000};

class NoVerbs final : public gm::VerbTable {
public:
    std::vector<gm::VerbInfo> list() const override { return {}; }
    gm::json::Value call(std::string_view name, const gm::json::Value&) override {
        gm::json::Value reply;
        reply.set("ok", false);
        reply.set("error", "unknown verb: " + std::string(name));
        return reply;
    }
};

char* copy_out(const std::string& text) {
    char* out = static_cast<char*>(std::malloc(text.size() + 1));
    if (out == nullptr) return nullptr;
    std::memcpy(out, text.data(), text.size());
    out[text.size()] = '\0';
    return out;
}

}

extern "C" char* gm_run_body(const char* body, const char* format) {
    auto controls = std::make_shared<gm::BodyControls>();
    controls->js_budget = run_entry_deadline;
    NoVerbs verbs;
    auto result = gm::run_body(verbs, body == nullptr ? std::string_view() : std::string_view(body), "",
                               format == nullptr ? std::string_view("cjs") : std::string_view(format), controls);
    gm::json::Value reply;
    if (result) {
        reply.set("ok", true);
        reply.set("value", std::move(*result));
    } else {
        reply.set("ok", false);
        reply.set("error", result.error());
    }
    return copy_out(gm::json::dump(reply));
}
