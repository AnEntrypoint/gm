#!/usr/bin/env python3
import collections, json, os, sys

ROOTS = sys.argv[1:] or ['/workspace/gm', '/workspace/oscraft', '/workspace/bevy', '/workspace/thebird']
DAYS = ('2026-11-21', '2026-11-22', '2026-11-23')
CUT = '<<<' + 'gm-cut'


def counts_for(root):
    counts = collections.Counter()
    runs = os.path.join(root, 'runs')
    for name in sorted(os.listdir(runs)) if os.path.isdir(runs) else []:
        log = os.path.join(runs, name, 'log.jsonl')
        if not os.path.isfile(log):
            continue
        with open(log, errors='replace') as lines:
            for line in lines:
                try:
                    event = json.loads(line)
                except ValueError:
                    continue
                day = str(event.get('t', ''))[:10]
                if day not in DAYS:
                    continue
                if 'the body does not load' in str(event.get('error', '')):
                    counts[day, 'load-fail'] += 1
                args = event.get('args') if isinstance(event.get('args'), dict) else {}
                if event.get('tool') == 'read_file' and '/outputs/' in str(args.get('path', '')):
                    counts[day, 'reread-cut-output'] += 1
                if str(event.get('output', '')).startswith(CUT):
                    counts[day, 'cut-reply'] += 1
    return counts


for root in ROOTS:
    print(root, json.dumps({'%s %s' % key: value for key, value in sorted(counts_for(root).items())}))
