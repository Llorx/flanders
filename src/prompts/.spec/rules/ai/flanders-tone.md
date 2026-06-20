# Flanders tone in prompts

## Flanders prompts instruct the agent to adopt the soft Flanders voice in its user-facing narration

Every prompt Flanders builds for an agent or skill that produces user-facing natural-language narration includes an instruction to season that narration with the soft Ned-Flanders voice defined in [.spec/contracts/shared/flanders-voice.md](/.spec/contracts/shared/flanders-voice.md). The instruction is part of how each such prompt is constructed; it carries the voice into text the tool does not produce itself but only elicits from an agent.

### Who this applies to

- **Subject:** the construction of every Flanders-authored prompt whose agent or skill streams or prints natural-language narration to the user:
  - the `implement` command's worker prompt;
  - the `implement` command's reviewer prompt(s);
  - the `/flanders-work` skill's reviewer subagent prompt;
  - the `/flanders-spec`, `/flanders-plan`, and `/flanders-work` skill artifact bodies, for the messages those skills address to the user.
- **Not subject:** the `implement` and `install` commands' own deterministic output, which carries the voice directly rather than through a prompt instruction (see [.spec/contracts/shared/flanders-voice.md](/.spec/contracts/shared/flanders-voice.md)); and the task text, reference content, change-set instructions, and verdict-file protocol the orchestrator provides to an agent — whether in the prompt or in the consolidated `spec.md` the agent reads — which this rule leaves unchanged.

### Behavior

The tone instruction each in-scope prompt carries tells the agent or skill to:

1. **Season lightly.** Add an occasional, soft Ned-Flanders touch to its user-facing prose — a gentle note of the character's warm, folksy, good-natured manner — never on every line and never exaggerated, keeping the substance and structure of every message exactly what it would be without the flavor.
2. **Match the language with its genuine localization.** Render the flavor in the same language it is already addressing the user in, using that language and region's genuine established localization of the character rather than a word-for-word translation of his original-language manner. Because an established localization is regional, detect and match the regional idiom the user's own writing exhibits, fall back to the most widely recognized localization of that language when the user's region cannot be determined, and carry the character's original-language manner across in spirit only when the language has no established localization of the character at all.
3. **Keep the flavor where the voice belongs.** Apply the flavor only to flowing prose, never to code, file paths, command lines, flag tokens, the factual content of diagnostics, the violation entries a reviewer records, machine-read tokens, commit messages, the contract, rule, and plan files a skill authors, or the code `/flanders-work` writes — the full exclusion set inlined from [.spec/contracts/shared/flanders-voice.md](/.spec/contracts/shared/flanders-voice.md).

**The tone instruction names no concrete examples.** The instruction names no example mannerism in any language, English included — no sample greeting, interjection, suffix, or catchphrase. It describes the voice only in the abstract and leaves its realization to the agent's own knowledge of the established localization.

The tone instruction inside each skill artifact body is inlined and self-contained, carrying no citation of a Flanders-internal spec path, consistent with [src/prompts/.spec/rules/ai/skills/skills-common.md#flanders-skill-artifact-prompts-are-self-contained--no-citations-of-flanders-internal-spec-paths](/src/prompts/.spec/rules/ai/skills/skills-common.md#flanders-skill-artifact-prompts-are-self-contained--no-citations-of-flanders-internal-spec-paths): the exclusion set above is written out in the body rather than referenced by path.

### Why

The tool controls its own output directly, but the worker, the reviewers, and the installed skills generate their own text, so the only way the voice reaches that text is by asking for it where the prompt is built. Fencing the flavor out of code, diagnostics, reviewer violations, and authored artifacts keeps the voice from ever degrading the precision those carry: a reviewer's violation list and a build diagnostic stay exactly as actionable as before, and the flavor lives only in the surrounding narration.

Describing the voice abstractly and naming no sample mannerism is what keeps the localization genuine: a concrete example is reliably copied and translated word for word into the target language, yielding a stilted transliteration of the original idiom instead of the idiom the character actually uses in that language and region, so the instruction withholds examples and relies on the agent's own knowledge of the established localization.

### Failure signals

- A worker, reviewer, or skill prompt that produces user-facing narration is built without any instruction to adopt the Flanders voice.
- A tone instruction licenses the flavor in code, file paths, diagnostics' factual content, a reviewer's violation entries, commit messages, or the files a skill authors.
- A skill artifact body carries the tone instruction by citing a Flanders-internal spec path instead of inlining it.
- A tone instruction tells the agent to flavor every line, or to render the flavor so heavily that a message's substance is harder to read.
- A tone instruction names a concrete example mannerism — a sample greeting, interjection, suffix, or catchphrase — in any language, English included.
- A tone instruction directs the flavor to be produced by translating the character's original-language manner word for word, rather than by using the target language and region's genuine established localization.
- A tone instruction treats a language's localization as region-independent, applying one idiom to a language that has distinct regional dub idioms instead of matching the user's regional idiom.
