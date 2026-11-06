#include "gm/host/primitives.hpp"

#include "gm/proc.hpp"

namespace gm::host {

namespace {

json::Value failure(std::string message) {
    json::Value reply;
    reply.set("ok", false);
    reply.set("error", std::move(message));
    return reply;
}

std::filesystem::path cwd_of(const json::Value& args, const std::filesystem::path& workspace) {
    const json::Value* cwd = args.find("cwd");
    if (cwd == nullptr || !cwd->is_string() || cwd->as_string().empty()) return workspace;
    const std::filesystem::path given(cwd->as_string());
    return given.is_absolute() ? given : workspace / given;
}

std::uint64_t timeout_of(const json::Value& args) {
    const json::Value* timeout = args.find("timeoutMs");
    if (timeout == nullptr || !timeout->is_number() || timeout->as_number() <= 0) return 0;
    return static_cast<std::uint64_t>(timeout->as_number());
}

json::Value outcome_reply(const proc::Outcome& outcome) {
    json::Value reply;
    reply.set("started", outcome.started);
    reply.set("exitCode", outcome.exit_code);
    reply.set("timedOut", outcome.timed_out);
    reply.set("out", outcome.out);
    reply.set("err", outcome.err);
    reply.set("launcher", outcome.launcher);
    return reply;
}

}

std::map<std::string, Primitive> make_primitives(std::filesystem::path workspace, CurrentLog current_log) {
    std::map<std::string, Primitive> primitives;
    primitives["run"] = [workspace](const json::Value& args) {
        const json::Value* argv = args.find("argv");
        if (argv == nullptr || !argv->is_array() || argv->as_array().empty())
            return failure("run needs argv, a non-empty array of strings");
        std::vector<std::string> words;
        for (const json::Value& word : argv->as_array()) {
            if (!word.is_string()) return failure("run needs argv, a non-empty array of strings");
            words.push_back(word.as_string());
        }
        const json::Value* stdin_text = args.find("stdin");
        const std::string input = stdin_text != nullptr && stdin_text->is_string() ? stdin_text->as_string() : "";
        return outcome_reply(proc::run(words, cwd_of(args, workspace), input, timeout_of(args)));
    };
    primitives["shell"] = [workspace](const json::Value& args) {
        const json::Value* command = args.find("command");
        if (command == nullptr || !command->is_string()) return failure("shell needs command, a string");
        return outcome_reply(proc::shell(command->as_string(), cwd_of(args, workspace), timeout_of(args)));
    };
    primitives["logAppend"] = [current_log](const json::Value& args) {
        const json::Value* kind = args.find("kind");
        if (kind == nullptr || !kind->is_string() || kind->as_string().empty())
            return failure("logAppend needs { kind, fields }, with kind a non-empty string");
        const json::Value* fields = args.find("fields");
        if (fields != nullptr && !fields->is_object()) return failure("logAppend needs { kind, fields }, with fields an object");
        const auto log = current_log ? current_log() : nullptr;
        if (log == nullptr) return failure("logAppend has no run log");
        const std::uint64_t seq = log->append(kind->as_string(), fields != nullptr ? *fields : json::Value(json::Object{}));
        json::Value reply;
        reply.set("ok", true);
        reply.set("seq", seq);
        return reply;
    };
    return primitives;
}

}
