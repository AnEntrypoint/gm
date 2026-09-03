---
key: mem-f7fc1ab2c49fee44-788
ns: default
created: 1784800225873
updated: 1784800225873
---

gm runtime config surface field defaults: .gm/browser-config.json - cdp_poll_timeout_ms default 1000, cdp_poll_interval_ms default 250, chrome_ready_deadline_ms default 30000, eval_timeout_grace_ms default 6000, headless default false, session_idle_timeout_ms default 1800000. .gm/instructions/hooks/<name>.js is a jit-hook wired via GateDef hook field + hook_mode: hook-only replaces the compiled predicate, both requires both, default predicate-only ignores the hook; explicit return true passes, anything else fails CLOSED. .gm/daemon-project-config.json carries gm_concurrency_limit. ~/.agentplug/daemon-config.json includes side_plugin_concurrency. Env toggles: AGENTPLUG_NO_DAEMON, CLAUDE_PROJECT_DIR, GM_PLUGKIT_SKIP_SELF_STALE_CHECK. Full detail in .gm/daemon-config-reference.md.
