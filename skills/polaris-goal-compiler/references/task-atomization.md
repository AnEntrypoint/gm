# Task Atomization in Polaris Goal Compiler

## What Makes an Atom

A task atom is the smallest executable unit of work. It must satisfy all of:

1. **Atomic** — Cannot be divided further without losing meaning
2. **Completable** — Can be finished in one session/sprint
3. **Verifiable** — Has clear entrance and exit criteria
4. **Interdependent** — Has clear dependencies (blocks/is blocked by other atoms)

## Examples

### Good Atoms

- "Write the type schema for the user entity" (clear scope, verifiable)
- "Understand the regulatory requirements for PCI compliance" (finite scope, verifiable)
- "Design the error recovery flow for transaction rollback" (clear domain, verifiable)

### Bad Atoms

- "Implement the payment system" (too large, vague)
- "Fix bugs" (unmeasurable, not atomic)
- "Make it better" (not verifiable)

## How to Break Down a Goal

Start with: "Goal: Build a payment microservice."

1. **Identify phases**: Research → Design → Implement → Test → Deploy
2. **For each phase, ask: What's the smallest piece?**
   - Research: API options, compliance, existing solutions
   - Design: Data model, interfaces, error handling
   - Implement: Core logic, integrations, monitoring
   - Test: Unit tests, integration tests, end-to-end
   - Deploy: Staging validation, production rollout

3. **For each piece, refine**: Can this be done in 1-2 days by one person? If not, break further.

## Dependency Edges

Each atom has:
- **Blockers** — Things that must finish before this starts
- **Unblocks** — Things that can't start until this finishes

Example:
```
Research APIs (A1) 
  ↓ unblocks
Design interface (A2)
  ↓ unblocks
Implement core (A3)
  ↓ unblocks
Test integration (A4)
  ↓ unblocks
Deploy (A5)
```

## Active vs. Blocked

Once atomized:
- **Active work** = all blockers are done
- **Blocked work** = at least one blocker is pending

The Goal Compiler makes this explicit to prevent working on blocked items.

See `POLARIS-SKILLS-GUIDE.md` for full integration.
