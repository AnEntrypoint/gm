import collections, json, os, re, subprocess, sys, tempfile, threading, time

binary = os.path.abspath(sys.argv[1])
calls = int(sys.argv[2]) if len(sys.argv) > 2 else 40
samples = int(sys.argv[3]) if len(sys.argv) > 3 else 12
root = tempfile.mkdtemp(prefix="gm-asan-samples-")
ws = os.path.join(root, "ws")
os.makedirs(os.path.join(ws, ".gm"))
with open(os.path.join(ws, ".gm", "mcp.json"), "w") as f:
    f.write('{"mcpServers":{"playwriter":{"disabled":true}}}')
env = dict(os.environ, HOME=root, ASAN_OPTIONS="halt_on_error=1:abort_on_error=0:detect_leaks=0")
relay = subprocess.Popen([binary, "serve"], cwd=ws, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
lock = threading.Lock()
counter = [0]

def rpc(method, params):
    with lock:
        counter[0] += 1
        rid = counter[0]
    relay.stdin.write((json.dumps({"jsonrpc": "2.0", "id": rid, "method": method, "params": params}) + "\n").encode())
    relay.stdin.flush()
    while True:
        line = relay.stdout.readline()
        if not line:
            return None
        message = json.loads(line)
        if message.get("id") == rid:
            return message

def children(pid):
    found = []
    for entry in os.listdir("/proc"):
        if not entry.isdigit():
            continue
        try:
            with open("/proc/%s/stat" % entry) as f:
                if int(f.read().rsplit(")", 1)[1].split()[1]) == pid:
                    found.append(int(entry))
        except OSError:
            pass
    return found

rpc("initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "asan-samples", "version": "1"}})
relay.stdin.write(b'{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}\n')
relay.stdin.flush()
rpc("resources/read", {"uri": "skill://gm/SKILL.md"})
rpc("tools/call", {"name": "next_context", "arguments": {}})
worker = next((p for p in children(relay.pid) if open("/proc/%d/comm" % p).read().startswith("gm-core")), None)
timings = []

def drive():
    for _ in range(calls):
        began = time.time()
        rpc("tools/call", {"name": "run_code", "arguments": {"body": "return 1;"}})
        timings.append((time.time() - began) * 1000)

driver = threading.Thread(target=drive)
driver.start()
frames = collections.Counter()
for _ in range(samples):
    time.sleep(1)
    if worker is None or not driver.is_alive():
        break
    out = subprocess.run(["sudo", "gdb", "-p", str(worker), "-batch", "-ex", "set pagination off", "-ex", "thread apply all bt 14"],
                         capture_output=True, text=True, timeout=120).stdout
    for name in set(re.findall(r"#\d+\s+(?:0x[0-9a-f]+ in )?([A-Za-z_][\w:~<>]*)", out)):
        frames[name] += 1
driver.join()
print("asan-samples: worker %s, %d run_code calls, mean %.1f ms, fastest %.1f ms" % (worker, len(timings), sum(timings) / max(1, len(timings)), min(timings) if timings else -1))
for name, count in frames.most_common(40):
    print("asan-samples: %3d samples  %s" % (count, name))
relay.stdin.close()
relay.wait(timeout=60)
