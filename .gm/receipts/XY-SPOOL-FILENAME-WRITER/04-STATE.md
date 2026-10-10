# 04 STATE -- XY-SPOOL-FILENAME-WRITER

The edit owns one paragraph of skills/gm/spool-adapter.md: where a hand-written spool temp is staged, and when the sweep runs.
Replay is idempotent: the paragraph states a rule and its measurement; a second run would rewrite the same text and observe the same quarantine behaviour.
It owns no runtime state. The quarantine directory, the out-file answers and the dispatch.js temp path are owned by the daemon and gm-mcp and were not modified.