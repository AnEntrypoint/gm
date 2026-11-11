#include "gm/tool.hpp"

#include <chrono>
#include <filesystem>
#include <fstream>
#include <system_error>

namespace gm::tool {
namespace {

const std::string kBody = R"js(
const add = await gm.prd_add({ title: 'first item', body: 'b' });
const id = add.output;
const steps = { add: add.ok, id };
steps.list = (await gm.prd_list({})).output;
steps.park = (await gm.prd_park({ id, reason: 'waiting' })).output;
steps.parked = (await gm.prd_list({ status: 'parked' })).output;
steps.defaultWhileParked = (await gm.prd_list({})).output;
steps.reopen = (await gm.prd_reopen({ id })).output;
steps.receipt = (await gm.prd_receipt({ id, witness: 'w1' })).output;
steps.receipts = (await gm.prd_list({ status: 'all' })).output;
steps.refute = (await gm.prd_refute({ id, reason: 'no longer true' })).output;
steps.refuted = (await gm.prd_list({ status: 'refuted' })).output;
steps.reopenRefuted = (await gm.prd_reopen({ id, from: 'refuted', reason: 'again' })).output;
steps.questionAdd = (await gm.unknown_add({ title: 'why' })).output;
steps.questions = (await gm.unknown_list({})).output;
const gone = await gm.prd_add({ title: 'drop me' });
steps.delete = (await gm.prd_delete({ id: gone.output })).output;
steps.resolve = (await gm.prd_resolve({ id, witness: 'checked   by  hand', push: false })).output;
steps.afterResolve = (await gm.prd_list({ status: 'resolved' })).output;
steps.legacyOpen = (await gm.prd_list({ status: 'open' })).output;
steps.legacyPending = (await gm.prd_list({ status: 'pending' })).output;
steps.legacyAll = (await gm.prd_list({ status: 'all' })).output;
steps.unknownOpen = (await gm.unknown_list({ status: 'open' })).output;
steps.badStatus = (await gm.prd_list({ status: 'bogus' })).error;
steps.noTitle = (await gm.prd_add({})).error;
return JSON.stringify(steps);
)js";

std::filesystem::path make_workspace() {
    const auto stamp = std::chrono::steady_clock::now().time_since_epoch().count();
    auto root = std::filesystem::temp_directory_path() / ("gm-rows-" + std::to_string(stamp));
    std::filesystem::create_directories(root / "ws");
    return root;
}

bool contains(const std::string& text, const std::string& word) { return text.find(word) != std::string::npos; }

}

CheckResult check_rows(const std::string& binary) {
    CheckResult result;
    const auto sandbox = make_workspace();
    const auto workspace = sandbox / "ws";
    std::ofstream(workspace / ".keep") << "";
    std::filesystem::create_directories(workspace / ".gm" / "prd");
    std::ofstream(workspace / ".gm" / "prd" / "legacy-no-kind.yml") << "id: legacy-no-kind\nstatus: pending\nsubject: Drain the legacy PRD rows\n";
    proc::run({"git", "init", "-q"}, workspace);
    proc::run({"git", "config", "user.name", "lanmower"}, workspace);
    proc::run({"git", "config", "user.email", "lanmower@users.noreply.github.com"}, workspace);
    proc::run({"git", "-c", "user.name=lanmower", "-c", "user.email=lanmower@users.noreply.github.com", "commit", "-q", "--allow-empty", "-m", "seed"}, workspace);
    std::string text;
    {
        Session session(binary, workspace, sandbox);
        if (!session.started()) result.failures.push_back("gm serve did not start from " + binary);
        if (session.started()) {
            session.rpc("initialize", json::Object{{"protocolVersion", "2025-06-18"}, {"capabilities", json::Object{}},
                                                  {"clientInfo", json::Object{{"name", "gm-tool"}, {"version", "1"}}}});
            session.notify("notifications/initialized", json::Object{});
            session.rpc("resources/read", json::Object{{"uri", "skill://gm/SKILL.md"}});
            session.rpc("tools/call", json::Object{{"name", "next_context"}, {"arguments", json::Object{}}});
            text = session.body(kBody);
        }
        session.stop();
    }
    auto expect = [&](bool condition, const std::string& what) {
        if (!condition) result.failures.push_back(what + ": " + text.substr(0, 400));
    };
    expect(contains(text, "\"add\":true"), "prd_add did not return ok");
    expect(contains(text, "\"list\":\"") && contains(text, " open first item"), "prd_list did not show the new open row");
    expect(contains(text, "parked: waiting"), "prd_park did not park with its reason");
    expect(contains(text, "parked first item (parked: waiting)"), "prd_list parked did not show the parked row");
    expect(contains(text, "\"defaultWhileParked\":\"legacy-no-kind pending \""), "prd_list with no status did not show only the open legacy row while the work item is parked");
    expect(contains(text, "reopened from parked"), "prd_reopen did not move the parked row back to open");
    expect(contains(text, "receipt 1 bound"), "prd_receipt did not bind the first receipt");
    expect(contains(text, "[receipts:1]"), "prd_list did not show the receipt count");
    expect(contains(text, "refuted: no longer true"), "prd_refute did not refute the open row");
    expect(contains(text, "reopened from refuted"), "prd_reopen from refuted did not reopen the refuted row");
    expect(contains(text, "why"), "unknown_add or unknown_list did not show the open question");
    expect(contains(text, " deleted"), "prd_delete did not delete the unresolved row");
    expect(contains(text, "resolved by witness checked by hand at commit"), "prd_resolve did not close the row with the cleaned witness");
    expect(contains(text, "\"legacyOpen\":\"legacy-no-kind"), "prd_list open did not list a legacy row with no kind");
    expect(contains(text, "\"legacyPending\":\"legacy-no-kind"), "prd_list pending did not list a legacy row with status pending");
    expect(contains(text, "\"legacyAll\":\"legacy-no-kind"), "prd_list all did not list a legacy row");
    expect(contains(text, "\"unknownOpen\":\"") && !contains(text, "\"unknownOpen\":\"legacy-no-kind"), "unknown_list open claimed a legacy work item");
    expect(contains(text, "\"badStatus\":\"") && contains(text, "status must be one of"), "prd_list accepted an unknown status");
    expect(contains(text, "\"noTitle\":\"title must be a non-empty string\""), "prd_add accepted a missing title");
    expect(std::filesystem::exists(workspace / "closes"), "prd_resolve wrote no closes record");
    std::error_code ignored;
    result.summary = "add, list, park, reopen, receipt, refute, delete, resolve and the question verbs answer as the leaf did";
    std::filesystem::remove_all(sandbox, ignored);
    return result;
}

}
