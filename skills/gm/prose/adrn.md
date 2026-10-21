# ADR, Irreversible Forks Only - Michael Nygard

Principle `ADRN`. Apply "ADR, Irreversible Forks Only - Michael Nygard" to the work this node stands on. Entered from any neighbour that leads here; left to any neighbour it links to. Its place in a walk is set by the work it applies to, not a bucket.

Claims:
- An architecture decision record (ADR) is written only for a fork no later commit can reverse: a storage format a reader depends on, a wire protocol, a public verb name, or a persistence choice other systems read.
- A reversible choice is recorded only in its commit message reason, never as a record.
- Status is one of proposed, accepted, deprecated or superseded. A record is never edited to change its decision. A changed decision is a new record naming the one it supersedes; the old record's status becomes superseded.

Format, one block per record:
- Title: ADR-<n> followed by the decision in imperative mood.
- Status: the status above.
- Context: the irreversible constraint, in one or two sentences.
- Options: each on its own line, with its cost.
- Chosen: the option taken.
- Witness: the live dispatch id, or the file:line read from the live tree, showing the chosen option works.
- Supersedes: the superseded record's id, or none.

The record is pushed in the same commit as the change it decides. A reversible decision recorded as an ADR is removed in its own commit, with the reason in that commit's message.

The walk is recorded by the transition that leaves this node.
