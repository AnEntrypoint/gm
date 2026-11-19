#include "gm/host/browser_scope.hpp"

#include <algorithm>
#include <chrono>
#include <cstddef>
#include <cstdint>
#include <fstream>
#include <set>
#include <sstream>
#include <system_error>
#include <thread>
#include <utility>

#if defined(_WIN32)
#include <process.h>
#else
#include <unistd.h>
#endif

#include "gm/proc.hpp"

namespace gm::host {
namespace {

namespace fs = std::filesystem;

constexpr const char* kExecute = "playwriter_execute";
constexpr const char* kBrowsers = "playwriter_browsers";
constexpr double kMinExecuteTimeoutMs = 1000;
constexpr const char* kTabsFile = "browser-pages.txt";
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
const char* kPagesCode =
    "const cdp = await browser.newBrowserCDPSession(); const { targetInfos } = await cdp.send('Target.getTargets'); "
    "const { browserContextIds } = await cdp.send('Target.getBrowserContexts'); await cdp.detach(); "
    "const pages = targetInfos.filter((t) => t.type === 'page').map((t) => ({ id: t.targetId, url: t.url, title: t.title, context: t.browserContextId })); "
    "const owned = []; for (const p of [...(state.gmRunPages || [])].filter((q) => !q.isClosed())) { const s = await state.gmRun.newCDPSession(p); owned.push((await s.send('Target.getTargetInfo')).targetInfo.targetId); await s.detach(); } "
    "return 'GMPAGES' + JSON.stringify({ pages, created: browserContextIds, owned }) + 'GMPAGES';";
const char* kCloseCode =
    "let n = 0; if (state.gmRun) { try { const opened = [...(state.gmRunPages || [])].filter((p) => !p.isClosed()); "
    "for (const p of opened) { await p.close(); } n = opened.length; } finally { delete state.gmRun; delete state.gmRunFor; delete state.gmRunView; delete state.gmRunPages; } } return 'GMCLOSED' + n + 'GMCLOSED';";

std::string close_by_id_code(const std::string& id) {
    return "const wanted = " + json::quote(id) + "; let n = 0; for (const p of [...(state.gmRunPages || [])].filter((q) => !q.isClosed())) { "
           "const s = await state.gmRun.newCDPSession(p); const targetId = (await s.send('Target.getTargetInfo')).targetInfo.targetId; await s.detach(); "
           "if (targetId === wanted) { await p.close(); n += 1; } } "
           "if (n === 0) { const cdp = await browser.newBrowserCDPSession(); try { await cdp.send('Target.closeTarget', { targetId: wanted }); n += 1; } catch (error) { } finally { await cdp.detach(); } } "
           "return 'GMCLOSEDIDS' + n + 'GMCLOSEDIDS';";
}

std::string recorded_close_code(const std::vector<std::string>& recorded) {
    std::string ids;
    for (const std::string& id : recorded) {
        if (!ids.empty()) ids += ",";
        ids += json::quote(id);
    }
    return "const recorded = [" + ids + "]; let n = 0; const cdp = await browser.newBrowserCDPSession(); "
           "try { for (const targetId of recorded) { try { await cdp.send('Target.closeTarget', { targetId }); n += 1; } catch (error) { } } } finally { await cdp.detach(); } "
           "return 'GMCLOSEDIDS' + n + 'GMCLOSEDIDS';";
}

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

std::vector<std::string> strings_of(const json::Value* value) {
    std::vector<std::string> out;
    if (value == nullptr || !value->is_array()) return out;
    for (const json::Value& item : value->as_array()) {
        if (item.is_string()) out.push_back(item.as_string());
    }
    return out;
}

std::string join(const std::vector<std::string>& parts, std::string_view separator) {
    std::string out;
    for (std::size_t i = 0; i < parts.size(); ++i) {
        if (i > 0) out += std::string(separator);
        out += parts[i];
    }
    return out;
}

bool contains(const std::vector<std::string>& ids, const std::string& id) {
    return std::find(ids.begin(), ids.end(), id) != ids.end();
}

std::size_t count_of(const std::string& digits) {
    std::size_t value = 0;
    for (char c : digits) {
        if (c < '0' || c > '9') break;
        value = value * 10 + static_cast<std::size_t>(c - '0');
    }
    return value;
}

json::Value tabs_reply(std::string state, std::string text) {
    json::Value reply;
    reply.set("ok", true);
    reply.set("state", std::move(state));
    reply.set("text", std::move(text));
    return reply;
}

long long own_process() {
#if defined(_WIN32)
    return static_cast<long long>(_getpid());
#else
    return static_cast<long long>(::getpid());
#endif
}

struct Owner {
    long long pid = 0;
    long long start = 0;
    std::vector<std::string> ids;
};

Owner read_owner(const fs::path& file) {
    Owner owner;
    std::ifstream in(file);
    std::string line;
    for (bool first = true; std::getline(in, line); first = false) {
        if (line.empty()) continue;
        if (first && line.starts_with("owner ")) {
            std::istringstream fields(line.substr(6));
            fields >> owner.pid >> owner.start;
            continue;
        }
        owner.ids.push_back(line);
    }
    return owner;
}

void write_owner(const fs::path& file, const std::vector<std::string>& ids) {
    std::error_code ignored;
    if (ids.empty()) {
        fs::remove(file, ignored);
        return;
    }
    const long long pid = own_process();
    fs::path temp = file;
    temp += ".tmp";
    {
        std::ofstream out(temp, std::ios::trunc);
        out << "owner " << pid << ' ' << proc::start_time_of(pid) << '\n';
        for (const std::string& id : ids) out << id << '\n';
    }
    fs::rename(temp, file, ignored);
}

bool alive(const Owner& owner) {
    return owner.pid > 0 && owner.start != 0 && proc::start_time_of(owner.pid) == owner.start;
}

struct Others {
    std::size_t tabs = 0;
    std::size_t project = 0;
    std::vector<std::string> owners;
};

Others others_of(const fs::path& pages_file, const BrowserScope::Snapshot& snap, const std::vector<std::string>& own) {
    Others others;
    std::set<std::string> claimed(own.begin(), own.end());
    const fs::path own_dir = pages_file.parent_path();
    std::error_code ec;
    std::size_t unowned = 0;
    for (fs::directory_iterator it(own_dir.parent_path(), ec), end; !ec && it != end; it.increment(ec)) {
        if (!it->is_directory(ec) || it->path() == own_dir) continue;
        const Owner owner = read_owner(it->path() / kTabsFile);
        std::size_t count = 0;
        for (const BrowserScope::Page& page : snap.pages) {
            if (!contains(owner.ids, page.id)) continue;
            count += 1;
            claimed.insert(page.id);
        }
        if (count == 0) continue;
        others.tabs += count;
        others.owners.push_back("run " + it->path().filename().string() + " pid " + std::to_string(owner.pid) + (alive(owner) ? " running" : " not running") + ", " +
                                std::to_string(count) + " tab(s)");
    }
    for (const BrowserScope::Page& page : snap.pages) {
        if (claimed.count(page.id) > 0) continue;
        if (contains(snap.created, page.context)) {
            others.tabs += 1;
            unowned += 1;
        } else {
            others.project += 1;
        }
    }
    if (unowned > 0) others.owners.push_back("no owner record, " + std::to_string(unowned) + " tab(s)");
    return others;
}

std::string render(const std::vector<BrowserScope::Page>& rows, const Others& others) {
    std::string text = rows.empty() ? std::string("tabs: none in this run") : "tabs: " + std::to_string(rows.size()) + " in this run, safe to close on finish: ";
    for (std::size_t i = 0; i < rows.size(); ++i) {
        const BrowserScope::Page& row = rows[i];
        text += (i == 0 ? "" : "; ") + std::string("[") + row.id + "] " + head_chars(row.url, kUrlChars) + " \"" + head_chars(row.title, kTitleChars) + "\"";
    }
    if (others.tabs + others.project > 0) {
        text += "; not this run and not closable by it: " + std::to_string(others.tabs) + " in other runs";
        if (!others.owners.empty()) text += " (" + join(others.owners, "; ") + ")";
        text += " and " + std::to_string(others.project) + " in the project browser";
    }
    return text;
}

std::string describe(std::string_view when, const BrowserScope::Tally& tally) {
    if (!tally.known) return std::string(when) + " unavailable";
    return std::string(when) + " " + std::to_string(tally.ids.size()) + " [" + join(tally.ids, ", ") + "]";
}

void append_census(json::Value& reply, const BrowserScope::Tally& before, const BrowserScope::Tally& after) {
    const std::string line = "gm tabs: " + describe("at start", before) + "; " + describe("at end", after);
    const json::Value* output = reply.find("output");
    const std::string text = output != nullptr && output->is_string() ? output->as_string() : std::string();
    reply.set("output", text.empty() ? line : text + "\n" + line);
}

}

BrowserScope::BrowserScope(VerbTable& inner, std::filesystem::path pages_file) : inner_(inner), pages_file_(std::move(pages_file)) {}

std::vector<VerbInfo> BrowserScope::list() const {
    std::vector<VerbInfo> verbs = inner_.list();
    verbs.push_back({"browser_tabs",
                     "The tabs this run opened, each with its targetId, and the tabs of other runs counted with the run id and pid that own them. When nothing changed since the last call the reply says unchanged.",
                     R"json({"type":"object","properties":{}})json"});
    verbs.push_back({"browser_close_tab",
                     "Close one tab this run opened, by its targetId from browser_tabs. A tab of another run is refused.",
                     R"json({"type":"object","properties":{"targetId":{"type":"string"}},"required":["targetId"]})json"});
    verbs.push_back({"browser_close_run",
                     "Close this run's browser context and every tab in it. Other runs and other projects are not touched. finish calls it.",
                     R"json({"type":"object","properties":{}})json"});
    verbs.push_back({"browser_close_machine",
                     "Close the whole project browser, with every run's tabs. A separate explicit action that needs confirm true. playwriter_browsers close is run-scoped and never does this.",
                     R"json({"type":"object","properties":{"confirm":{"type":"boolean"},"target":{"type":"string"},"force":{"type":"boolean"}},"required":["confirm"]})json"});
    verbs.push_back({"playwriter_browsers",
                     "List the project browser with its browsers and tabs, or close this run's browser context with action close. action defaults to list. close is run-scoped; browser_close_machine closes the whole project browser.",
                     R"json({"type":"object","properties":{"action":{"type":"string","enum":["list","close"]}}})json"});
    return verbs;
}

json::Value BrowserScope::call(std::string_view name, const json::Value& args) {
    if (name == kExecute) return user_execute(args);
    if (name == kBrowsers) return browsers(args);
    if (name == "browser_tabs") return tabs();
    if (name == "browser_close_tab") return close_tab(args);
    if (name == "browser_close_run") return close_run();
    if (name == "browser_close_machine") return close_machine(args);
    return inner_.call(name, args);
}

json::Value BrowserScope::user_execute(const json::Value& args) {
    const json::Value* code_arg = args.find("code");
    if (code_arg == nullptr || !code_arg->is_string()) return inner_.call(kExecute, args);
    const std::string code = code_arg->as_string();
    if (const json::Value* timeout_arg = args.find("timeout"); timeout_arg != nullptr && timeout_arg->is_number() && timeout_arg->as_number() < kMinExecuteTimeoutMs) {
        return failure("timeout is in milliseconds: " + std::to_string(static_cast<long long>(timeout_arg->as_number())) + " is below 1000; the default is 10000");
    }
    std::string trimmed = code;
    while (!trimmed.empty() && (trimmed.back() == ';' || trimmed.back() == ' ' || trimmed.back() == '\n' || trimmed.back() == '\t' || trimmed.back() == '\r')) {
        trimmed.pop_back();
    }
    const bool single_expression = !trimmed.empty() && trimmed.find_first_of(";\n") == std::string::npos && trimmed.find("return") == std::string::npos;
    const bool parenthesized = !trimmed.empty() && trimmed.front() == '(' && trimmed.back() == ')';
    const std::string body = single_expression || parenthesized ? "return await (" + trimmed + ");" : code;
    json::Value forwarded = args;
    forwarded.set("code", std::string(kOpenRunContext) + body);
    bool had_browser = false;
    {
        std::lock_guard lock(mutex_);
        had_browser = used_;
        used_ = true;
    }
    const Tally before = had_browser ? census() : Tally{true, {}};
    json::Value reply = inner_.call(kExecute, forwarded);
    for (int attempt = 1; attempt < kGoneAttempts && json::dump(reply).find(kGoneMarker) != std::string::npos; ++attempt) {
        std::this_thread::sleep_for(std::chrono::milliseconds(kGoneBackoffMs << attempt));
        reply = inner_.call(kExecute, forwarded);
    }
    const Tally after = ok_of(reply) ? census() : Tally{};
    append_census(reply, before, after);
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
    if (action == nullptr) {
        json::Value listing = args;
        listing.set("action", "list");
        return browsers_call(listing);
    }
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
        write_recorded_pages({});
        used_ = false;
        last_view_.reset();
        last_count_ = 0;
    }
    return reply;
}

BrowserScope::Snapshot BrowserScope::snapshot() {
    Snapshot snap;
    json::Value request;
    request.set("code", kPagesCode);
    request.set("timeout", kBrowserTimeoutMs);
    json::Value reply = inner_.call(kExecute, request);
    if (!ok_of(reply)) {
        snap.error = output_of(reply);
        return snap;
    }
    const std::optional<std::string> body = between(output_of(reply), "GMPAGES");
    if (!body) {
        snap.error = "the browser answer had no tab view";
        return snap;
    }
    auto parsed = json::parse(*body);
    if (!parsed || !parsed->is_object()) {
        snap.error = "the tab view was not JSON";
        return snap;
    }
    if (const json::Value* pages = parsed->find("pages"); pages != nullptr && pages->is_array()) {
        for (const json::Value& row : pages->as_array()) {
            snap.pages.push_back({string_field(row, "id"), string_field(row, "url"), string_field(row, "title"), string_field(row, "context")});
        }
    }
    snap.created = strings_of(parsed->find("created"));
    snap.owned = strings_of(parsed->find("owned"));
    snap.ok = true;
    return snap;
}

void BrowserScope::record(const Snapshot& snap) const {
    const Owner mine = read_owner(pages_file_);
    std::vector<std::string> candidates = mine.ids;
    candidates.insert(candidates.end(), snap.owned.begin(), snap.owned.end());
    std::vector<std::string> keep;
    for (const std::string& id : candidates) {
        const bool live = std::any_of(snap.pages.begin(), snap.pages.end(), [&id](const Page& page) { return page.id == id; });
        if (live && !contains(keep, id)) keep.push_back(id);
    }
    write_owner(pages_file_, keep);
}

BrowserScope::Tally BrowserScope::census() {
    const Snapshot snap = snapshot();
    if (!snap.ok) return Tally{};
    record(snap);
    return Tally{true, recorded_pages()};
}

json::Value BrowserScope::tabs() {
    {
        std::lock_guard lock(mutex_);
        if (!used_) return tabs_reply("none", "tabs: none in this run");
    }
    const Snapshot snap = snapshot();
    if (!snap.ok) return tabs_reply("unavailable", "tabs: unavailable: " + head_chars(snap.error, kTitleChars));
    record(snap);
    const std::vector<std::string> own = recorded_pages();
    std::vector<Page> rows;
    for (const std::string& id : own) {
        for (const Page& page : snap.pages) {
            if (page.id == id) rows.push_back(page);
        }
    }
    const std::string text = render(rows, others_of(pages_file_, snap, own));
    std::lock_guard lock(mutex_);
    if (last_view_ && *last_view_ == text) {
        return tabs_reply("unchanged", "tabs: unchanged, " + std::to_string(last_count_) + " in this run");
    }
    last_view_ = text;
    last_count_ = rows.size();
    return tabs_reply("changed", text);
}

json::Value BrowserScope::close_tab(const json::Value& args) {
    const json::Value* target = args.find("targetId");
    if (target == nullptr || !target->is_string() || target->as_string().empty()) {
        return failure("browser_close_tab needs targetId, an id from browser_tabs");
    }
    const std::string id = target->as_string();
    const Snapshot snap = snapshot();
    if (!snap.ok) return failure("tabs are unavailable: " + head_chars(snap.error, kTitleChars));
    record(snap);
    std::vector<std::string> mine = recorded_pages();
    if (!contains(mine, id)) {
        return failure("target " + id + " is not a live tab this run opened; browser_close_tab closes only this run's own tabs");
    }
    json::Value request;
    request.set("code", close_by_id_code(id));
    request.set("timeout", kBrowserTimeoutMs);
    json::Value reply = inner_.call(kExecute, request);
    const std::optional<std::string> count = between(output_of(reply), "GMCLOSEDIDS");
    if (!ok_of(reply) || !count || count_of(*count) != 1) return failure("the tab " + id + " was not closed: " + output_of(reply));
    mine.erase(std::remove(mine.begin(), mine.end(), id), mine.end());
    write_recorded_pages(mine);
    json::Value closed;
    closed.set("ok", true);
    closed.set("closed", id);
    return closed;
}

json::Value BrowserScope::close_run() {
    const std::vector<std::string> recorded = recorded_pages();
    {
        std::lock_guard lock(mutex_);
        if (!used_ && recorded.empty()) {
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
    std::size_t closed_pages = count ? count_of(*count) : 0;
    if (!recorded.empty()) {
        json::Value recorded_request;
        recorded_request.set("code", recorded_close_code(recorded));
        recorded_request.set("timeout", kBrowserTimeoutMs);
        json::Value recorded_reply = inner_.call(kExecute, recorded_request);
        if (!ok_of(recorded_reply)) return failure("the pages this run recorded were not closed: " + output_of(recorded_reply));
        const std::optional<std::string> recorded_count = between(output_of(recorded_reply), "GMCLOSEDIDS");
        closed_pages += recorded_count ? count_of(*recorded_count) : 0;
        write_recorded_pages({});
    }
    json::Value closed;
    closed.set("ok", true);
    closed.set("closedPages", static_cast<std::uint64_t>(closed_pages));
    return closed;
}

std::vector<std::string> BrowserScope::recorded_pages() const {
    return read_owner(pages_file_).ids;
}

void BrowserScope::write_recorded_pages(const std::vector<std::string>& ids) const {
    write_owner(pages_file_, ids);
}

}
