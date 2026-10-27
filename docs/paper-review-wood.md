# Peer Review: "The Complete Discipline: Lifecycle Control, Governance, and Operational Hard Rules for LLM Coding Agents"

> **Superseded revision.** Covers earlier revision of paper (Papers I-IV consolidated). Kept as record. Claims about current repo superseded.

**Reviewed document:** earlier consolidation of Papers I-IV, superseded by current `docs/paper.html`  
**Reviewer:** Wood  
**Scope:** Clarity, internal consistency, gaps not covered, structural observations

---

## Summary Assessment

Paper presents coherent, practice-grounded discipline for constraining LLM coding agents. Core insight -- same model that reasons through problems cannot prevent shortcut reasoning, so external enforcement below agent's decision layer required -- sound, well-motivated. Consolidating four prior papers into one reference succeeds in breadth. Main weaknesses: no quantitative evidence for claims, several undefined or under-specified terms in formal apparatus, internal redundancies across sections, edge cases in rules paper does not address.

---

## I. Strengths

**1. External enforcement over self-regulation.** Paper's central argument -- same model that reasons through problem also reasons through justification for shortcuts -- is most important and most underdiscussed point in agent reliability literature. Design choice to place enforcement in Rust hooks below agent's decision layer, not in in-context reasoning, well-justified and distinguishes work from most agent frameworks.

**2. Named mutables make uncertainty visible.** Mutable discipline (S3) operationalizes good epistemic principle: uncertainty not named cannot be managed. Making every unknown explicit before writing code catches assumption propagation before it compounds.

**3. The PRD as durable contract across sessions.** Insight: sessions are scheduling, PRD is the contract (S4.4). Addresses context-window limits without depending on context retrieval. Stop hook blocks session close until PRD empty -- clean enforcement mechanism.

**4. Failure taxonomy (S15).** Catalogues sixteen failure modes across four categories, cross-refs each against planning passes. Practically useful. Naming failure modes stops them being treated as one-off surprises.

**5. The "asking cost" framing (S18).** Unnecessary questions treated as quality failure, same as broken test. Effective reframing. Makes invisible cost of asking-as-progress legible.

## II. Clarity Issues

**1. "tier_confidence" is undefined.**  
Section 14 states verification budget formula as `verification_budget = load x (1 - tier_confidence)`. Load score (lambda) defined (0.0-1.0 consequence weight). `tier_confidence` never defined. Appears in no other section. Reader cannot apply formula without knowing: per-item field, per-tier constant, or computed dynamically?

**2. The four state planes are introduced but never operationalized.**  
Section 13.2 defines four state planes (epistemic, operational, relational, temporal). States phase transition "is legitimate only when all four planes are consistent with the transition's exit condition." No mechanism for checking consistency. What does relational plane consistency mean for EXECUTE->EMIT? What relational state checked? Introduced as formal tool, used only decoratively.

**3. "The 13 skills" referenced in the cross-footer but not in the paper.**  
Footer link to `skills.html` reads "13 skills, one chain, no skipping." Paper describes six skills in chain: `gm -> planning -> gm-execute -> gm-emit -> gm-complete -> update-docs`. Number 13 absent from text. Reader of paper alone cannot reconcile.

**4. The "247420" identifier in the page title is unexplained.**  
Page title is "The Complete Discipline . gm . 247420." Number 247420 appears in navigation and design system import URL. Paper gives no explanation of significance.

**5. "Forced closure" is used as a term of art without formal definition.**  
"Forced closure" used throughout as generic term for premature completion failures. Defined only implicitly through examples. One definitional sentence early would help readers apply term consistently when categorizing new failure modes.

**6. The "weak_prior" status is named but not described.**  
Sections 19.1 and 21 mention recall hits land as `weak_prior`. Paper does not explain how weak_prior differs from resolved mutable in practice -- can agent act on weak_prior without witnessing? Full lifecycle of weak_prior value?

## III. Internal Consistency Issues

**1. Mermaid `startOnLoad` configuration.**  
Paper's own `<script>` block (line 60 of HTML source) initializes mermaid with `startOnLoad: true`. AGENTS.md states `startOnLoad` must be `false` because "the parse happens before article injection, so `startOnLoad` would miss injected blocks." Paper's mermaid diagram is in-page (not injected), so current behavior correct for this file. But config contradicts documented rule without explanation. Flatspace extraction note in AGENTS.md warns per-page head scripts stripped during article extraction -- mermaid diagram would silently break if paper ever extracted through that pipeline.

**2. Redundancy between S13.3 and S15.**  
Five refused collapses (S13.3) overlap substantially with failure taxonomy (S15):
- Refused collapse 3 (partial closure) = Failure mode 9 (partial closure)
- Refused collapse 5 (asking-as-progress) = Failure mode 16 (asking-as-progress)
- Refused collapse 1 (narrating as executing) maps to failure modes 1-3

Paper does not acknowledge overlap or explain whether lists serve different purposes (normative vs. descriptive). Reader must infer distinction.

**3. Wave execution max of 3 subagents stated twice with no rationale.**  
Sections 4.2 and 10 both state wave limit is "up to 3 concurrent subagents." No rationale given. Context-window constraint? Empirically-derived limit? Token budget? If hard rule, should appear in constraint tiers (S7). If guideline, should say so.

**4. The two-pass rule (S3.3) and infinite regression.**  
Mutable unresolvable after two passes gets reclassified as new unknown, agent returns to PLAN. Paper does not address reclassified unknown also failing after two passes. Same blocker persists -> agent could cycle between EXECUTE and PLAN indefinitely. Termination observation (S2.3 blockquote) depends on finite unknowns assumption, but two-pass reclassification can in theory generate new unknowns faster than resolved.

**5. exec:pause and PRD continuity.**  
Section 18 describes `exec:pause` as renaming `prd.yml` to `prd.paused.yml` to surface a question. Section 4 (PRD management) and 4.3 (stop-hook enforcement) never mention `prd.paused.yml`. Unclear whether stop hook fires on `prd.paused.yml`, whether pause state resumable, or what happens if agent restarts before user answers paused question.

## IV. Gaps Not Covered in the Paper

**1. No quantitative evidence for any claim.**  
Paper positions itself as "a practical engineering artifact rather than a theoretical claim" Yet every claim qualitative. No failure rates before/after discipline. No comparison of platforms with full enforcement vs without. No data on how often each failure mode occurs or each hard rule fires. Crude observational data would distinguish "this rule fires often and prevents real failures" from "this rule has never fired in production." Absence makes it impossible to prioritize rules or evaluate which are load-bearing.

**2. Concurrent session behavior on the shared SQLite memory database.**  
Section 19.3 states `rs-learn.db` committed to git so memory state shares across machines and sessions. Paper does not address two agents -- separate machines, separate branches -- both memorizing facts in same turn. SQLite not concurrent DB; parallel writes from two git-synced sessions create merge conflict on binary file. Paper's recommendation to commit DB correct but incomplete without strategy for this conflict case.

**3. The 200-line test budget ceiling (S30.5 Limitation 5) has no resolution.**  
Paper acknowledges in limitations that "genuinely large subsystems may not be adequately witnessed within [the 200-line budget]." But sections 26.1-26.4 give no mechanism for this case. Answer given -- "question whether the assertion is load-bearing" -- shifts responsibility without resolving tension. Project with 20 load-bearing subsystems and 200-line budget can witness only ~10 assertions per subsystem. Adequacy is project-specific judgment paper cannot make for reader, but could acknowledge this more explicitly.

**4. Adversarial or automated contexts undermine the Maximal Cover mid-chain declaration.**  
Section 17 (Maximal Cover) requires agent to declare self-authorized scope expansions in-response "so the user can correct mid-chain." Assumes human watching response stream. In fully automated pipelines -- CI-triggered agents, scheduled tasks, headless execution -- no user to correct mid-chain. Rule as written silently degrades to unconditional self-authorization there. Paper does not address automated deployment at all.

**5. Security model is absent.**  
Paper describes agents operating on real services, real data, and `exec:browser` managed Chromium instance. No discussion of malicious code being processed, sandbox boundary, or blast radius when task runs against real external APIs. Brief threat model acknowledgment -- "we assume the agent operates on trusted repositories with trusted user input" -- would locate discipline correctly.

**6. Conflict between "Fix on Sight" and scope boundaries.**  
Section 22 mandates fixing every surfaced issue in-band, this turn, at root cause. Section 22.1 carves out "genuinely out-of-reach errors" (user credentials, external services down, product decisions). No guidance on middle case: errors within technical reach but high breakage risk -- refactoring shared utility used by 50 files because bug found mid-task. "Fix on Sight" with full scope implies changing that utility; "minimal-change resolution" might suggest local workaround. Paper leaves tension unresolved.

**7. The "nothing fake" stub detection rule has no mechanical test.**  
Section 24 defines stubs behaviorally: "code paths that always succeed, always return the same value regardless of input, or short-circuit a real call to satisfy a type signature." Useful definition, but reviewer (agent or human) must reason about runtime behavior from source. Paper does not describe how pre-tool-use hook or any automated mechanism detects stubs at enforcement time. If detection only manual, enforcement softer than "Tier 0 absolute" framing suggests.

**8. No discussion of how the discipline interacts with model capability differences.**  
Paper deployed across 12 platforms spanning multiple models (Claude, Gemini, Codex, Qwen, etc.). Discipline's effectiveness likely varies across models -- weaker tool use may trigger two-pass rule more often; strong context management may need memory system less. Paper treats model capability as uniform, limiting generalizability.

**9. The Implicit Skill Prose rule (S29) creates a bootstrapping problem.**  
Paper prohibits numbered step lists in skill files ("the skill is a prompt, not a manual"). Yet paper itself uses numbered procedures extensively to describe each rule to human reader. When rule embedded in skill for agent, transformation from explicit numbered procedure (as in paper) to implicit eliciting prose (as required by S29) not described. Documentation-to-implementation gap.

**10. No guidance on rule conflict resolution.**  
Paper defines at least seven hard rules (SS21-29), four constraint tiers (S7), seven route families (S13.1). What happens when rules conflict? Example: "Fix on Sight" (S22) says fix immediately; "Web-Search Before Pause" (S25) says search before pausing; but searching requires exec:codesearch call which in EMIT phase should be blocked (S9.1 notes "Glob/Grep/Find tools are hook-blocked during agent phases"). If bug surfaces during EMIT needing search to diagnose, does Fix on Sight override EMIT tool restrictions, or trigger backward transition first? Paper has no explicit rule conflict resolution layer.

## V. Structural Observations

**1. Sections 21-29 lack a phase-layer identity.**  
Intro states SS2-8 cover Phase I, SS9-12 Phase II, SS13-16 Phase III, SS17-20 Phase IV, SS21-29 cover "operational hard rules that emerged from production." Operational hard rules most numerous (9 sections vs. 4 per earlier phase) but no corresponding phase or layer label. Harder to reason about as set -- no principle unifying beyond "emerged from production." Brief framing of common traits and relation to four-phase model would improve navigability.

**2. The Glootie callout appears only once.**  
Paper introduces Glootie as stylistic device with dedicated CSS class and mascot styling. Callout appears only at S2. If Glootie serves rhetorical function (highlighting non-obvious implications), using it once suggests device added to S2 then abandoned, or only S2 has non-obvious implication. Either reading reflects on paper's use of device.

**3. The references section is thin for the breadth claimed.**  
Six references cited. Paper claims relationships to formal methods, design-by-contract, TDD, model checking (S30), broader agent reliability literature. Six references (ReAct, Reflexion, SWE-agent, Chain-of-Thought, Generative Agents, Voyager) cover planning and reasoning but omit directly relevant work on agent scaffolding, tool use, compositional agent frameworks. No reference for formal methods analogies in S30.1.

**4. The abstract claims the discipline is "complete."**  
Title and abstract use "complete" without qualification. Section 30.5 lists five acknowledged limitations; this review identifies additional gaps. "Complete" here seems to mean "consolidates all previously described rules," not "closes all failure modes" -- distinction should be explicit in abstract.

## VI. Minor Issues

- S7 lists `max_file_lines=200` as Tier 1 quality constraint. Section 26 gives `test.js` 200-line hard cap. Coincidence of number unexplained -- same constraint applied to specific file, or coincidentally equal values?
- S8 describes pre-emit and post-emit verification using in-memory imports. Most CI systems (and many Rust/Go toolchains) do not support "importing a module in-memory" like Node.js. Protocol applies cleanly to JS/TS but paper presents it as universal.
- S16.3 catalogues "five CI failure shapes for rapid triage." Useful, but list incomplete (no OOM, network flap, flaky test, or environment-specific failures) without acknowledging these are most common, not all possible.
- Termination observation in S2.3 labeled "Observation," formatted as blockquote, neither cited nor proven. Calling it observation implies empirical support it lacks.

## Summary of Critical Gaps

| Gap | Severity | Section Affected |
|---|---|---|
| `tier_confidence` undefined | Blocks formula use | S14 |
| No quantitative evidence | Undermines empirical claims | S31 |
| Concurrent SQLite writes under git sync | Data loss risk | S19.3 |
| Two-pass rule infinite regression | Logical hole | S3.3 |
| exec:pause + stop-hook interaction | Operational ambiguity | S4.3, S18 |
| Rule conflict resolution absent | Behavioral gap | All hard rules |
| Automated context breaks Maximal Cover mid-chain guarantee | Deployment gap | S17 |
| Stub detection not mechanical | Enforcement softness | S24 |
| State plane consistency check not operationalized | Formal apparatus incomplete | S13.2 |