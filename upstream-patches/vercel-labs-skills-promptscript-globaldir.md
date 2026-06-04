# Upstream PR: give PromptScript a global skills dir

Target repo: https://github.com/vercel-labs/skills
File: `src/agents.ts`

## Problem

Running `skills add <source> -y -g` inside an AI agent host prints:

```
x  Failed to install 1
   skill -> PromptScript: PromptScript does not support global skill installation
```

The install itself succeeds for the universal `.agents/skills` target, but the `promptscript` agent is auto-included (it is a universal agent, and `runAdd` calls `ensureUniversalAgents([mappedAgent])` when an AI host is detected), and `promptscript` is the only universal agent whose `globalSkillsDir` is `undefined`. With `-g`, the installer rejects that single target and emits the failure line, which reads as a failed install even though every other target landed.

## Cause

In `src/agents.ts`, every universal agent points its global dir at the shared universal location except `promptscript`:

```ts
promptscript: {
  name: 'promptscript',
  displayName: 'PromptScript',
  skillsDir: '.agents/skills',
  globalSkillsDir: undefined,        // <- only universal agent with no global dir
  showInUniversalPrompt: false,
  detectInstalled: async () => (
    existsSync(join(process.cwd(), '.promptscript')) ||
    existsSync(join(process.cwd(), 'promptscript.yaml'))
  ),
},
```

`amp`, `replit`, and `universal` all use `join(configHome, 'agents/skills')` for their global dir. PromptScript shares `skillsDir: '.agents/skills'` with them, so its global counterpart should be the same shared universal global location.

## Fix

```ts
promptscript: {
  name: 'promptscript',
  displayName: 'PromptScript',
  skillsDir: '.agents/skills',
  globalSkillsDir: join(configHome, 'agents/skills'),
  showInUniversalPrompt: false,
  detectInstalled: async () => (
    existsSync(join(process.cwd(), '.promptscript')) ||
    existsSync(join(process.cwd(), 'promptscript.yaml'))
  ),
},
```

This makes `-g` resolve PromptScript to the shared universal global skills dir (`$XDG_CONFIG_HOME/agents/skills`, the same path `amp`/`replit`/`universal` use), so a global install no longer rejects the PromptScript target and the spurious failure line disappears. Because all universal agents resolve to the same directory, no duplicate copy or extra symlink is created.

## Patch

```diff
   promptscript: {
     name: 'promptscript',
     displayName: 'PromptScript',
     skillsDir: '.agents/skills',
-    globalSkillsDir: undefined,
+    globalSkillsDir: join(configHome, 'agents/skills'),
     showInUniversalPrompt: false,
     detectInstalled: async () => {
       return (
         existsSync(join(process.cwd(), '.promptscript')) ||
         existsSync(join(process.cwd(), 'promptscript.yaml'))
       );
     },
   },
```
