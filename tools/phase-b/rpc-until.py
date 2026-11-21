import json, subprocess, sys, time
binary, ws, body_path, out_path = sys.argv[1:5]
body = open(body_path).read()
msgs = [
    {"jsonrpc": "2.0", "id": "1", "method": "initialize", "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "probe", "version": "1"}}},
    {"jsonrpc": "2.0", "method": "notifications/initialized", "params": {}},
    {"jsonrpc": "2.0", "id": "3", "method": "tools/call", "params": {"name": "run_code", "arguments": {"body": body, "timeoutMs": 1200000}}},
]
out = open(out_path, "w")
p = subprocess.Popen([binary, "serve", "--workspace", ws], stdin=subprocess.PIPE, stdout=out, stderr=subprocess.DEVNULL)
print("SERVE_PID", p.pid, flush=True)
for m in msgs:
    p.stdin.write((json.dumps(m) + "\n").encode())
    p.stdin.flush()
deadline = time.time() + 1500
while time.time() < deadline:
    out.flush()
    if '"id":"3"' in open(out_path).read():
        break
    time.sleep(3)
p.stdin.close()
p.wait(timeout=120)
print("SERVE_RC", p.returncode, flush=True)
