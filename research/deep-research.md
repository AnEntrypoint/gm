# Deep research: long-horizon worker design

Run: deep-research workflow, run `wf_77db7747-1a6`, 2026-11-01.

Question: the gm brief, which asks for the simplest, most performant, most adaptable worker for the longest-horizon task, using the best practice that emerged over the past 12 months.

Method: 5 search angles (broad, academic, recent industry, contrarian, practitioner). 21 sources fetched, 80 claims extracted, 25 claims verified by 3-vote adversarial review (a claim dies at 2 of 3 refutes). Result: 13 confirmed, 12 refuted, 0 unverified. 103 agent calls, 0 errors.

Confidence: no finding reaches high. Each rests on one or two primary sources, most votes split 2-1, and the numbers are self-reported. Read every finding as a hypothesis to test on gm's own workload.

## Confirmed findings

1. **Keep a complete, queryable record instead of discarding history.** Confidence: medium. A long-horizon worker logs observations, actions and outcomes, and answers questions by running code over the log (grep, jq, Python) rather than relying on a lossy summary.
   - Sources: arxiv 2607.20064 (PRO-LONG); github.com/alexisfox7/PRO-LONG; a secondary Codex write-up (promotional, URL truncated in source notes).
   - Evidence: events go to `.prolong/log.jsonl`. Headline results are self-reported on ARC-AGI-3 and NetHack (97.4% best@2 lower bound at 2,000 actions). The README says coding-tool integrations are not benchmarked. Log growth and retrieval cost are not analysed. The 18.0 pp average gain was refuted 1-2 and is excluded.

2. **Validate compaction instead of trusting it.** Confidence: medium. Run the compactor alongside execution, and check each candidate summary against the next k steps with a trajectory-grounded judge. The gain comes from the validation step, not from asynchrony alone.
   - Sources: arxiv 2605.08580 (Slipstream), its HTML rendering, and github.com/StrGm-AI-Ltd/agentic-coding-evaluation issue 422 (reproduces the figures, disputes the mechanism).
   - Evidence: up to 8.8 pp accuracy and up to 39.7% latency reduction versus synchronous compaction. The 8.8 pp maximum is SWE-bench only (Qwen3.5-9B). BrowseComp gains are 1.3 to 4.6 pp. Async-only captures most of the latency benefit but not the accuracy. Table 1 has an arithmetic slip (6.6 listed for a 6.8 pp gap). v1 preprint, no independent replication. The "structural validation gap" framing was refuted 0-3.

3. **Compaction can silently delete governance rules.** Confidence: medium. Whether a rule survives a summary predicts whether the agent violates it.
   - Sources: arxiv 2606.22528v2 (ConstraintRot); github.com/ksdisch/decay-pin (small independent reproduction); arxiv 2608.11242 (corroborates the risk in another scenario).
   - Evidence: pooled violation is 0% with full history and 30% after one compaction step, across seven model families (9 tasks, 1,323 episodes). Survival split: 0% when the rule is kept (n=90) vs 38% when dropped (n=315). The split is observational and confounded with summary aggressiveness. decay-pin reports 0/20 to 20/20 in small trials. The remedy, Constraint Pinning, was refuted 0-3, so this finding supports the risk only.

4. **Expose context management as a callable action.** Confidence: medium. Treat compaction as a tool the agent plans and calls, on par with file edits and commands, not as a passive trigger at a length threshold.
   - Sources: arxiv 2512.22087 (Context as a Tool, SWE-Compressor 32B); its HTML rendering; huggingface.co/papers/2512.22087.
   - Evidence: 57.6% on SWE-bench Verified (N=500) vs 49.8 for ReAct and 53.8 for threshold compression. Table 3 reports 57.8 and does not reconcile the 0.2 pt gap. Single run, no variance. Below frontier models in the same table (GPT-5.1 76.3, Claude-4.5-Sonnet 77.2). The "about 47% fewer tokens" claim was refuted 0-3.

5. **Train the summariser with the agent.** Confidence: medium. Summary tokens come from the same trainable policy and are inside the RL objective. There is no separate summary-quality reward.
   - Sources: arxiv 2607.05378 (CompactionRL, v2, 6 July 2026); its HF rendering.
   - Evidence: compacted Pass@1 without summary tokens in the objective vs with them: SWE-bench Verified 54.5 to 56.0 (GLM-4.7-Flash) and 64.5 to 66.8 (GLM-4.5-Air); Terminal-Bench 2.0 12.4 to 20.2 and 21.5 to 24.5. The authors develop the models they evaluate. SWE-bench subset of 200 tasks. No independent reproduction. The 9.2% gain attributed to arXiv 2610.02163 was refuted 0-3.

6. **Measure the single-worker baseline before fanning out.** Confidence: medium. Single-agent baseline performance is the most robust predictor of whether adding coordinating agents helps or hurts (260 configurations, six benchmarks, five architectures, three LLM families).
   - Sources: ubicomplab.cs.washington.edu Nature Machine Intelligence 2026 publication (DOI 10.1038/s42256-026-01268-y); arxiv 2512.08296 (same finding per verifier, not a voted claim).
   - Evidence: abstract wording only, not byte-verified. The full nature.com text was not read (login redirect). Configuration count conflicts (180 vs 260). A secondary summary reports a cross-validated R^2 near 0.37. LLM agents only.

7. **A capability-saturation threshold exists.** Confidence: low. The authors report it predicts the coordination effect in 94% of validation configurations.
   - Evidence: only the abstract was read. The 94% denominator is unclear (one summary reads 15/16, so one miss moves it about six points). Two benchmarks. A 45% figure from arxiv 2512.08296 comes from a search summary and was not fetched. Do not use 94% or 45% as design constants.

8. **Anthropic's harness article (24 March 2026) says start simple.** Confidence: low. The index entry, title and date were voted (3-0). The body was read once, not voted.
   - Sources: anthropic.com/engineering/harness-design-long-running-apps; anthropic.com/engineering index.
   - Body guidance from one fetch: fresh-context agents with structured handoffs were preferred over compaction for Sonnet 4.5. A separate evaluator beat self-critique. A solo run (20 min, $9) vs the full harness (6 hr, $200), where the solo app's core feature did not work (n=1). The sprint construct was removed for Opus 4.6. The article revises its own model-specific choices, so treat it as dated practice.

9. **The agent loop is a feedback cycle.** Confidence: medium, low design leverage. Gather context, take action, verify work, repeat.
   - Source: anthropic.com/engineering/building-agents-with-the-claude-agent-sdk (dated 29 September 2025). Descriptive, first-party, single source. The article scopes the chain to Claude Code in its lead sentence, and generalises it in the figure caption.

## Refuted claims (excluded)

Each was refuted at 2 or more of 3 votes unless marked otherwise.

- PRO-LONG improves ARC-AGI-3 by 18.0 pp on average (1-2).
- Compaction should be triggered by staleness of earlier exploration (0-3). Source: arxiv 2610.02163.
- Compaction should be learned jointly with coding actions by RL, with a 9.2% SWE-bench gain (0-3). Source: arxiv 2610.02163.
- Synchronous compaction has a structural validation gap (0-3). Source: arxiv 2605.08580.
- Constraint Pinning restores compliance at low token cost (0-3). Source: arxiv 2606.22528v2.
- Context as a Tool uses about 47% fewer tokens at 500 steps (0-3). Source: HF 2512.22087.
- Compaction is implemented by summarising and continuing under compressed context, as the core mechanism (0-3). Source: arxiv 2607.05378.
- Memory is the substrate through which agents self-evolve (0-3). Source: arxiv 2602.06052.
- Short-term memory gates which experiences are perceived, selected and abstracted (0-3). Source: arxiv 2602.06052.
- Subagents run in isolated context windows and return only relevant results (1-2). Source: Anthropic Claude Agent SDK article.
- MAST 14-mode failure taxonomy, with kappa 0.88 and 0.77 (0-3). Source: HF 2503.13657.
- Organisational design gains of 15.6 pp (0-3). Source: HF 2503.13657.

## Open questions

1. Does re-injecting governance rules outside the compactor restore compliance without losing permitted actions? The risk is supported (finding 3). The remedy was refuted, so this needs a controlled test on rules of gm's kind.
2. Does a validated compactor (finding 2) or a query-the-full-log design (finding 1) do better on the same long-horizon tasks? No head-to-head comparison exists in the evidence.
3. Does the single-agent baseline rule hold for one long run with parallel subagents, and where is the real saturation threshold? The full Nature Machine Intelligence text was not read.
4. Do subagents with isolated context improve long-horizon outcomes, or only add coordination cost? The isolation claim was refuted 1-2, so neither benefit nor cost is shown.

## Caveats

- Numbers conflict across sources: Context as a Tool 57.6 vs 57.8 and ReAct 49.8 vs 48.8; PRO-LONG pass@1 vs best@2; Slipstream Table 1 arithmetic; Nature Machine Intelligence configurations 180 vs 260.
- Verbatim status: quotes behind findings 3, 5, 6 and 7 came from model-summarised fetches. Claim 5's quoted sentence failed its quote check.
- Time sensitivity: sources span December 2025 to October 2026. The field moves fast.
- Benchmarks are SWE-bench Verified, Terminal-Bench 2.0, BrowseComp, ARC-AGI-3, NetHack and one inbox scenario. None is a long-horizon PRD or graph-orchestration workload, which is gm's shape.
- This report is evidence only. It does not design gm. See `DESIGN.md`.

## Sources

Primary: arxiv 2607.20064; arxiv 2605.08580; arxiv 2606.22528v2; arxiv 2512.22087; arxiv 2607.05378; arxiv 2602.06052; arxiv 2603.01045; arxiv 2610.02163 (via papers.cool); arxiv 2512.08296; arxiv 2608.11242; Nature Machine Intelligence 2026 (DOI 10.1038/s42256-026-01268-y); huggingface.co/papers/2503.13657; huggingface.co/papers/2512.22087; huggingface.co/papers/2607.05378; anthropic.com/engineering/harness-design-long-running-apps; anthropic.com/engineering/building-agents-with-the-claude-agent-sdk; anthropic.com/engineering index.

Secondary or blog (used only for leads): github.com/alexisfox7/PRO-LONG; github.com/ksdisch/decay-pin; github.com/StrGm-AI-Ltd/agentic-coding-evaluation issue 422; dev.to and yage.ai posts; callsphere.ai and tianpan.co posts; beri.net summary of the Anthropic harness article.
