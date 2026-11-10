#include "gm/runcode.hpp"

#include <algorithm>
#include <cctype>
#include <charconv>
#include <cstddef>
#include <exception>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <optional>
#include <string>
#include <system_error>
#include <vector>

#include "engine.hpp"

namespace gm {
namespace {

using engine::Engine;
using engine::Scoped;
using engine::Session;
namespace fs = std::filesystem;

json::Value args_from_js(JSContext* ctx, int argc, JSValueConst* argv) {
    if (argc < 1 || JS_IsUndefined(argv[0])) return json::Value(json::Object{});
    auto converted = engine::js_to_json(ctx, argv[0]);
    if (!converted || converted->is_null()) return json::Value(json::Object{});
    return std::move(*converted);
}

JSValue resolved_promise(JSContext* ctx, JSValue value) {
    JSValue resolving[2];
    JSValue promise = JS_NewPromiseCapability(ctx, resolving);
    if (JS_IsException(promise)) {
        JS_FreeValue(ctx, value);
        return promise;
    }
    JSValue settled = JS_Call(ctx, resolving[0], JS_UNDEFINED, 1, &value);
    JS_FreeValue(ctx, settled);
    JS_FreeValue(ctx, value);
    JS_FreeValue(ctx, resolving[0]);
    JS_FreeValue(ctx, resolving[1]);
    return promise;
}

std::size_t count_newlines(std::string_view text) {
    return static_cast<std::size_t>(std::count(text.begin(), text.end(), '\n'));
}

std::string load_error(const std::string& text, std::string_view body, std::size_t head, std::size_t removed) {
    constexpr std::string_view marker = "\n    at <body>:";
    const std::size_t at = text.find(marker);
    if (at == std::string::npos) return "the body does not load: " + text;
    const std::string message = "the body does not load: " + text.substr(0, at);
    const std::string_view rest = std::string_view(text).substr(at + marker.size());
    const char* end = rest.data() + rest.size();
    std::size_t line = 0;
    std::size_t column = 0;
    auto parsed_line = std::from_chars(rest.data(), end, line);
    if (parsed_line.ec != std::errc() || parsed_line.ptr == end || *parsed_line.ptr != ':') return message;
    if (std::from_chars(parsed_line.ptr + 1, end, column).ec != std::errc()) return message;
    const long long body_line = static_cast<long long>(line) - static_cast<long long>(head) + static_cast<long long>(removed);
    const long long body_lines = static_cast<long long>(count_newlines(body)) + 1;
    if (body_line < 1 || body_line > body_lines) return message;
    return message + " (line " + std::to_string(body_line) + ", column " + std::to_string(column) + ")";
}

std::optional<std::string> read_text(const fs::path& path) {
    std::ifstream in(path, std::ios::binary);
    if (!in) return std::nullopt;
    return std::string(std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>());
}

bool project_is_module(const fs::path& project_root) {
    const auto text = read_text(project_root / "package.json");
    if (!text) return false;
    auto parsed = json::parse(*text);
    if (!parsed) return false;
    const json::Value* type = parsed->find("type");
    return type != nullptr && type->is_string() && type->as_string() == "module";
}

JSValue call_verb(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv, int verb_index, JSValueConst*) {
    auto* session = engine::session_of(ctx);
    const std::string& name = session->gm_verb_list[static_cast<size_t>(verb_index)].name;
    json::Value args = args_from_js(ctx, argc, argv);
    json::Value reply;
    try {
        engine::HostPause paused(*session);
        reply = session->gm_verbs->call(name, args);
    } catch (const std::exception& err) {
        reply = engine::failed_reply(err.what());
    } catch (...) {
        reply = engine::failed_reply("the verb failed");
    }
    JSValue reply_js = engine::json_to_js(ctx, reply);
    if (JS_IsException(reply_js)) return reply_js;
    return resolved_promise(ctx, reply_js);
}

std::string verbs_json(const std::vector<VerbInfo>& verb_list) {
    json::Value list(json::Array{});
    for (const auto& verb : verb_list) {
        json::Value entry;
        entry.set("name", verb.name);
        entry.set("description", verb.description);
        auto schema = json::parse(verb.input_schema_json.empty() ? std::string_view("{}") : verb.input_schema_json);
        entry.set("inputSchema", schema ? std::move(*schema) : json::Value(json::Object{}));
        list.push(std::move(entry));
    }
    return json::dump(list);
}

JSValue console_write(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
    auto* session = engine::session_of(ctx);
    if (argc < 1 || session->console == nullptr) return JS_UNDEFINED;
    size_t length = 0;
    const char* text = JS_ToCStringLen(ctx, &length, argv[0]);
    if (text == nullptr) return JS_EXCEPTION;
    session->console->add(std::string_view(text, length));
    JS_FreeCString(ctx, text);
    return JS_UNDEFINED;
}

constexpr std::string_view gm_bootstrap = R"JS((function (gm, verbsText, sink) {
  const show = (value) => {
    if (typeof value === 'string') return value;
    if (value !== null && typeof value === 'object') {
      try {
        return JSON.stringify(value) ?? String(value);
      } catch {
        return String(value);
      }
    }
    return String(value);
  };
  const write = (...args) => sink(args.map(show).join(' '));
  globalThis.console = { log: write, info: write, debug: write, warn: write, error: write };
  const verbs = JSON.parse(verbsText);
  const shape = 'gm.verbs() takes { name: <verb name> } or { names: true }';
  const failed = (error) => ({ ok: false, error });
  const all = () => verbs.map((verb) => ({ ...verb }));
  function verbsOf(options) {
    if (options === undefined) return all();
    if (options === null || typeof options !== 'object' || Array.isArray(options)) return failed(shape);
    const keys = Object.keys(options);
    const unknown = keys.find((key) => key !== 'name' && key !== 'names');
    if (unknown !== undefined) return failed(`gm.verbs() does not take ${unknown}`);
    if (keys.includes('names') && options.names !== true) return failed('gm.verbs() takes { names: true }');
    if (keys.length === 0) return all();
    if (keys.length === 1 && options.names === true) return verbs.map((verb) => verb.name);
    if (keys.length === 1 && typeof options.name === 'string') {
      const found = verbs.find((verb) => verb.name === options.name);
      if (found === undefined) throw new Error(`unknown verb: ${options.name}`);
      return { ...found };
    }
    return failed(shape);
  }
  gm.verbs = verbsOf;
  gm.try = async (fn) => {
    try {
      return await fn();
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  };
}))JS";

deoxidene::Result<JSValue, std::string> make_gm(Engine& engine, const std::filesystem::path& project_root) {
    JSContext* ctx = engine.ctx();
    const auto& verb_list = engine.session().gm_verb_list;
    Scoped gm(ctx, JS_NewObject(ctx));
    for (size_t index = 0; index < verb_list.size(); ++index) {
        JSValue fn = JS_NewCFunctionData(ctx, call_verb, 1, static_cast<int>(index), 0, nullptr);
        JS_DefinePropertyValueStr(ctx, gm.get(), verb_list[index].name.c_str(), fn, JS_PROP_C_W_E);
    }
    std::string project = project_root.string();
    JS_SetPropertyStr(ctx, gm.get(), "project", JS_NewStringLen(ctx, project.data(), project.size()));
    Scoped install(ctx, JS_Eval(ctx, gm_bootstrap.data(), gm_bootstrap.size(), "<gm>", JS_EVAL_TYPE_GLOBAL));
    if (JS_IsException(install.get())) return deoxidene::Err<std::string>(engine::take_exception_text(engine));
    std::string verbs_text = verbs_json(verb_list);
    Scoped sink(ctx, JS_NewCFunction(ctx, console_write, "sink", 1));
    JSValue install_args[3] = {gm.get(), JS_NewStringLen(ctx, verbs_text.data(), verbs_text.size()), sink.get()};
    Scoped installed(ctx, JS_Call(ctx, install.get(), JS_UNDEFINED, 3, install_args));
    JS_FreeValue(ctx, install_args[1]);
    if (JS_IsException(installed.get())) return deoxidene::Err<std::string>(engine::take_exception_text(engine));
    return gm.take();
}

constexpr std::string_view require_bootstrap = R"JS((function (readText, root) {
  const cache = new Map();
  const dirOf = (path) => path.slice(0, path.lastIndexOf('/')) || '/';
  const normal = (path) => {
    const parts = [];
    for (const part of path.split('/')) {
      if (part === '' || part === '.') continue;
      if (part === '..') parts.pop();
      else parts.push(part);
    }
    return '/' + parts.join('/');
  };
  const exists = (path) => readText(path) !== null;
  const asFile = (path) => [path, path + '.js', path + '.cjs', path + '.json', path + '/index.js', path + '/index.cjs', path + '/index.json'].find(exists);
  const asPackage = (dir) => {
    const manifest = readText(dir + '/package.json');
    const main = manifest === null ? undefined : JSON.parse(manifest).main;
    return (main !== undefined && asFile(normal(dir + '/' + main))) || asFile(dir);
  };
  const resolve = (spec, base) => {
    if (spec.startsWith('/') || spec.startsWith('./') || spec.startsWith('../')) return asFile(normal(spec.startsWith('/') ? spec : base + '/' + spec));
    for (let dir = base; ; dir = dirOf(dir)) {
      const found = asPackage(normal(dir + '/node_modules/' + spec));
      if (found) return found;
      if (dir === '/') return undefined;
    }
  };
  const load = (file) => {
    if (cache.has(file)) return cache.get(file).exports;
    const source = readText(file);
    if (file.endsWith('.json')) {
      const value = JSON.parse(source);
      cache.set(file, { exports: value });
      return value;
    }
    const module = { exports: {} };
    cache.set(file, module);
    const wrapper = (0, eval)('(function (exports, require, module, __filename, __dirname) {' + source + '\n})');
    wrapper.call(module.exports, module.exports, requireFrom(dirOf(file)), module, file, dirOf(file));
    return module.exports;
  };
  const requireFrom = (base) => (spec) => {
    if (typeof spec !== 'string') throw new TypeError('require needs a string path');
    const file = resolve(spec, base);
    if (file === undefined) throw new Error(`Cannot find module '${spec}'`);
    return load(file);
  };
  return requireFrom(root);
}))JS";

JSValue read_text_call(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
    if (argc < 1 || !JS_IsString(argv[0])) return JS_NULL;
    size_t length = 0;
    const char* text = JS_ToCStringLen(ctx, &length, argv[0]);
    if (text == nullptr) return JS_EXCEPTION;
    const std::string path(text, length);
    JS_FreeCString(ctx, text);
    std::error_code ec;
    if (!fs::is_regular_file(path, ec)) return JS_NULL;
    auto content = read_text(path);
    if (!content) return JS_NULL;
    return JS_NewStringLen(ctx, content->data(), content->size());
}

deoxidene::Result<JSValue, std::string> make_require(Engine& engine, const std::filesystem::path& project_root) {
    JSContext* ctx = engine.ctx();
    Scoped factory(ctx, JS_Eval(ctx, require_bootstrap.data(), require_bootstrap.size(), "<require>", JS_EVAL_TYPE_GLOBAL));
    if (JS_IsException(factory.get())) return deoxidene::Err<std::string>(engine::take_exception_text(engine));
    Scoped reader(ctx, JS_NewCFunction(ctx, read_text_call, "readText", 1));
    std::string root = project_root.generic_string();
    Scoped root_value(ctx, JS_NewStringLen(ctx, root.data(), root.size()));
    JSValue factory_args[2] = {reader.get(), root_value.get()};
    Scoped require(ctx, JS_Call(ctx, factory.get(), JS_UNDEFINED, 2, factory_args));
    if (JS_IsException(require.get())) return deoxidene::Err<std::string>(engine::take_exception_text(engine));
    return require.take();
}

bool is_quote(char c) { return c == '\'' || c == '"'; }

bool is_space(char c) { return std::isspace(static_cast<unsigned char>(c)) != 0; }

std::string_view trim_left(std::string_view text) {
    while (!text.empty() && is_space(text.front())) text.remove_prefix(1);
    return text;
}

std::string_view trim_right(std::string_view text) {
    while (!text.empty() && is_space(text.back())) text.remove_suffix(1);
    return text;
}

bool starts_import(std::string_view line) {
    const std::string_view text = trim_left(line);
    return text.starts_with("import") && text.size() > 6 && is_space(text[6]);
}

bool is_code_line(std::string_view line) {
    const std::string_view text = trim_left(line);
    return !text.empty() && !text.starts_with("//");
}

bool closes_import(std::string_view line) {
    std::string_view text = trim_right(line);
    if (text.ends_with(';')) text = trim_right(text.substr(0, text.size() - 1));
    if (text.size() < 3 || !is_quote(text.back())) return false;
    const std::size_t open = text.find_last_of("'\"", text.size() - 2);
    return open != std::string_view::npos && open + 1 < text.size() - 1;
}

bool is_local_specifier(std::string_view path) {
    return path.starts_with("/") || path.starts_with("./") || path.starts_with("../");
}

std::string absolute_specifiers(const std::string& statement, const fs::path& project) {
    std::string out;
    std::size_t at = 0;
    while (at < statement.size()) {
        if (is_quote(statement[at])) {
            const std::size_t close = statement.find_first_of("'\"", at + 1);
            if (close != std::string::npos && statement[close] == statement[at]) {
                const std::string_view path = std::string_view(statement).substr(at + 1, close - at - 1);
                if (is_local_specifier(path)) {
                    const std::string quote(1, statement[at]);
                    out += quote + (project / fs::path(path)).lexically_normal().generic_string() + quote;
                    at = close + 1;
                    continue;
                }
            }
        }
        out += statement[at];
        at += 1;
    }
    return out;
}

std::string join_lines(const std::vector<std::string>& lines) {
    std::string out;
    for (std::size_t i = 0; i < lines.size(); ++i) {
        if (i > 0) out += '\n';
        out += lines[i];
    }
    return out;
}

struct ModuleSplit {
    std::string imports;
    std::string code;
    std::size_t removed_lines;
};

deoxidene::Result<ModuleSplit, std::string> split_module_body(std::string_view body, const fs::path& project) {
    std::vector<std::string> statements;
    std::vector<std::string> code;
    std::optional<std::string> pending;
    bool started = false;
    std::size_t from = 0;
    for (;;) {
        const std::size_t newline = body.find('\n', from);
        const std::string line(body.substr(from, newline == std::string_view::npos ? std::string_view::npos : newline - from));
        if (pending) {
            *pending += "\n" + line;
            if (closes_import(line)) {
                statements.push_back(std::move(*pending));
                pending.reset();
            }
        } else if (!started && starts_import(line)) {
            if (closes_import(line)) statements.push_back(line);
            else pending = line;
        } else {
            if (is_code_line(line)) started = true;
            code.push_back(line);
        }
        if (newline == std::string_view::npos) break;
        from = newline + 1;
    }
    if (pending) return deoxidene::Err<std::string>("an import statement is not closed");
    for (std::string& statement : statements) statement = absolute_specifiers(statement, project);
    const std::string code_text = join_lines(code);
    ModuleSplit split{join_lines(statements), code_text, count_newlines(body) - count_newlines(code_text)};
    return split;
}

deoxidene::Result<JSValue, std::string> load_script_body(Engine& engine, std::string_view body) {
    JSContext* ctx = engine.ctx();
    std::string source = "(async function body(gm, require, tjs) {\n";
    source.append(body);
    source.append("\n})");
    JSValue function = JS_Eval(ctx, source.c_str(), source.size(), "<body>", JS_EVAL_TYPE_GLOBAL);
    if (JS_IsException(function)) return deoxidene::Err<std::string>(load_error(engine::take_exception_text(engine), body, 1, 0));
    return function;
}

deoxidene::Result<JSValue, std::string> load_module_body(Engine& engine, std::string_view body, const fs::path& project_root) {
    using Fail = deoxidene::Err<std::string>;
    JSContext* ctx = engine.ctx();
    auto split = split_module_body(body, project_root);
    if (!split) return Fail("the body does not load: " + split.error());
    const std::string source = split->imports + "\nexport default async function body(gm, require, tjs) {\n" + split->code + "\n}\n";
    const std::size_t head = count_newlines(split->imports) + 2;
    Scoped compiled(ctx, JS_Eval(ctx, source.c_str(), source.size(), "<body>", JS_EVAL_TYPE_MODULE | JS_EVAL_FLAG_COMPILE_ONLY));
    if (JS_IsException(compiled.get())) return Fail(load_error(engine::take_exception_text(engine), body, head, split->removed_lines));
    auto ns = engine::module_namespace(engine, compiled.take());
    if (!ns) return Fail("the body does not load: " + ns.error());
    Scoped namespace_value(ctx, *ns);
    JSValue body_function = JS_GetPropertyStr(ctx, namespace_value.get(), "default");
    if (JS_IsException(body_function)) return Fail(engine::take_exception_text(engine));
    return body_function;
}

}

deoxidene::Result<json::Value, std::string> run_body(VerbTable& verbs, std::string_view body,
                                                     const std::filesystem::path& project_root, std::string_view format,
                                                     BodyControlsPtr controls) {
    using Fail = deoxidene::Err<std::string>;
    if (body.find_first_not_of(" \t\r\n") == std::string_view::npos) return Fail("body must be a non-empty string");

    if (!controls) controls = thread_body_controls();
    if (!controls) controls = std::make_shared<BodyControls>();
    Session session;
    session.gm_verbs = &verbs;
    session.gm_verb_list = verbs.list();
    session.cancel = &controls->stopped;
    session.console = &controls->console;
    session.js_budget = controls->js_budget;
    session.deadline_budget = controls->js_budget;
    session.started = std::chrono::steady_clock::now();
    Engine engine(session);
    if (!engine.ready()) return Fail("the JavaScript runtime did not start");
    JSContext* ctx = engine.ctx();

    auto gm = make_gm(engine, project_root);
    if (!gm) return Fail(gm.error());
    Scoped gm_value(ctx, *gm);
    auto require = make_require(engine, project_root);
    if (!require) return Fail(require.error());
    Scoped require_value(ctx, *require);

    const bool esm = format.empty() ? project_is_module(project_root) : format == "esm";
    if (!esm) {
        auto split = split_module_body(body, project_root);
        if (split && !split->imports.empty()) return Fail("refused: a CommonJS body cannot use a static import; use format esm");
    }
    auto loaded = esm ? load_module_body(engine, body, project_root) : load_script_body(engine, body);
    if (!loaded) return Fail(loaded.error());
    Scoped function(ctx, *loaded);

    JSValue call_args[2] = {gm_value.get(), require_value.get()};
    engine::Settled settled = engine::settle(engine, JS_Call(ctx, function.get(), JS_UNDEFINED, 2, call_args));
    Scoped value(ctx, settled.value);
    if (settled.outcome == engine::Outcome::Rejected) return Fail(engine::deadline_or(engine, engine::error_text(ctx, value.get())));
    if (settled.outcome == engine::Outcome::Pending) return Fail("the body stopped before it returned");

    auto converted = engine::js_to_json(ctx, value.get());
    if (!converted) return Fail(converted.error());
    return std::move(*converted);
}

}

namespace gm {

void ConsoleBuffer::add(std::string_view text) {
    if (text.size() > kLineBytes) {
        std::size_t cut = kLineBytes;
        while (cut > 0 && (static_cast<unsigned char>(text[cut]) & 0xC0) == 0x80) cut -= 1;
        text = text.substr(0, cut);
    }
    if (lines.size() >= kLines || bytes + text.size() > kBytes) {
        dropped += 1;
        return;
    }
    lines.emplace_back(text);
    bytes += text.size();
}

}
