#include "gm/tool.hpp"
#include "support.hpp"

#include <system_error>

namespace gm::tool {

CheckResult check_txiki_sync_names(const std::string& binary) {
    CheckResult result;
    const std::filesystem::path sandbox = support::fresh_sandbox("txiki-sync-names");
    std::string answer;
    bool started = false;
    {
        Session session(binary, sandbox / "ws", sandbox, 300000, true);
        if (!session.started()) {
            result.failures.push_back("gm serve did not start from " + binary);
        } else {
            started = true;
            support::start_session(session, "txiki-sync-names");
            const std::string body = R"JS(await gm.read_file({ path: 'skill://gm/SKILL.md' }); const core = (await import('tjs:internal/core')).default; const dir = core.mkdtempSync(globalThis.tjs.tmpDir + '/gm-sync-XXXXXX'); const fp = dir + '/a.txt'; const fd = core.openSync(fp, 'w', 420); const n = core.writeSync(fd, new Uint8Array([104, 101, 108, 108, 111]), 0, 5, null); core.closeSync(fd); const rd = core.openSync(fp, 'r', 420); const buf = new Uint8Array(16); const got = core.readSync(rd, buf, 0, 16, null); const mid = new Uint8Array(3); const got2 = core.readSync(rd, mid, 0, 3, 1); core.closeSync(rd); core.symlinkSync(fp, dir + '/l.txt', 0); const names = core.readdirSync(dir).sort().join(','); const link = core.readlinkSync(dir + '/l.txt'); const real = core.realpathSync(dir + '/l.txt'); const lst = core.lstatSync(dir + '/l.txt').isSymbolicLink; const st = core.statSync(fp).isFile; core.accessSync(fp, 4); let missing = null; try { core.accessSync(dir + '/nope', 0); } catch (e) { missing = e.code; } let badfd = null; try { core.closeSync(999999); } catch (e) { badfd = e.code; } core.unlinkSync(dir + '/l.txt'); core.rmSync(fp); core.rmSync(dir); let gone = null; try { core.statSync(dir); } catch (e) { gone = e.code; } return { n, got, text: Array.from(buf.slice(0, 5)).join(','), got2, mid: Array.from(mid).join(','), names, link: link === fp, real: real === fp || real.endsWith('/a.txt'), lst, st, missing, badfd, gone, sandboxed: dir.includes('gm-sync-') && !dir.includes('XXXXXX') };)JS";
            answer = json::dump(output_value(tool_json(session, "run_code", json::Object{{"body", body}})));
        }
    }
    std::error_code ec;
    std::filesystem::remove_all(sandbox, ec);
    if (!started) return result;
    if (answer.find(R"("n":5)") == std::string::npos) result.failures.push_back("writeSync did not write the five bytes: " + answer.substr(0, 320));
    if (answer.find(R"("got":5)") == std::string::npos) result.failures.push_back("readSync did not read the five bytes: " + answer.substr(0, 320));
    if (answer.find(R"("text":"104,101,108,108,111")") == std::string::npos) result.failures.push_back("readSync did not fill the buffer with the file bytes: " + answer.substr(0, 320));
    if (answer.find(R"("got2":3)") == std::string::npos) result.failures.push_back("readSync with an explicit position did not read three bytes: " + answer.substr(0, 320));
    if (answer.find(R"("mid":"101,108,108")") == std::string::npos) result.failures.push_back("readSync with an explicit position did not read from the position: " + answer.substr(0, 320));
    if (answer.find(R"("names":"a.txt,l.txt")") == std::string::npos) result.failures.push_back("readdirSync did not list the entries: " + answer.substr(0, 320));
    if (answer.find(R"("link":true)") == std::string::npos) result.failures.push_back("readlinkSync did not return the link target: " + answer.substr(0, 320));
    if (answer.find(R"("real":true)") == std::string::npos) result.failures.push_back("realpathSync did not resolve the link: " + answer.substr(0, 320));
    if (answer.find(R"("lst":true)") == std::string::npos) result.failures.push_back("lstatSync did not report the link itself: " + answer.substr(0, 320));
    if (answer.find(R"("st":true)") == std::string::npos) result.failures.push_back("statSync did not report the file: " + answer.substr(0, 320));
    if (answer.find(R"("missing":"ENOENT")") == std::string::npos) result.failures.push_back("accessSync on a missing path did not throw ENOENT: " + answer.substr(0, 320));
    if (answer.find(R"("badfd":"EBADF")") == std::string::npos) result.failures.push_back("closeSync on a bad fd did not throw EBADF: " + answer.substr(0, 320));
    if (answer.find(R"("gone":"ENOENT")") == std::string::npos) result.failures.push_back("rmSync did not remove the file and its directory: " + answer.substr(0, 320));
    if (answer.find(R"("sandboxed":true)") == std::string::npos) result.failures.push_back("mkdtempSync did not fill the template: " + answer.substr(0, 320));
    result.summary = "txiki-sync-names witness";
    return result;
}

}
