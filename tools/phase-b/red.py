import json
import os
import pathlib
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[1]
REDS = json.loads((HERE / "reds.json").read_text())
BUILD = os.environ.get("RED_BUILD", "build/rel-72")
PRESET = os.environ.get("RED_PRESET", "x64-linux-release")
LOGS = pathlib.Path(os.environ.get("RED_LOGS", "/tmp/red-logs"))
GIT_ENV = {**os.environ, "HOME": "/config"}
SCRATCH_BASE = os.environ.get("GM_SCRATCH", "/workspace/tmp/gm")
WITNESS_ENV = {**os.environ, "HOME": SCRATCH_BASE + "/rel72-home", "GMNEW_AUTO_UPDATE": "0"}
GM_TOOL = BUILD + "/native/components/tool/gm-tool"
GM = BUILD + "/native/components/host/gm"


def run(argv, log, env=None, timeout=900):
    try:
        return subprocess.run(argv, cwd=ROOT, env=env or os.environ, stdout=log, stderr=subprocess.STDOUT, timeout=timeout).returncode
    except subprocess.TimeoutExpired:
        return 124


def git(*args):
    return subprocess.run(["git", *args], cwd=ROOT, env=GIT_ENV, capture_output=True, text=True).stdout.strip()


def rebuild(log):
    version = git("rev-parse", "--short=7", "HEAD") + "-1"
    git("update-ref", "refs/remotes/origin/main", "HEAD")
    configured = run(["cmake", "--preset", PRESET, "-B", BUILD, "-DGMNEW_VERSION=" + version], log, timeout=1500)
    return configured or run(["cmake", "--build", BUILD, "-j8"], log, timeout=2400)


def witness(name, log):
    return run([GM_TOOL, "check", GM, name], log, WITNESS_ENV)


def mutate(red):
    path = ROOT / red["file"]
    text = path.read_text()
    for edit in red["edits"]:
        if text.count(edit["from"]) != edit["count"]:
            raise SystemExit("%s: %r matches %d times, expected %d" % (red["id"], edit["from"][:60], text.count(edit["from"]), edit["count"]))
        text = text.replace(edit["from"], edit["to"])
    path.write_text(text)


def execute(red):
    LOGS.mkdir(parents=True, exist_ok=True)
    saved = git("rev-parse", "HEAD")
    original = (ROOT / red["file"]).read_bytes()
    with open(LOGS / (red["id"] + ".log"), "wb") as log:
        mutate(red)
        git("commit", "-q", "-am", "temporary red mutation for %s; dropped after the run" % red["witness"])
        built = rebuild(log)
        failed = witness(red["witness"], log) if built == 0 else -1
        git("reset", "-q", "--hard", saved)
        restored = (ROOT / red["file"]).read_bytes() == original
        rebuilt = rebuild(log)
        after = witness(red["witness"], log) if rebuilt == 0 else -1
    clean = git("status", "--short") == ""
    print("%s MUT_BUILD_RC=%d RED_RC=%d RESTORED_cmp=%s TREE_CLEAN=%s BUILD_RESTORE=%d AFTER_RC=%d" % (red["id"], built, failed, restored, clean, rebuilt, after), flush=True)
    return built == 0 and failed not in (0, -1) and restored and clean and rebuilt == 0 and after == 0


def main(argv):
    if argv == ["ids"]:
        print("\n".join(red["id"] for red in REDS))
        return 0
    wanted = [red["id"] for red in REDS] if argv == ["all"] else argv
    unknown = set(wanted) - {red["id"] for red in REDS}
    if unknown or not wanted:
        raise SystemExit("usage: red.py ids | all | <id>...; unknown: %s" % sorted(unknown))
    if git("status", "--short"):
        raise SystemExit("the tree has uncommitted changes; a red resets the tree and would lose them")
    results = [execute(next(red for red in REDS if red["id"] == name)) for name in wanted]
    return 0 if all(results) else 1


sys.exit(main(sys.argv[1:]))
