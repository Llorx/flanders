# Flanders tone in prompts

## Flanders prompts instruct the agent to adopt the soft Flanders voice in its user-facing narration

Every prompt Flanders builds for an agent or skill that produces user-facing natural-language narration includes an instruction to season that narration with the soft Ned-Flanders voice defined in [.spec/contracts/shared/flanders-voice.md](/.spec/contracts/shared/flanders-voice.md). The instruction is part of how each such prompt is constructed; it carries the voice into text the tool does not produce itself but only elicits from an agent.

### Who this applies to

- **Subject:** the construction of every Flanders-authored prompt whose agent or skill streams or prints natural-language narration to the user:
  - the `implement` command's worker prompt;
  - the `implement` command's reviewer prompt(s);
  - the `/flanders-work` skill's reviewer subagent prompt;
  - the `/flanders-spec`, `/flanders-plan`, `/flanders-work`, and `/flanders-hard-stop-review` skill artifact bodies, for the messages those skills address to the user.
- **Not subject:** the `implement` and `install` commands' own deterministic output, which carries the voice directly rather than through a prompt instruction (see [.spec/contracts/shared/flanders-voice.md](/.spec/contracts/shared/flanders-voice.md)); and the task text, reference content, change-set instructions, and verdict-file protocol the orchestrator provides to an agent — whether in the prompt or in the consolidated `spec.md` the agent reads — which this rule leaves unchanged.

### Behavior

The tone instruction each in-scope prompt carries tells the agent or skill to use a light Ned-Flanders touch in the messages it addresses to the user, only while it is addressing them in English — any other language is delivered plainly — and to keep the flavor out of code, file paths, command lines, flag tokens, the factual content of diagnostics, machine-read tokens, commit messages, and the files a skill authors or the code `/flanders-work` writes (a reviewer additionally keeps it out of the violation entries it records). The instruction trusts the agent's own knowledge of the character: it describes the voice in the abstract and names no concrete example mannerism in any language, English included — no sample greeting, interjection, suffix, or catchphrase. The exclusion set inlined here matches [.spec/contracts/shared/flanders-voice.md](/.spec/contracts/shared/flanders-voice.md).

The tone instruction inside each skill artifact body is inlined and self-contained, carrying no citation of a Flanders-internal spec path, consistent with [src/prompts/.spec/rules/ai/skills/skills-common.md#flanders-skill-artifact-prompts-are-self-contained--no-citations-of-flanders-internal-spec-paths](/src/prompts/.spec/rules/ai/skills/skills-common.md#flanders-skill-artifact-prompts-are-self-contained--no-citations-of-flanders-internal-spec-paths): the exclusion set above is written out in the body rather than referenced by path.

### Why

The tool controls its own output directly, but the worker, the reviewers, and the installed skills generate their own text, so the only way the voice reaches that text is by asking for it where the prompt is built. Fencing the flavor out of code, diagnostics, reviewer violations, and authored artifacts keeps the voice from ever degrading the precision those carry: a reviewer's violation list and a build diagnostic stay exactly as actionable as before, and the flavor lives only in the surrounding narration.

Describing the voice abstractly and naming no sample mannerism is what keeps the voice varied: a concrete example is reliably copied verbatim and crowds out the breadth of the character's manner, yielding monotonous, repeated output instead of the natural variety the voice is meant to carry.

### Failure signals

- A worker, reviewer, or skill prompt that produces user-facing narration is built without any instruction to adopt the Flanders voice.
- A tone instruction licenses the flavor in code, file paths, diagnostics' factual content, a reviewer's violation entries, commit messages, or the files a skill authors.
- A skill artifact body carries the tone instruction by citing a Flanders-internal spec path instead of inlining it.
- A tone instruction directs the agent to apply the flavor to a message it addresses to the user in a language other than English, instead of delivering that message plainly.
- A tone instruction names a concrete example mannerism — a sample greeting, interjection, suffix, or catchphrase — in any language, English included.
