# Execution Protocols

## Chain Decomposition

Every multi-step chain broken into individually-verified steps BEFORE end-to-end run:

1. List every distinct operation as numbered steps (e.g. 1:parse → 2:validate → 3:transform → 4:write → 5:confirm)
2. Per step: define input shape, output shape, success condition, failure condition
3. Execute step 1 in isolation → witness → assign mutable → proceed only when KNOWN
4. Execute step 2 with step 1's witnessed output as input. Repeat for every step.
5. After all steps pass individually, test adjacent pairs (1+2, 2+3, 3+4...) for handoff correctness
6. Only after all pairs pass: run full chain end-to-end
7. Step failure → fix that step only, rerun from there. Never skip forward.

Rules:
- Stateless operations isolated first (pure logic, no dependencies)
- Stateful operations tested with immediate downstream effect (share a state boundary)
- Same assertion target = same run (same variable, same API call, same file)
- Unrelated assertion targets = separate runs

## Import-Based Execution

Import actual codebase modules. Never rewrite logic inline — that tests your reimplementation, not the actual code.

```exec:nodejs
const { fn } = await import('/abs/path/to/module.js');
console.log(await fn(realInput));
```

Use real library versions from actual node_modules. Set `cwd` field when project context needed. Witnessed import output = resolved mutable. Reimplemented output = UNKNOWN mutable.

## Browser Verification Scaffold

Inject before any browser state assertion:

```js
window.__gm = {
  captures: [],
  log: (...args) => window.__gm.captures.push({t: Date.now(), args}),
  assert: (label, cond) => { window.__gm.captures.push({label, pass: !!cond, val: cond}); return !!cond; },
  dump: () => JSON.stringify(window.__gm.captures, null, 2)
};
```

Instrument via function interception:
```js
window._orig = window.target;
window.target = (...a) => { window.__gm.log('target', a); return window._orig(...a); };
```

Capture network via fetch/XHR interception patterns. After interactions: `window.__gm.dump()`. All UI state mutables resolve from `__gm.captures` only — not from visual inspection or assumption.
