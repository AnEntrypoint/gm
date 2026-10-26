# Lessons file format

`.wfgy/lessons.md`, created at the root of whatever project this skill is applied in (not inside this skill's own directory -- the lessons belong to the project being worked on, not to the skill itself).

Each entry:

```
## <YYYY-MM-DD> -- <one-line summary>
Goal (G): <what you were actually trying to accomplish>
What drifted / what went wrong: <specific, concrete -- not "I made a mistake" but what exactly happened>
Fix / resolution: <specific, concrete -- what you actually did to resolve it>
Generalizes to: <what future work in this project should watch for because of this, stated broadly enough to apply beyond this one instance>
```

Example (illustrative, not a real project's actual history):

```
## 2026-07-07 -- assumed a config field name without checking the schema
Goal (G): add a new option to the build config and have it take effect
What drifted / what went wrong: wrote the option under a key name that seemed
consistent with sibling options, without checking the actual config-loader
source; the loader silently ignored the unrecognized key, so the option had
no effect and the failure was invisible until manually tested
Fix / resolution: read the loader's actual accepted-keys list, found the real
key name, fixed the config, added a real-execution check that the option's
effect is observable, not just that the file parses
Generalizes to: this project's config loader does not warn on unrecognized
keys -- always check the loader's real accepted-key list before adding a new
config option, never infer the name from sibling examples alone
```

Newest entries at the top. Keep each entry short -- a few lines, not a full incident report. The value is in the "generalizes to" line being genuinely reusable, not in exhaustive detail about the one instance.

## Recording durable lessons (the self-learning surface)

The moment a bounded-retry cycle (`skills/wfgy-method/references/bbcr-checkpoint-retry.md`) resolves, whether it succeeded or had to surface to the user, or the moment you catch a concrete, non-obvious mistake anywhere in the task, append an entry to `<project-root>/.wfgy/lessons.md` (create the file and its parent directory if they don't exist yet) before finishing the turn. Use the entry shape above.

Read `.wfgy/lessons.md` at the start of a new task in this project, if it exists, before applying the disciplines in `SKILL.md` -- a lesson already recorded here is exactly the kind of drift this skill exists to catch earlier next time.