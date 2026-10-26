# BBAM narrow focus

## BBAM pattern - notice and correct over-narrow focus (agent-delegated: no real attention weights are read)

The original computes `logits * exp(-gamma * sigma(logits))` on a real attention/logit distribution. A text-generating agent cannot read its own logits, so this module is handed to you as judgment: periodically ask whether your recent output has narrowed onto one aspect of a broader task and stayed there past usefulness (repeating one point, elaborating one sub-detail, treating one hypothesis as settled without checking alternatives). If so, widen back out.

- [ ] Periodically (not every step) ask: has my recent output been unusually narrow or repetitive relative to the task's actual breadth?
- [ ] If yes: name what got left unexamined, and deliberately address it before continuing down the narrow path.