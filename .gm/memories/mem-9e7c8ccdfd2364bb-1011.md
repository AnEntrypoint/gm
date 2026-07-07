---
key: mem-9e7c8ccdfd2364bb-1011
ns: default
created: 1780561187011
updated: 1780561248230
---

gm-skill global install: the documented install IS `bun x skills add AnEntrypoint/gm -y -g` (WITH -g, user wants global). The skills CLI (vercel-labs/skills) prints "PromptScript does not support global skill installation" but the install SUCCEEDS - only the promptscript target errors because vercel-labs/skills src/agents.ts:664 had globalSkillsDir:undefined for the promptscript agent (the one universal agent missing a global dir; add.ts auto-includes it under AI-host detection). Root cause is upstream, NOT gm-skill. Fix: PR https://github.com/vercel-labs/skills/pull/1365 sets promptscript globalSkillsDir to join(configHome,agents/skills), the shared universal global dir (same as amp/replit/universal). Antigravity paths ~/.gemini/antigravity/skills and ~/.gemini/antigravity-cli/skills are already correct upstream (user-confirmed), no antigravity PR. Patch writeup: upstream-patches/vercel-labs-skills-promptscript-globaldir.md. This supersedes the earlier (wrong) memory that said install has no -g.
