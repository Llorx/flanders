# Flanders-voice specs carry no example mannerisms

## When `/flanders-spec` authors a spec about the Flanders voice, it includes no illustrative example of the voice in any language

When `/flanders-spec` creates or edits a spec file whose subject is the Flanders voice, the file describes the voice only in the abstract — what the voice is, where it applies, how light it is, what language it uses, and what it never touches — and names no concrete example of the character's speech. No sample greeting, interjection, suffix, catchphrase, or other mannerism appears in the file, in any language, English included. The realization of the voice is left to the reader's own knowledge of how the character speaks, the same way the runtime voice itself withholds examples (see [src/prompts/.spec/rules/ai/flanders-tone.md](/src/prompts/.spec/rules/ai/flanders-tone.md)).

This is a behavior rule in the sense pinned by [.spec/contracts/shared/flanders-behavior-rules.md](/.spec/contracts/shared/flanders-behavior-rules.md): it constrains how the `/flanders-spec` skill (see [.spec/contracts/ai-skills/spec-skill.md](/.spec/contracts/ai-skills/spec-skill.md)) produces the spec files it authors, not the host project's own code.

### Who this applies to

- **Subject:** the `/flanders-spec` skill's authoring and editing of any contract or rule file, anywhere in the project tree, whose subject is the Flanders voice — for example [.spec/contracts/shared/flanders-voice.md](/.spec/contracts/shared/flanders-voice.md) and [src/prompts/.spec/rules/ai/flanders-tone.md](/src/prompts/.spec/rules/ai/flanders-tone.md). Every run that creates or modifies such a file leaves it free of example mannerisms.
- **Not subject:** the normative variant strings pinned by [src/.spec/rules/flanders-voice-cli-variants.md](/src/.spec/rules/flanders-voice-cli-variants.md). Those strings are the exact text the CLI is required to emit — the spec's own normative content — not an illustration of how the voice sounds, so this rule never treats them as examples to omit, trim, or shorten.

### Why

A concrete sample mannerism is reliably copied verbatim and crowds out the breadth of the character's manner, yielding monotonous, repeated output instead of the natural variety the voice is meant to carry. Describing the voice abstractly and withholding every example keeps the voice varied by relying on the reader's own knowledge of how the character actually speaks. The same reasoning already governs the runtime tone instruction; this rule extends it to the spec corpus that describes the voice.

### Failure signals

- A spec file about the Flanders voice, created or edited by `/flanders-spec`, contains a sample greeting, interjection, suffix, catchphrase, or other example mannerism in any language, English included.
- A run removes, trims, or rewrites the pinned variant strings of [src/.spec/rules/flanders-voice-cli-variants.md](/src/.spec/rules/flanders-voice-cli-variants.md) on the mistaken grounds that they are examples, when they are the required normative output rather than illustrations.
