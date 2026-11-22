#!/usr/bin/env python3
import json, os, resource, subprocess, sys, threading, time


def tree_rss_kib(root):
    children = {}
    rss = {}
    for entry in os.listdir('/proc'):
        if not entry.isdigit():
            continue
        try:
            with open('/proc/%s/stat' % entry) as stat:
                fields = stat.read().rsplit(')', 1)[1].split()
            with open('/proc/%s/statm' % entry) as statm:
                pages = int(statm.read().split()[1])
        except OSError:
            continue
        children.setdefault(int(fields[1]), []).append(int(entry))
        rss[int(entry)] = pages * os.sysconf('SC_PAGE_SIZE') // 1024
    total, stack = 0, [root]
    while stack:
        pid = stack.pop()
        total += rss.get(pid, 0)
        stack.extend(children.get(pid, []))
    return total


def main():
    label, command = sys.argv[1], sys.argv[2:]
    began = time.monotonic()
    child = subprocess.Popen(command)
    peak = [0]

    def sample():
        while child.poll() is None:
            peak[0] = max(peak[0], tree_rss_kib(child.pid))
            time.sleep(0.2)

    sampler = threading.Thread(target=sample, daemon=True)
    sampler.start()
    code = child.wait()
    sampler.join()
    wall = time.monotonic() - began
    largest = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss
    print(json.dumps({'label': label, 'exit': code, 'wall_s': round(wall, 3), 'peak_tree_rss_mib': round(peak[0] / 1024, 1), 'largest_process_rss_mib': round(largest / 1024, 1)}), file=sys.stderr)
    sys.exit(code)


main()
