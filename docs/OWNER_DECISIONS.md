# Owner decisions waiting on someone else

Each entry states the choice, the options, what each costs, and the recommended one.

## Row 9, decision 3: protocol 2026-07-28 behind a capability flag

The choice is whether both engines negotiate the 2026-07-28 protocol version behind a capability flag, or stay on the 2025 versions only. Option A: implement it now behind the flag, so clients that ask get the new result fields (ttlMs and cacheScope on list, discover and read results). It costs one protocol branch in each engine and a witness per engine, and it adds a version both sides must keep in step. Option B: keep negotiating only the 2025 versions and defer the flag, which costs nothing now and leaves clients that want ttlMs without it. Recommended: B now, with the field shapes from 2026-11-10 kept in both engines so that A later is only the negotiation switch.

## ship.sh bypass

The choice is whether a push may skip the Phase B pass that gm-tool ship --push requires at HEAD. Option A: keep the refusal as it is, so every push follows a passing gm-tool phase-b at HEAD. It costs about 54 s per round. Option B: add a flag that pushes without the marker, for emergencies only. It saves that wait, but it lets an unchecked tree reach origin, and a peer may install it. Recommended: A. Keep the refusal, and when the wait is the problem, shorten Phase B rather than bypass it.

## run_code structuredContent

The choice is the shape of run_code's structuredContent in the tool result. Option A: the protocol shape, with the output, ok and notice fields in structuredContent and nothing duplicated in the text block. It is the shape the spec names, and the dispatcher can parse it without a special case, but the text block also needs to carry the same data for clients that read only text. Option B: keep the current shape, which duplicates the JSON in a text block, and document it. It costs extra tokens on every reply. Recommended: A, with the text block kept as a short human line, so a client reads the same fields from either place.

## Served-skill release cut

The choice is whether to publish the served skill (skills/gm/SKILL.md and skills/gm-continue/SKILL.md, as they stand at HEAD) as a release that installs fetch, or to keep serving them from the installed tree only. The cut is a release that carries the current skill files, so an install gets them without a reinstall from source. The dispatcher must run tools/ship.sh --push, then bash scripts/install.sh --local build/release on the release host, then the cut itself. For peers, the cut changes the installed skill files: their skill fingerprint changes once, so a worker that carried the old read will read the skill again after its next hand-over. Option A: cut now, which costs one re-read per peer. Option B: wait until the skill text stops changing, which costs nothing now. Recommended: A once the current round's skill edits are settled, because peers already re-read after every change to the skill text.

## Row 14: fx's duplicate events

The question for fx, exactly as it should be sent: "Please paste the text of the two events you saw delivered twice in the next_context reply, with their seq numbers and run ids, and say which tool call returned each copy."
