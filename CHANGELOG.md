# Changelog

## [Unreleased]
- TUI-inspired redesign: semantic color palette (Nord-inspired), CSS variables, grid background pattern
- Add form components: input, textarea, select with focus states and accessible labels
- Add status indicators: success/warning/error/info with semantic colors
- Add component library: progress bar, spinner, modal, table, toast notifications
- Enhance platform showcase: categorize CLI tools and IDE extensions
- Add phase visualization: status indicators for process phases
- Add accessibility features: WCAG AA compliance, prefers-reduced-motion support, :focus-visible states
- Add responsive design: 2-column grid at desktop, 1-column on mobile
- Add design system documentation to CLAUDE.md with color palette, typography, and component reference
- Fix GC exec dispatch: use `plugkit exec --lang <lang> <code>` instead of positional arg (was treating lang as code)
- Deploy OC plugin (gm-oc.mjs) with all 5 handlers: session.closing, tool.execute.before, message.updated, experimental.chat.system.transform, experimental.chat.messages.transform
- Install gm-kilo plugin into ~/.kilocode: kilocode.json, gm-kilo.mjs, agents/, hooks/
- Deploy GC bin/ (plugkit.js + binaries) to ~/.gemini/extensions/gm/bin/
- Deploy updated GC hooks with exec dispatch to ~/.gemini/extensions/gm/hooks/
- Add validate/probe.js: 14-scenario parity harness for OC and GC hook scripts (14/14 passing)


### Fixed
- Align file-edit blocking rules across gc/kilo/oc to match cc exactly: add Edit tool to kilo/oc check, add edit_file to GC writeTools, add jest/vitest config and snap/stub/mock/fixture patterns to GC FORBIDDEN_FILE_RE, add /fixtures/ and /test-data/ to GC FORBIDDEN_PATH_RE
