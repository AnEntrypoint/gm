# Peer Review: "The Complete Discipline: Lifecycle Control, Governance, and Operational Hard Rules for LLM Coding Agents"

**Reviewed document:** `docs/paper.html` (May 2026 consolidation of Papers I-IV)  
**Reviewer:** Wood  
**Scope:** Clarity, internal consistency, gaps not covered in the paper, and structural observations

---

## Summary Assessment

The paper presents a coherent, practice-grounded discipline for constraining LLM coding agents. Its core insight -- that self-regulation by the same model that reasons through problems cannot prevent shortcut reasoning, and therefore external enforcement below the agent's decision layer is required -- is sound and well-motivated. The consolidation of four prior papers into one reference document succeeds in breadth. The primary weaknesses are: the absence of quantitative evidence for any of the claims, several undefined or under-specified terms in the formal apparatus, internal redundancies across sections, and a set of edge cases in the rules themselves that the paper does not address.

---

## I. Strengths

**1. External enforcement over self-regulation.** The paper's central argument -- that the same model that reasons through a problem also reasons through the justification for shortcuts -- is the most important and most underdiscussed point in the agent reliability literature. The design choice to place enforcement in Rust hooks below the agent's decision layer rather than in the agent's in-context reasoning is well-justified and distinguishes this work from most agent frameworks.

**2. Named mutables make uncertainty visible.** The mutable discipline (S3) operationalizes a good epistemic principle: uncertainty that is not named cannot be managed. Making every unknown explicit before writing code is a discipline that catches assumption propagation before it compounds.

**3. The PRD as durable contract across sessions.** The insight that sessions are scheduling while the PRD is the contract (S4.4) addresses context-window limitations without depending on context retrieval. The stop hook that blocks session close until the PRD is empty is a clean enforcement mechanism.

**4. Failure taxonomy (S15).** Cataloguing sixteen failure modes across four categories and cross-referencing each against planning passes is practically useful. Naming failure modes prevents them from being treated as one-off surprises.

**5. The "asking cost" framing (S18).** Treating unnecessary questions as a quality failure equivalent to a broken test is an effective reframing. It makes the invisible cost of asking-as-progress legible.

---

## II. Clarity Issues

**1. "tier_confidence" is undefined.**  
Section 14 states the verification budget formula as `verification_budget = load x (1 - tier_confidence)`. The load score (lambda) is defined (0.0-1.0 consequence weight). `tier_confidence` is never defined. It appears in no other section. A reader cannot apply this formula without knowing whether tier_confidence is a per-item field, a per-tier constant, or computed dynamically.

**2. The four state planes are introduced but never operationalized.**  
Section 13.2 defines four state planes (epistemic, operational, relational, temporal) and states that a phase transition "is legitimate only when all four planes are consistent with the transition's exit condition." The paper provides no mechanism for checking this consistency. What does it mean for the relational plane to be consistent with EXECUTE->EMIT? What relational state is checked? This is introduced as a formal tool but used only decoratively.

**3. "The 13 skills" referenced in the cross-footer but not in the paper.**  
The footer link to `skills.html` reads "13 skills, one chain, no skipping." The paper describes six skills in the chain: `gm -> planning -> gm-execute -> gm-emit -> gm-complete -> update-docs`. The number 13 does not appear in the text. A reader of the paper alone cannot reconcile this.

**4. The "247420" identifier in the page title is unexplained.**  
The page title is "The Complete Discipline . gm . 247420." The number 247420 appears in the navigation and in the design system import URL. No explanation of its significance is given in the paper.

**5. "Forced closure" is used as a term of art without formal definition.**  
"Forced closure" appears throughout the paper as the generic term for premature completion failures. It is defined only implicitly through examples. A single definitional sentence early in the paper would help readers apply the term consistently when categorizing new failure modes.

**6. The "weak_prior" status is named but not described.**  
Sections 19.1 and 21 mention that recall hits land as `weak_prior`. The paper does not explain how weak_prior differs from a resolved mutable in practice -- can the agent act on a weak_prior without witnessing? What is the full lifecycle of a weak_prior value?

---

## III. Internal Consistency Issues

**1. Mermaid `startOnLoad` configuration.**  
The paper's own `<script>` block (line 60 of the HTML source) initializes mermaid with `startOnLoad: true`. AGENTS.md states that `startOnLoad` must be `false` because "the parse happens before article injection, so `startOnLoad` would miss injected blocks." The paper's mermaid diagram is in-page (not injected), so the current behavior is correct for this file. However, the configuration in the paper contradicts the documented rule without explanation, and the flatspace extraction note in AGENTS.md warns that per-page head scripts are stripped during article extraction -- meaning the mermaid diagram would silently break if the paper were ever extracted through that pipeline.

**2. Redundancy between S13.3 and S15.**  
The five refused collapses (S13.3) overlap substantially with the failure taxonomy (S15):
- Refused collapse 3 (partial closure) = Failure mode 9 (partial closure)
- Refused collapse 5 (asking-as-progress) = Failure mode 16 (asking-as-progress)
- Refused collapse 1 (narrating as executing) maps to failure modes 1-3

The paper does not acknowledge this overlap or explain whether the two lists serve different purposes (normative vs. descriptive). A reader must infer the distinction.

**3. Wave execution max of 3 subagents stated twice with no rationale.**  
Sections 4.2 and 10 both state the wave limit is "up to 3 concurrent subagents." No rationale is given. Is this a context-window constraint? An empirically-derived limit? A token budget? If it is a hard rule it should appear in the constraint tiers (S7). If it is a guideline it should say so.

**4. The two-pass rule (S3.3) and infinite regression.**  
If a mutable is unresolvable after two passes, it is reclassified as a new unknown and the agent returns to PLAN. The paper does not address what happens when the reclassified unknown also fails to resolve after two passes. If the same underlying blocker persists, the agent could cycle between EXECUTE and PLAN indefinitely. The termination observation (S2.3 blockquote) depends on the finite unknowns assumption, but the two-pass reclassification mechanism can in theory generate new unknowns faster than they are resolved.

**5. exec:pause and PRD continuity.**  
Section 18 describes `exec:pause` as renaming `prd.yml` to `prd.paused.yml` to surface a question. Section 4 (PRD management) and section 4.3 (stop-hook enforcement) make no mention of `prd.paused.yml`. It is unclear whether the stop hook fires on `prd.paused.yml`, whether the pause state is resumable, or what happens if the agent restarts before the user responds to the paused question.

---

## IV. Gaps Not Covered in the Paper

**1. No quantitative evidence for any claim.**  
The paper explicitly positions itself as "a practical engineering artifact rather than a theoretical claim" and acknowledges production use across 12 platforms over two months. Yet every claim is qualitative. No failure rates before/after applying the discipline are reported. No comparison between platforms with full enforcement and platforms without it. No data on how often each failure mode occurs or how often each hard rule fires. Even crude observational data would distinguish "this rule fires often and prevents real failures" from "this rule has never fired in production." The absence makes it impossible to prioritize the rules or evaluate which are load-bearing.

**2. Concurrent session behavior on the shared SQLite memory database.**  
Section 19.3 states that `rs-learn.db` is committed to git so memory state shares across machines and sessions. The paper does not address what happens when two agents -- running on separate machines against separate branches -- both memorize facts in the same turn. SQLite is not a concurrent database; parallel writes from two git-synced sessions would create a merge conflict on a binary file. The paper's recommendation to commit the database is correct but incomplete without a strategy for this conflict case.

**3. The 200-line test budget ceiling (S30.5 Limitation 5) has no resolution.**  
The paper acknowledges in limitations that "genuinely large subsystems may not be adequately witnessed within [the 200-line budget]." But sections 26.1-26.4 give no mechanism for handling this case. The answer given -- "question whether the assertion is load-bearing" -- shifts the responsibility without resolving the tension. A project with 20 load-bearing subsystems and a 200-line budget can witness only ~10 assertions per subsystem. Whether that is adequate is a project-specific judgment the paper cannot make for the reader, but it could acknowledge this more explicitly.

**4. Adversarial or automated contexts undermine the Maximal Cover mid-chain declaration.**  
Section 17 (Maximal Cover) requires the agent to declare self-authorized scope expansions in-response "so the user can correct mid-chain." This assumes a human is watching the response stream. In fully automated pipelines -- CI-triggered agents, scheduled tasks, headless execution -- there is no user to correct mid-chain. The rule as written degrades silently to unconditional self-authorization in those contexts. The paper does not address automated deployment at all.

**5. Security model is absent.**  
The paper describes agents operating on real services with real data and a `exec:browser` managed Chromium instance. No discussion of what happens when the code being processed is malicious, what the sandbox boundary is, or what blast radius is possible when a task runs against real external APIs. Even a brief acknowledgment of the threat model -- "we assume the agent operates on trusted repositories with trusted user input" -- would locate the discipline correctly.

**6. Conflict between "Fix on Sight" and scope boundaries.**  
Section 22 mandates fixing every surfaced issue in-band, this turn, at root cause. Section 22.1 carves out "genuinely out-of-reach errors" (user credentials, external services down, product decisions). But the paper gives no guidance on the middle case: errors that are within technical reach but have high risk of breakage -- refactoring a shared utility used by 50 files because it has a bug discovered mid-task. "Fix on Sight" with full scope implies changing that utility; "minimal-change resolution" might suggest a local workaround instead. The paper leaves this tension unresolved.

**7. The "nothing fake" stub detection rule has no mechanical test.**  
Section 24 defines stubs behaviorally: "code paths that always succeed, always return the same value regardless of input, or short-circuit a real call to satisfy a type signature." This is a useful definition but it requires the reviewer (agent or human) to reason about runtime behavior from source code. The paper does not describe how the pre-tool-use hook or any automated mechanism detects stubs at enforcement time. If detection is only manual, the rule's enforcement level is softer than the "Tier 0 absolute" framing suggests.

**8. No discussion of how the discipline interacts with model capability differences.**  
The paper is deployed across 12 platforms spanning multiple underlying models (Claude, Gemini, Codex, Qwen, etc.). The discipline's effectiveness likely varies across models -- a model with weaker tool use may trigger the two-pass rule more frequently; a model with strong context management may require the memory system less. The paper treats model capability as uniform, which limits its generalizability.

**9. The Implicit Skill Prose rule (S29) creates a bootstrapping problem.**  
The paper prohibits numbered step lists in skill files ("the skill is a prompt, not a manual"). Yet the paper itself uses numbered procedures extensively to describe each rule to a human reader. When a rule needs to be embedded in a skill for the agent, the transformation from explicit numbered procedure (as written in the paper) to implicit eliciting prose (as required by S29) is not described. This is a documentation-to-implementation gap.

**10. No guidance on rule conflict resolution.**  
The paper defines at least seven hard rules (SS21-29) plus four constraint tiers (S7) plus seven route families (S13.1). What happens when rules conflict? Example: "Fix on Sight" (S22) says fix immediately; "Web-Search Before Pause" (S25) says search before pausing; but searching requires an exec:codesearch call which in EMIT phase should be blocked (S9.1 notes that "Glob/Grep/Find tools are hook-blocked during agent phases"). If a bug surfaces during EMIT that requires search to diagnose, does Fix on Sight override the EMIT tool restrictions, or does it trigger a backward transition first? The paper has no explicit rule conflict resolution layer.

---

## V. Structural Observations

**1. Sections 21-29 lack a phase-layer identity.**  
The introduction states that SS2-8 cover Phase I, SS9-12 Phase II, SS13-16 Phase III, SS17-20 Phase IV, and SS21-29 cover "operational hard rules that emerged from production." The operational hard rules are the most numerous section of the paper (9 sections vs. 4 for each earlier phase) but have no corresponding phase or layer label. They are harder to reason about as a set because there is no principle unifying them beyond "emerged from production." A brief framing of what these rules have in common and how they relate to the four-phase model would improve navigability.

**2. The Glootie callout appears only once.**  
The paper introduces Glootie as a stylistic device with a dedicated CSS class and mascot styling. The callout appears only at S2. If Glootie serves a rhetorical function (highlighting non-obvious implications), using the device only once suggests either that the device was added to S2 and then abandoned, or that only S2 contains a non-obvious implication. Either reading reflects on the paper's use of the device.

**3. The references section is thin for the breadth claimed.**  
Six references are cited. The paper claims relationships to formal methods, design-by-contract, TDD, model checking (S30), and the broader agent reliability literature. The six references (ReAct, Reflexion, SWE-agent, Chain-of-Thought, Generative Agents, Voyager) cover planning and reasoning but omit directly relevant work on agent scaffolding, tool use, and compositional agent frameworks. No reference is given for the formal methods analogies in S30.1.

**4. The abstract claims the discipline is "complete."**  
The title and abstract use "complete" without qualification. Section 30.5 lists five acknowledged limitations, and this review identifies additional gaps. "Complete" as used here seems to mean "consolidates all previously described rules" rather than "closes all failure modes" -- the distinction should be made explicit in the abstract.

---

## VI. Minor Issues

- S7 lists `max_file_lines=200` as a Tier 1 quality constraint. Section 26 gives `test.js` a 200-line hard cap. The coincidence of the number is unexplained -- are these the same constraint applied to a specific file, or coincidentally equal values?
- S8 describes pre-emit and post-emit verification using in-memory imports. Most CI systems (and many Rust/Go toolchains) do not support "importing a module in-memory" in the same sense as Node.js. The protocol as described applies cleanly to JS/TS but the paper presents it as universal.
- S16.3 catalogues "five CI failure shapes for rapid triage." The cataloguing is useful but the list is incomplete (no coverage of OOM, network flap, flaky test, or environment-specific failures) without acknowledgment that these are the most common, not all possible.
- The termination observation in S2.3 is labeled "Observation" and formatted as a blockquote but is neither cited nor proven. Calling it an observation creates an impression of empirical support it does not have.

---

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
| Stub detection is not mechanical | Enforcement softness | S24 |
| State plane consistency check not operationalized | Formal apparatus incomplete | S13.2 |
