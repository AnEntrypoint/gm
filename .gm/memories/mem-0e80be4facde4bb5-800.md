---
key: mem-0e80be4facde4bb5-800
ns: default
created: 1783015848742
updated: 1783016435982
---

## Resolved mutable: edge-case-chromium-detached-orphan

reapOrphanBrowserSessions (witnessed jank-browser-session-lifecycle resolve, wrapper.js:848-874) actively scans playwriter session list vs active ports.json entries and deletes orphans matching the target cwd on every getOrCreateBrowserSession call (reason:'pre-spawn') -- this IS periodic orphan cleanup, contradicting the mutable's claim of 'no cleanup on parent crash... accumulates over time'. gracefulCloseBrowser (also witnessed) SIGTERM+grace+SIGKILL escalates cleanly on explicit close. gm-validate.js's own serveProc.unref() is a static-file server for the validation harness only, not the managed browser session path -- different code path than production browser verb. No code gap found in the production browser-session lifecycle.
