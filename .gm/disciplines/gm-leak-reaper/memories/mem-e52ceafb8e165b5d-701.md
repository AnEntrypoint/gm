---
key: mem-e52ceafb8e165b5d-701
ns: gm-leak-reaper
created: 1791853642444
updated: 1791853642444
---

the gm-mcp http port registries were already reaped; 8787's netstat owner pid is a phantom -- A previous lane's claim that dead registries on 8789/8790/8798/8811-8816/8941 were leaking is REFUTED: no registry file for any of them exists, and gm-mcp-server.log records them reaped at 2026-10-12T19:27:11Z. Separately, netstat names 8787's listener as a pid that does not exist (socket handed to a child), so 'the TCP owner pid differs from the registry pid' must be treated as UNMEASURED, not as a different owner -- otherwise a live instance looks foreign forever. Also note gm-mcp has no port allocator at all: every port arrives as an explicit --port/GM_MCP_HTTP_PORT, so the ratchet was never gm's.
