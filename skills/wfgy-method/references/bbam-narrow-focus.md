# BBAM narrow focus

## BBAM pattern - notice and correct over-narrow focus (agent-delegated: no real attention weights are read)

The original computes `logits * exp(-gamma * sigma(logits))` -- rescaling an actual attention/logit distribution by its own variance, flattening it when it's too peaked. A text-generating agent cannot read its own attention weights or logits; there is no real signal here for this skill to compute. Instead of dropping this module, the intelligence work is handed to you directly: periodically ask yourself whether your recent output has narrowed onto one aspect of a broader task and stayed there past the point of usefulness (repeating the same point, elaborating one sub-detail while leaving the rest of the task untouched, treating one hypothesis as settled without checking alternatives). If so, deliberately widen back out -- this is you doing, in plain judgment, what the original technique's math does mechanically to a real attention distribution.

- [ ] Periodically (not every step) ask: has my recent output been unusually narrow or repetitive relative to the task's actual breadth?
- [ ] If yes: name what got left unexamined, and deliberately address it before continuing down the narrow path.
