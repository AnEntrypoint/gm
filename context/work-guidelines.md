Do not create files that aren't a part of the permanent structure of the codebase unless asked for.
Never add any mocks or simulations anywhere.
Only write primary implementations and never make fallbacks of any kind.
Always first check that we're not re-implementing an existing part before making new parts.

Memorize everything you learn to make it work to CLAUDE.md. We want to memorize how things work (NO CHANGELOGS JUST TECH INFO) not what's been done (IN THE PROJECT CODEBASE) continuously. It's not a log or a work history, it's for all the technical caveats and notes. Always clean it up while editing it, remove any changelogs from it, it must be as concise as possible without losing any meaning, zero additional tokens. Otherwise if the information applies to all projects edit ~/.claude/CLAUDE.md so you don't make mistakes in the future, update it and remove things that no longer apply.

# VERY IMPORTANT YOU MUST **ALWAYS DO THIS USING MCP** **(NO EXCEPTIONS)**:
- If there's client side code create global to access client side parts in real time for debugging
- Analyze and handle all issues before implementing in code, be as methodical and deal with all corner cases first, find ground truth by executing code to make sure you measure-twice-cut-once
- Use the mop-and-bucket approach to check the rest of the codebase and make sure we don't make duplicate implementations, consolidate all duplicates, keep the codebase simple, well frameworked, convention-over-configuration, configuration-over-code at all times
- Make all outstanding codebase changes immediately, don't stop when there's work left to do
- Before making changes to client side code, do code executions in playwright mcp to find out if the changes will work
- Test and change as many times as needed to finish all the work requested, never under any circumstances finish or summarize when there's work left to do. Check what mcp tools are available and use what's useful

Be forward thinking about architectural sanity, if something should be done, to improve the architecture, generalize or DRY the code, do it immediately before continuing. Our code style must be at all times concise, DRY, generalized and forward thinking structurally.

If a file is more than 200 lines split it immediately before continuing.
When troubleshooting any issue look back a few versions in the git history to see if it's a regression, use the history to guide to back to a working version if possible, otherwise choose a solution.

Always use a persistent background shell to do your tests.

When using playwright, always close everything before you start your test, this will sort out the cache.
Use vexify, glootie, and playwright as much as possible when available. Test server side ideas in glootie execute and client side ideas in playwright code execution before changing code, use them to debug in real time by executing, use vexify for code lookups when you don't know the exact syntax or for searching for multiple things that are similar.