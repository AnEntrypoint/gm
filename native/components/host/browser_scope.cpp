#include "gm/host/browser_scope.hpp"

#include <chrono>
#include <cstddef>
#include <cstdint>
#include <thread>

namespace gm::host {
namespace {

constexpr const char* kExecute = "playwriter_execute";
constexpr const char* kBrowsers = "playwriter_browsers";
constexpr std::size_t kTitleChars = 80;
constexpr std::size_t kUrlChars = 200;
constexpr int kBrowserTimeoutMs = 10000;
constexpr const char* kGoneMarker = "gm-browser-gone-before-body";
constexpr int kGoneAttempts = 5;
constexpr int kGoneBackoffMs = 250;

const char* kOpenRunContext =
    "{ if (typeof browser.isConnected === 'function' && !browser.isConnected()) throw new Error('gm-browser-gone-before-body: the project browser stopped under this executor, before the body ran; the host resends the call'); "
    "const sleep = (ms) => new Promise((done) => setTimeout(done, ms)); "
    "const live = async () => { let last = null; for (let attempt = 0; attempt < 5; attempt += 1) { for (const c of browser.contexts()) { try { const open = c.pages().find((p) => !p.isClosed()); return { home: c, page: open || await c.newPage() }; } catch (e) { last = e; } } try { const fresh = await browser.newContext(); try { return { home: fresh, page: await fresh.newPage() }; } catch (e) { last = e; await fresh.close().catch(() => {}); } } catch (e) { last = e; } await sleep(200 * 2 ** attempt); } throw new Error('gm-browser-gone-before-body: no listed context takes a page: ' + String(last && last.message)); }; "
    "const gmNewPage = async (first, args) => { let last = null; for (let attempt = 0; attempt < 5; attempt += 1) { const order = [first, ...browser.contexts()].filter((c, i, all) => c && all.indexOf(c) === i); for (const c of order) { try { return await c.newPage(...args); } catch (e) { last = e; } } try { const fresh = await browser.newContext(); try { return await fresh.newPage(...args); } catch (e) { last = e; await fresh.close().catch(() => {}); } } catch (e) { last = e; } await sleep(200 * 2 ** attempt); } throw last || new Error('no browser context accepted a new page'); }; "
    "if (!state.gmPage || state.gmPage.isClosed() || !state.gmProject) { const got = await live(); state.gmProject = got.home; state.gmPage = got.page; } "
    "if (!state.gmRun || state.gmRunFor !== state.gmProject) { const home = state.gmProject; state.gmRun = home; state.gmRunFor = home; state.gmRun.setDefaultTimeout(60000); state.gmRun.setDefaultNavigationTimeout(10000); "
    "const owned = state.gmRunPages = state.gmRunPages || new Set(); "
    "state.gmRunView = new Proxy(home, { get(target, key) { if (key === 'newPage') return async (...args) => { const made = await gmNewPage(state.gmProject, args); owned.add(made); return made; }; const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value; } }); } } "
    "var page = state.gmPage; context = state.gmRunView; ";
const char* kTabsCode =
    "const cdp = await browser.newBrowserCDPSession(); const { targetInfos } = await cdp.send('Target.getTargets'); "
    "const { browserContextIds } = await cdp.send('Target.getBrowserContexts'); const created = new Set(browserContextIds); "
    "const rows = []; const own = new Set(); const owned = [...(state.gmRunPages || [])].filter((p) => !p.isClosed()); "
    "if (!state.gmTabIds) { state.gmTabIds = new WeakMap(); state.gmTabSeq = 0; } "
    "for (const p of owned) { const s = await state.gmRun.newCDPSession(p); own.add((await s.send('Target.getTargetInfo')).targetInfo.targetId); await s.detach(); "
    "let id = state.gmTabIds.get(p); if (id === undefined) { state.gmTabSeq += 1; id = 't' + state.gmTabSeq; state.gmTabIds.set(p, id); } rows.push({ id, url: p.url(), title: await p.title().catch(() => '') }); } "
    "const counts = { otherRuns: 0, projectTabs: 0 }; "
    "for (const t of targetInfos) { if (t.type !== 'page' || own.has(t.targetId)) continue; "
    "if (created.has(t.browserContextId)) counts.otherRuns += 1; else counts.projectTabs += 1; } "
    "await cdp.detach(); return 'GMTABS' + JSON.stringify({ rows, counts }) + 'GMTABS';";
const char* kCloseCode =
    "let n = 0; if (state.gmRun) { try { const opened = [...(state.gmRunPages || [])].filter((p) => !p.isClosed()); "
    "for (const p of opened) { await p.close(); } n = opened.length; } finally { delete state.gmRun; delete state.gmRunFor; delete state.gmRunView; delete state.gmRunPages; } } return 'GMCLOSED' + n + 'GMCLOSED';";

json::Value failure(std::string message) {
    json::Value reply;
    reply.set("ok", false);
    reply.set("error", std::move(message));
    return reply;
}

bool ok_of(const json::Value& reply) {
    const json::Value* ok = reply.find("ok");
    return ok != nullptr && ok->is_bool() && ok->as_bool();
}

std::string output_of(const json::Value& reply) {
    const json::Value* output = reply.find("output");
    if (output != nullptr && output->is_string()) return output->as_string();
    const json::Value* error = reply.find("error");
    if (error != nullptr && error->is_string()) return error->as_string();
    return "the browser did not answer";
}

std::optional<std::string> between(const std::string& text, std::string_view mark) {
    const std::size_t first = text.find(mark);
    if (first == std::string::npos) return std::nullopt;
    const std::size_t start = first + mark.size();
    const std::size_t last = text.rfind(mark);
    if (last == std::string::npos || last < start) return std::nullopt;
    return text.substr(start, last - start);
}

std::string head_chars(const std::string& text, std::size_t bytes) {
    if (text.size() <= bytes) return text;
    std::size_t cut = bytes;
    while (cut > 0 && (static_cast<unsigned char>(text[cut]) & 0xC0) == 0x80) cut -= 1;
    return text.substr(0, cut) + "...";
}

std::string string_field(const json::Value& object, std::string_view key) {
    const json::Value* value = object.find(key);
    return value != nullptr && value->is_string() ? value->as_string() : std::string();
}

std::size_t number_field(const json::Value& object, std::string_view key) {
    const json::Value* value = object.find(key);
    return value != nullptr && value->is_number() ? static_cast<std::size_t>(value->as_number()) : 0;
}

std::string render_view(const json::Value& view, std::size_t& count) {
    const json::Value* rows = view.find("rows");
    const json::Value* counts = view.find("counts");
    std::string listed;
    count = 0;
    if (rows != nullptr && rows->is_array()) {
        for (const json::Value& row : rows->as_array()) {
            count += 1;
            const std::string id = string_field(row, "id");
            listed += (count == 1 ? "" : "; ") + std::string("[") + (id.empty() ? std::to_string(count) : id) + "] " +
                      head_chars(string_field(row, "url"), kUrlChars) + " \"" + head_chars(string_field(row, "title"), kTitleChars) + "\"";
        }
    }
    std::string text = count == 0 ? std::string("tabs: none in this run")
                                  : "tabs: " + std::to_string(count) + " in this run, safe to close on finish: " + listed;
    if (counts != nullptr && counts->is_object()) {
        const std::size_t other_runs = number_field(*counts, "otherRuns");
        const std::size_t project_tabs = number_field(*counts, "projectTabs");
        if (other_runs + project_tabs > 0) {
            text += "; not this run and not closable by it: " + std::to_string(other_runs) + " in other runs and " +
                    std::to_string(project_tabs) + " in the project browser";
        }
    }
    return text;
}

json::Value tabs_reply(std::string state, std::string text) {
    json::Value reply;
    reply.set("ok", true);
    reply.set("state", std::move(state));
    reply.set("text", std::move(text));
    return reply;
}

std::size_t count_of(const std::string& digits) {
    std::size_t value = 0;
    for (char c : digits) {
        if (c < '0' || c > '9') break;
        value = value * 10 + static_cast<std::size_t>(c - '0');
    }
    return value;
}

}

BrowserScope::BrowserScope(VerbTable& inner) : inner_(inner) {}

std::vector<VerbInfo> BrowserScope::list() const {
    std::vector<VerbInfo> verbs = inner_.list();
    verbs.push_back({"browser_tabs",
                     "The tabs this run opened in its own browser context, listed with url and title, and the other tabs of this project browser counted but not listed. When nothing changed since the last call the reply says unchanged.",
                     R"json({"type":"object","properties":{}})json"});
    verbs.push_back({"browser_close_run",
                     "Close this run's browser context and every tab in it. Other runs and other projects are not touched. finish calls it.",
                     R"json({"type":"object","properties":{}})json"});
    verbs.push_back({"browser_close_machine",
                     "Close the whole project browser, with every run's tabs. A separate explicit action that needs confirm true. playwriter_browsers close is run-scoped and never does this.",
                     R"json({"type":"object","properties":{"confirm":{"type":"boolean"},"target":{"type":"string"},"force":{"type":"boolean"}},"required":["confirm"]})json"});
    return verbs;
}

json::Value BrowserScope::call(std::string_view name, const json::Value& args) {
    if (name == kExecute) return user_execute(args);
    if (name == kBrowsers) return browsers(args);
    if (name == "browser_tabs") return tabs();
    if (name == "browser_close_run") return close_run();
    if (name == "browser_close_machine") return close_machine(args);
    return inner_.call(name, args);
}

json::Value BrowserScope::user_execute(const json::Value& args) {
    const json::Value* code_arg = args.find("code");
    if (code_arg == nullptr || !code_arg->is_string()) return inner_.call(kExecute, args);
    const std::string code = code_arg->as_string();
    std::string trimmed = code;
    while (!trimmed.empty() && (trimmed.back() == ';' || trimmed.back() == ' ' || trimmed.back() == '\n' || trimmed.back() == '\t' || trimmed.back() == '\r')) {
        trimmed.pop_back();
    }
    const bool single_expression = !trimmed.empty() && trimmed.find_first_of(";\n") == std::string::npos && trimmed.find("return") == std::string::npos;
    const bool parenthesized = !trimmed.empty() && trimmed.front() == '(' && trimmed.back() == ')';
    const std::string body = single_expression || parenthesized ? "return await (" + trimmed + ");" : code;
    json::Value forwarded = args;
    forwarded.set("code", std::string(kOpenRunContext) + body);
    {
        std::lock_guard lock(mutex_);
        used_ = true;
    }
    json::Value reply = inner_.call(kExecute, forwarded);
    for (int attempt = 1; attempt < kGoneAttempts && json::dump(reply).find(kGoneMarker) != std::string::npos; ++attempt) {
        std::this_thread::sleep_for(std::chrono::milliseconds(kGoneBackoffMs << attempt));
        reply = inner_.call(kExecute, forwarded);
    }
    return reply;
}

json::Value BrowserScope::call_sibling(std::string_view sibling, std::string_view tool, const json::Value& args) {
    return inner_.call_sibling(sibling, tool, args);
}

json::Value BrowserScope::browsers_call(const json::Value& args) {
    for (const VerbInfo& verb : inner_.list()) {
        if (verb.name == kBrowsers) return inner_.call(kBrowsers, args);
    }
    return inner_.call_sibling(kExecute, "browsers", args);
}

json::Value BrowserScope::browsers(const json::Value& args) {
    const json::Value* action = args.find("action");
    if (action != nullptr && action->is_string() && action->as_string() == "close") return close_run();
    return browsers_call(args);
}

json::Value BrowserScope::close_machine(const json::Value& args) {
    const json::Value* confirm = args.find("confirm");
    if (confirm == nullptr || !confirm->is_bool() || !confirm->as_bool()) {
        return failure("browser_close_machine needs confirm true: it closes the whole project browser, with every run's tabs in it");
    }
    json::Value request;
    request.set("action", "close");
    const json::Value* target = args.find("target");
    request.set("target", target != nullptr && target->is_string() ? target->as_string() : std::string("project"));
    const json::Value* force = args.find("force");
    request.set("force", force != nullptr && force->is_bool() && force->as_bool());
    json::Value reply = browsers_call(request);
    if (ok_of(reply)) {
        std::lock_guard lock(mutex_);
        used_ = false;
        last_view_.reset();
        last_count_ = 0;
    }
    return reply;
}

json::Value BrowserScope::tabs() {
    {
        std::lock_guard lock(mutex_);
        if (!used_) return tabs_reply("none", "tabs: none in this run");
    }
    json::Value request;
    request.set("code", kTabsCode);
    request.set("timeout", kBrowserTimeoutMs);
    json::Value reply = inner_.call(kExecute, request);
    if (!ok_of(reply)) return tabs_reply("unavailable", "tabs: unavailable: " + head_chars(output_of(reply), kTitleChars));
    const std::optional<std::string> body = between(output_of(reply), "GMTABS");
    if (!body) return tabs_reply("unavailable", "tabs: unavailable: the browser answer had no tab view");
    auto parsed = json::parse(*body);
    if (!parsed) return tabs_reply("unavailable", "tabs: unavailable: the tab view was not JSON");
    std::size_t count = 0;
    const std::string text = render_view(*parsed, count);
    std::lock_guard lock(mutex_);
    if (last_view_ && *last_view_ == text) {
        return tabs_reply("unchanged", "tabs: unchanged, " + std::to_string(last_count_) + " in this run");
    }
    last_view_ = text;
    last_count_ = count;
    return tabs_reply("changed", text);
}

json::Value BrowserScope::close_run() {
    {
        std::lock_guard lock(mutex_);
        if (!used_) {
            json::Value reply;
            reply.set("ok", true);
            reply.set("closedPages", 0);
            reply.set("skipped", true);
            return reply;
        }
    }
    json::Value request;
    request.set("code", kCloseCode);
    request.set("timeout", kBrowserTimeoutMs);
    json::Value reply = inner_.call(kExecute, request);
    std::lock_guard lock(mutex_);
    used_ = false;
    last_view_.reset();
    last_count_ = 0;
    if (!ok_of(reply)) return failure("this run's browser context was not closed: " + output_of(reply));
    const std::optional<std::string> count = between(output_of(reply), "GMCLOSED");
    json::Value closed;
    closed.set("ok", true);
    closed.set("closedPages", static_cast<std::uint64_t>(count ? count_of(*count) : 0));
    return closed;
}

}
