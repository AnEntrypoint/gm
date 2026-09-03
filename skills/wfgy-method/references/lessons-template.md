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
