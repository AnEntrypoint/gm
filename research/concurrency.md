# Concurrency and caching evidence for gm-new

Digest from the research agent, 2026-11-01. Labels (high, medium, low) are the research agent's own. Each point names its source. Numbers are self-reported unless marked otherwise. Each point maps to a design direction in DESIGN.md and to a work-plan item in AGENTS.md.

## Points

1. Parallel tool calls in one turn (work item 1). Confidence: medium. One self-reported study (arxiv 2602.07359): three calls per turn cut wall-clock time 40.6% and cost 35.9%, with accuracy 68 vs 66. Use: proceed with item 1 as planned, and measure it on gm-new's own scripted tasks (item 7).

2. Overlapping tool execution with generation. Confidence: medium for the latency gain. Source: arxiv 2603.18897, a serving-system paper, not the Claude API. Uncoordinated speculation can be worse than the baseline under high load. Use: keep it default off until measured, as AGENTS.md rule 3 says.

3. Fine-grained tool streaming (eager_input_streaming). The tool input may not be valid JSON. Use: do not enable it. The reply parser must still handle unparseable replies, which it already does (parse_error events).

4. Prompt caching order and breakpoint. Confidence: medium for the effect. Cache order is tools, then system, then messages. A breakpoint on a block that changes every request never hits. Use: place the breakpoint at the end of the stable prefix (rules, tools, instructions), and keep the last-20-events section after it. This matches AGENTS.md rule 5. Measured effect (arxiv 2601.06007, over 500+ sessions): 41 to 80% cost cut and 13 to 31% faster first token.

5. Rate limits. Confidence: high (Anthropic rate-limit docs). A 429 names the limit, and retry-after gives the seconds to wait. Cached input tokens do not count toward the input-tokens-per-minute limit for most models. Use: honour retry-after first, then fall back to exponential backoff (AGENTS.md rule 6).

## Dropped

Not verified, so not used: cache write and read price multipliers, the minimum cacheable prompt length, and any back-pressure measurement.
