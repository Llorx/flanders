# Prompt wording economy

## Every prompt Flanders authors is worded economically

Every prompt Flanders authors expresses each obligation it carries in the fewest words that state it unambiguously. A sentence, clause, list item, section, or carve-out earns its place only when it carries something not already carried — by another sentence in the same prompt, by the prompt's surrounding structure, or by the reader's ordinary competence — and the prompt reaches for more words only where fewer would leave an instruction ambiguous or would fuse genuinely separable instructions into one place. This constrains how the prompt text itself is written, and is distinct from the obligation that the `/flanders-spec` and `/flanders-plan` skill bodies instruct the skill to produce economical output, pinned by [src/prompts/.spec/rules/ai/skills/skills-common.md#the-flanders-spec-and-flanders-plan-skill-bodies-instruct-economy-of-files-and-words](/src/prompts/.spec/rules/ai/skills/skills-common.md#the-flanders-spec-and-flanders-plan-skill-bodies-instruct-economy-of-files-and-words): that rule governs the economy of the documents a skill produces, this rule governs the economy of the prompt's own wording.

### Who this applies to

- **Subject:** the construction of every prompt Flanders authors as fixed scaffolding — the prompt text Flanders bakes in, as opposed to the per-run content it passes through:
  - the `implement` command's worker prompt;
  - the `implement` command's reviewer prompt(s);
  - the `/flanders-work` skill's reviewer subagent prompt;
  - the shared voice and tone instruction text those prompts carry;
  - the `/flanders-spec`, `/flanders-plan`, and `/flanders-work` skill artifact bodies.
- **Not subject:** the per-run content the orchestrator passes through a prompt rather than authors as scaffolding — the task text and its acceptance criteria, the consolidated reference content an agent reads, the change-set instructions tied to a single run, and the user's own request. The economy of the spec and plan files that become that reference content is governed where those files are authored, by [src/prompts/.spec/rules/ai/skills/skills-common.md#the-flanders-spec-and-flanders-plan-skill-bodies-instruct-economy-of-files-and-words](/src/prompts/.spec/rules/ai/skills/skills-common.md#the-flanders-spec-and-flanders-plan-skill-bodies-instruct-economy-of-files-and-words). Other agents and commands, and any non-prompt source, are out of scope.

### How to apply

When authoring or editing a prompt in scope, state each obligation once, in the fewest words that leave it unambiguous, and add a sentence, clause, section, or carve-out only when it carries something the prompt does not already carry elsewhere or that the reader would otherwise get wrong. The test for whether a piece of content earns its place is whether removing it would leave an obligation ambiguous, fuse separable instructions, or drop a fact the reader needs — not whether the prompt reads shorter. Economy never strips content a reader needs to act correctly: a carve-out, an exclusion item, or a precise qualifier a competent reader would otherwise misjudge is load-bearing and stays — for example the voice exclusion set that fences the Flanders flavor out of code, paths, diagnostics, and other machine-read tokens, pinned by [src/prompts/.spec/rules/ai/flanders-tone.md#flanders-prompts-instruct-the-agent-to-adopt-the-soft-flanders-voice-in-its-user-facing-narration](/src/prompts/.spec/rules/ai/flanders-tone.md#flanders-prompts-instruct-the-agent-to-adopt-the-soft-flanders-voice-in-its-user-facing-narration).

### Why

A prompt is the most-read scaffolding in the system: every agent invocation re-reads all of it and pays for every word in tokens and in the attention left for the obligations that matter. Restated instructions, ceremony, and carve-outs that guard nothing bury the load-bearing content and make the prompt harder to audit and to keep correct as it changes. Wording each obligation once, in the fewest words that keep it unambiguous, keeps the prompt's signal high without surrendering any precision a reader needs.

### Failure signals

- A prompt in scope states an obligation it already carries elsewhere — a sentence restating a point made above, a carve-out duplicating one already stated, or a section re-explaining an instruction already given.
- A prompt in scope spends words that add no precision — ceremony, or restatement of what the reader's ordinary competence already supplies.
- A prompt in scope splits one instruction across separable places, or fuses genuinely separable instructions into one place, where stating it once in its own place would be unambiguous.
- Brevity is taken so far that a load-bearing carve-out, exclusion item, or qualifier a competent reader needs is dropped, leaving an obligation ambiguous or a required fact missing.
