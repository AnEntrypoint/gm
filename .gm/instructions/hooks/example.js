// Example FSM jit-hook (per fsm-framework-jit-hook-concreting). A hook
// is a plain exec_js script the orchestrator runs automatically at a
// gate's evaluation. It is wrapped in an async function body before
// running (the same wrapping every exec_js dispatch gets, per
// agentplug-host's build_command), so the gate result comes from an
// EXPLICIT `return`, never a bare trailing expression statement --
// `foo();` on its own last line is a statement whose value is discarded,
// not an implicit return, exactly like a normal JS function body. `true`
// passes the gate, anything else (false, a thrown error, a non-boolean
// return, a missing `return` at all, a missing/unreadable file) fails it
// CLOSED (denies), never open. Wire it into gates.json via a GateDef's
// `hook` field (a path relative to this hooks/ dir) and `hook_mode`
// ("hook-only" to replace the compiled predicate entirely, "both" to
// require both the compiled predicate AND this hook to pass, or the
// default "predicate-only" to ignore this file).
//
// This example: a made-up project-specific condition -- deny until a
// file named .gm/ship-approved exists, so a human (or an earlier CI
// step) has to touch that file before the FSM lets CONSOLIDATE proceed.
const fs = require('fs');
return fs.existsSync('.gm/ship-approved');
