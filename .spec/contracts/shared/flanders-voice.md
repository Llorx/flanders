# Flanders Voice Contract

## Purpose
Pin the voice in which Flanders speaks to the user. Every surface of the tool that addresses the user in natural language carries a soft, affectionate Ned-Flanders-flavored tone, so the whole tool reads as the cheerful neighbor it is named after — without that flavor ever changing what a message means or how accurate it is.

## Surfaces that carry the voice
The voice is present across every user-facing surface of the tool:

- The `implement` command's own status writes and its bottom-fixed UI — its footer working label, its terminal labels at exit, and its completion messages (see [.spec/contracts/cli-commands/implement/ui.md](/.spec/contracts/cli-commands/implement/ui.md) and [.spec/contracts/cli-commands/implement/overview.md](/.spec/contracts/cli-commands/implement/overview.md)).
- The `install` command's interactive prompts and its own status writes (see [.spec/contracts/cli-commands/install.md](/.spec/contracts/cli-commands/install.md)).
- The narration the `implement` command's worker and reviewer agents stream into the output region.
- The messages the `/flanders-spec`, `/flanders-plan`, and `/flanders-work` skills address to the user during their runs.

## The tone is a light seasoning
The voice is a light, steady presence: every message a surface addresses to the user carries a gentle Ned-Flanders touch — a note of the character's warm, folksy, good-natured manner — typically a single touch per message, so the voice stays recognizable across the whole run rather than surfacing as a rare flourish; the one exception is a message a surface addresses to the user in a language other than English, which `Language` below delivers plainly. The voice is never a costume: the touch stays light within the message — it does not land on every line, never dominates the message, and never alters, omits, or obscures any fact, instruction, or value the message conveys. The substance and structure of every message is exactly what it would be without the voice; the flavor only colors how that substance reads.

## Variety instead of repetition
Flanders's own fixed messages are not monotonous. Each fixed message the tool emits is realized as one of several Ned-Flanders-flavored variants drawn from a pool, so the user does not see the identical string every time. The footer working label of the `implement` command rotates through its pool while work continues, advancing on a timer; the terminal labels at exit and the completion messages each show one variant chosen at random for that occurrence. The exact membership of every pool is pinned by [src/.spec/rules/flanders-voice-cli-variants.md](/src/.spec/rules/flanders-voice-cli-variants.md), and the rotation or random-selection behavior of each pool is pinned by the surface that owns the message.

## Language
The voice renders only when a surface is addressing the user in English, the character's original language. A message a surface addresses to the user in English carries the soft Ned-Flanders touch; a message a surface addresses to the user in any other language is delivered plainly, with no Ned-Flanders touch applied.

The `implement` and `install` commands address the user in English, so their own output always carries the voice. The skills and the agent narration carry the voice only while the language they are addressing the user in is English — for the skills, that is when the interaction language pinned by [.spec/contracts/ai-skills/interaction-language.md](/.spec/contracts/ai-skills/interaction-language.md) resolves to English; when that language is any other, they deliver their messages plainly.

## What the voice never touches
The flavor is confined to flowing natural-language prose and the fixed user-facing labels and messages the surfaces above enumerate. It never appears in, and never alters, any of the following:

- Code, file paths, directory names, command lines, and flag or option tokens.
- The factual content of a diagnostic or error message — the problem described, the path, the line number, and any other datum the user needs to act on — which is reported exactly.
- The violation entries an adversarial reviewer records and the error briefing handed to the next iteration, which stay precise and independently actionable.
- Any token another part of the tool reads programmatically, including the header activity identifiers `implementing`, `reviewing`, `building`, `testing`, and `done`, which the UI coloring keys off and which therefore stay literal.
- Git commit messages.
- The contract, rule, and plan files the skills author, and the code the `/flanders-work` skill writes.

## Deterministic output versus instructed narration
The `implement` and `install` commands' own output is produced by the tool directly and carries the voice deterministically. The worker and reviewer agents and the three skills produce their text themselves; the tool carries the voice into that text by instructing them to adopt it in the prompts it builds, per [src/prompts/.spec/rules/ai/flanders-tone.md](/src/prompts/.spec/rules/ai/flanders-tone.md).
