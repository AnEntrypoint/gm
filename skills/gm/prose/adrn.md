# ADR, Irreversible Forks Only - Michael Nygard

Principle `ADRN`. Apply "ADR, Irreversible Forks Only - Michael Nygard" to the work this node stands on. The node is entered from any neighbour that leads here and left to any neighbour it links to; its place in a walk is decided by the work it applies to, not by a bucket.

Claims:
- An architecture decision record is written only for a fork that no later commit can reverse: a storage format a reader depends on, a wire protocol, a public verb name, or a persistence choice other systems read.
- A reversible choice is recorded only in the reason of its commit message, never as a record.
- Status is one of proposed, accepted, deprecated or superseded. A record is never edited to change its decision. A changed decision is a new record that names the one it supersedes, and the old record's status becomes superseded.

Format, one block per record:
- Title: ADR-<n> followed by the decision in imperative mood.
- Status: the status above.
- Context: the irreversible constraint, in one or two sentences.
- Options: each option on its own line, with its cost.
- Chosen: the option taken.
- Witness: the live dispatch id, or the file:line read from the live tree, that shows the chosen option works.
- Supersedes: the id of the superseded record, or none.

The record is pushed in the same commit as the change it decides. A reversible decision recorded as an ADR is removed in its own commit, with the reason in that commit's message.

The walk is recorded by the transition that leaves this node.
