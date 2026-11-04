#include "gmnew/leaves.hpp"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <fstream>
#include <iterator>
#include <map>
#include <mutex>
#include <optional>
#include <string>
#include <system_error>

#include "engine.hpp"

namespace gmnew {
namespace {

using engine::Engine;
using engine::Scoped;
using engine::Session;

constexpr std::chrono::milliseconds leaf_call_deadline{120000};

struct FileKey {
    std::int64_t mtime = 0;
    std::uintmax_t size = 0;
    bool operator==(const FileKey&) const = default;
};

struct Leaf {
    FileKey key;
    std::shared_ptr<const std::vector<std::uint8_t>> bytecode;
    std::vector<VerbInfo> verbs;
    std::optional<std::string> unreported_error;
};

std::optional<FileKey> key_of(const std::filesystem::path& file) {
    std::error_code ec;
    auto mtime = std::filesystem::last_write_time(file, ec);
    if (ec) return std::nullopt;
    auto size = std::filesystem::file_size(file, ec);
    if (ec) return std::nullopt;
    return FileKey{static_cast<std::int64_t>(mtime.time_since_epoch().count()), size};
}

std::optional<std::string> read_file(const std::filesystem::path& file) {
    std::ifstream in(file, std::ios::binary);
    if (!in) return std::nullopt;
    return std::string(std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>());
}

void start_deadline(Session& session) {
    session.deadline_budget = leaf_call_deadline;
    session.deadline = engine::Clock::now() + leaf_call_deadline;
}

deoxidene::Result<JSValue, std::string> verbs_export(Engine& engine, const std::vector<std::uint8_t>& bytecode) {
    JSContext* ctx = engine.ctx();
    if (!engine::install_host(engine)) return deoxidene::Err<std::string>(engine::take_exception_message(engine));
    auto ns = engine::load_module_namespace(engine, bytecode);
    if (!ns) return deoxidene::Err<std::string>(ns.error());
    Scoped namespace_value(ctx, *ns);
    JSValue verbs = JS_GetPropertyStr(ctx, namespace_value.get(), "verbs");
    if (JS_IsUndefined(verbs)) return JS_NewArray(ctx);
    if (!JS_IsArray(verbs)) {
        JS_FreeValue(ctx, verbs);
        return deoxidene::Err<std::string>("the leaf does not export a verbs array");
    }
    return verbs;
}

std::string string_property(JSContext* ctx, JSValueConst object, const char* name) {
    Scoped value(ctx, JS_GetPropertyStr(ctx, object, name));
    return JS_IsString(value.get()) ? engine::to_std_string(ctx, value.get()) : std::string();
}

deoxidene::Result<std::vector<VerbInfo>, std::string> read_metadata(const HostServices& host, const std::vector<std::uint8_t>& bytecode) {
    Session session;
    session.host = &host;
    start_deadline(session);
    Engine engine(session);
    if (!engine.ready()) return deoxidene::Err<std::string>("the JavaScript runtime did not start");
    JSContext* ctx = engine.ctx();
    auto verbs = verbs_export(engine, bytecode);
    if (!verbs) return deoxidene::Err<std::string>(verbs.error());
    Scoped verbs_value(ctx, *verbs);
    std::int64_t length = 0;
    JS_GetLength(ctx, verbs_value.get(), &length);
    std::vector<VerbInfo> out;
    for (std::int64_t index = 0; index < length; ++index) {
        Scoped verb(ctx, JS_GetPropertyInt64(ctx, verbs_value.get(), index));
        VerbInfo info;
        info.name = string_property(ctx, verb.get(), "name");
        if (info.name.empty()) return deoxidene::Err<std::string>("verb " + std::to_string(index) + " has no name");
        info.description = string_property(ctx, verb.get(), "description");
        Scoped schema(ctx, JS_GetPropertyStr(ctx, verb.get(), "inputSchema"));
        auto schema_json = engine::js_to_json(ctx, schema.get());
        info.input_schema_json = schema_json && !schema_json->is_null() ? json::dump(*schema_json) : "{}";
        out.push_back(std::move(info));
    }
    return out;
}

json::Value run_leaf_verb(const HostServices& host, const std::vector<std::uint8_t>& bytecode, std::string_view name, const json::Value& args) {
    Session session;
    session.host = &host;
    start_deadline(session);
    Engine engine(session);
    if (!engine.ready()) return engine::failed_reply("the JavaScript runtime did not start");
    JSContext* ctx = engine.ctx();
    auto verbs = verbs_export(engine, bytecode);
    if (!verbs) return engine::failed_reply(verbs.error());
    Scoped verbs_value(ctx, *verbs);
    std::int64_t length = 0;
    JS_GetLength(ctx, verbs_value.get(), &length);
    for (std::int64_t index = 0; index < length; ++index) {
        Scoped verb(ctx, JS_GetPropertyInt64(ctx, verbs_value.get(), index));
        if (string_property(ctx, verb.get(), "name") != name) continue;
        Scoped call(ctx, JS_GetPropertyStr(ctx, verb.get(), "call"));
        if (!JS_IsFunction(ctx, call.get())) return engine::failed_reply("verb " + std::string(name) + " has no call function");
        Scoped args_js(ctx, engine::json_to_js(ctx, args));
        JSValue call_args[1] = {args_js.get()};
        engine::Settled settled = engine::settle(engine, JS_Call(ctx, call.get(), verb.get(), 1, call_args));
        Scoped value(ctx, settled.value);
        if (settled.outcome == engine::Outcome::Rejected) return engine::failed_reply(engine::deadline_or(engine, engine::error_message(ctx, value.get())));
        if (settled.outcome == engine::Outcome::Pending) return engine::failed_reply("verb " + std::string(name) + " stopped before it returned");
        auto converted = engine::js_to_json(ctx, value.get());
        if (!converted) return engine::failed_reply(converted.error());
        return std::move(*converted);
    }
    return engine::failed_reply("unknown verb: " + std::string(name));
}

}

struct LeafVerbs::State {
    std::filesystem::path leaves_dir;
    HostServices host;
    mutable std::mutex mutex;
    mutable std::map<std::filesystem::path, Leaf> leaves;
    mutable std::atomic<std::uint64_t> generation{0};

    void log_refusal(const std::filesystem::path& file, const std::string& error) const {
        auto log = host.extra.find("logAppend");
        if (log == host.extra.end()) return;
        json::Value fields;
        fields.set("leaf", file.generic_string());
        fields.set("error", error);
        json::Value event;
        event.set("kind", "leaf-refused");
        event.set("fields", std::move(fields));
        try {
            log->second(event);
        } catch (...) {
        }
    }

    std::vector<std::filesystem::path> leaf_files() const {
        std::vector<std::filesystem::path> files;
        std::error_code ec;
        for (const auto& entry : std::filesystem::directory_iterator(leaves_dir, ec)) {
            if (entry.path().extension() == ".mjs" && entry.is_regular_file(ec)) files.push_back(entry.path());
        }
        std::sort(files.begin(), files.end());
        return files;
    }

    void refresh_locked() const {
        auto files = leaf_files();
        for (auto it = leaves.begin(); it != leaves.end();) {
            if (std::find(files.begin(), files.end(), it->first) == files.end()) {
                it = leaves.erase(it);
                generation.fetch_add(1);
            } else {
                ++it;
            }
        }
        for (const auto& file : files) {
            auto key = key_of(file);
            if (!key) continue;
            auto existing = leaves.find(file);
            if (existing != leaves.end() && existing->second.key == *key) continue;
            Leaf& leaf = leaves[file];
            bool replacing = leaf.bytecode != nullptr;
            leaf.key = *key;
            auto loaded = load(file);
            if (!loaded) {
                leaf.unreported_error = file.filename().string() + " does not load, so its last good code is kept: " + loaded.error();
                log_refusal(file, loaded.error());
                continue;
            }
            leaf.bytecode = std::make_shared<const std::vector<std::uint8_t>>(std::move(loaded->first));
            leaf.verbs = std::move(loaded->second);
            leaf.unreported_error.reset();
            if (replacing) generation.fetch_add(1);
        }
    }

    deoxidene::Result<std::pair<std::vector<std::uint8_t>, std::vector<VerbInfo>>, std::string> load(const std::filesystem::path& file) const {
        auto source = read_file(file);
        if (!source) return deoxidene::Err<std::string>("the file cannot be read");
        auto bytecode = engine::compile_module(*source, std::filesystem::absolute(file).generic_string());
        if (!bytecode) return deoxidene::Err<std::string>(bytecode.error());
        auto metadata = read_metadata(host, *bytecode);
        if (!metadata) return deoxidene::Err<std::string>(metadata.error());
        return std::pair{std::move(*bytecode), std::move(*metadata)};
    }
};

LeafVerbs::LeafVerbs(std::filesystem::path leaves_dir, const HostServices& host) : state_(std::make_unique<State>()) {
    state_->leaves_dir = std::move(leaves_dir);
    state_->host = host;
}

LeafVerbs::~LeafVerbs() = default;

std::vector<VerbInfo> LeafVerbs::list() const {
    std::lock_guard lock(state_->mutex);
    state_->refresh_locked();
    std::vector<VerbInfo> out;
    for (const auto& [file, leaf] : state_->leaves) {
        out.insert(out.end(), leaf.verbs.begin(), leaf.verbs.end());
    }
    return out;
}

json::Value LeafVerbs::call(std::string_view name, const json::Value& args) {
    std::shared_ptr<const std::vector<std::uint8_t>> bytecode;
    HostServices host;
    {
        std::lock_guard lock(state_->mutex);
        host = state_->host;
        state_->refresh_locked();
        for (auto& [file, leaf] : state_->leaves) {
            bool owns = std::any_of(leaf.verbs.begin(), leaf.verbs.end(), [&](const VerbInfo& verb) { return verb.name == name; });
            if (!owns) continue;
            if (leaf.unreported_error) {
                std::string error = std::move(*leaf.unreported_error);
                leaf.unreported_error.reset();
                return engine::failed_reply(std::move(error));
            }
            bytecode = leaf.bytecode;
            break;
        }
        if (!bytecode) {
            std::string error = "unknown verb: " + std::string(name);
            for (const auto& [file, leaf] : state_->leaves) {
                if (!leaf.bytecode) error += "; " + file.filename().string() + " does not load";
            }
            return engine::failed_reply(std::move(error));
        }
    }
    return run_leaf_verb(host, *bytecode, name, args);
}

void LeafVerbs::set_run_dir(std::filesystem::path run_dir) {
    std::lock_guard lock(state_->mutex);
    state_->host.run_dir = std::move(run_dir);
}

std::uint64_t LeafVerbs::generation() const {
    std::lock_guard lock(state_->mutex);
    state_->refresh_locked();
    return state_->generation.load();
}

}
