ASD-STE100 (Simplified Technical English) governs gm prose.

The rule applies to these files: AGENTS.md, CLAUDE.md, SKILL.md files, rs-plugkit phase-prose sources, gate-denial text, README.md, CHANGELOG.md, and instructional docs under .gm/ and gm-plugkit/instructions/.

Scope split with the Documentation Policy in AGENTS.md: STE100 sets word choice and sentence grammar. The Documentation Policy sets what content to write. Apply both rules together.

Vocabulary rule: use only the words in dictionary.json. Each approved word has one part of speech and one meaning. Use the approved word from dictionary.json in place of a banned synonym. Gm terms (PRD, FSM, WASM, CDP, ABI, KV) are a separate list. Define each gm term at its first use in a document.

Sentence rules: write short sentences. A procedural sentence has at most 20 words. A descriptive sentence has at most 25 words. Write one idea per sentence. Split a long sentence into two short sentences.

Voice rule: use the active voice. Use the simple present tense for a fact that is always true.

Noun rule: use at most 3 nouns in a row. Add a preposition to break up a longer cluster.

Procedure rule: write an instruction as one command. Put one action in each step. Write the steps in the order to do them. Put a conditional word (IF, WHEN, BEFORE, AFTER) at the start of its sentence. Use one conditional clause per instruction.

Description rule: do not drop words to save space. State one fact per sentence.

Warning rule: a WARNING states a hazard that can kill or injure a person. A CAUTION states a hazard that can damage equipment or data. A NOTE states other useful information. Put a WARNING or a CAUTION before the step it protects. State the hazard first. State the consequence next.

Abbreviation rule: use only an abbreviation from dictionary.json, or a gm term defined at its first use.

Checker rule: run the ste100 checker on a changed prose file before VERIFY accepts it. The checker run is a real, witnessed execution. A prose claim of compliance is not proof.
