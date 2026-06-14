# A malformed task line is recognized only when a checkbox bracket is immediately followed by the metrics-object brace

The `implement` command's plan parser distinguishes a malformed task line from ordinary document content by the metrics-object brace. A list item is treated as a malformed-task-line candidate only when, after the list marker, a bracketed token's closing `]` is immediately followed by `{`. A list item whose `]` is not immediately followed by `{` — most commonly a markdown link bullet `- [text](url)`, where `]` is followed by `(` — is ordinary content and is never reported as malformed.

## Who this applies to

- **Subject:** the `implement` command's plan-parsing code — the code that reads a plan file at startup, detects task lines, and emits the "malformed checkbox lines" diagnostic before exiting non-zero (see [.docs/contracts/cli-commands/implement/overview.md](/.docs/contracts/cli-commands/implement/overview.md) and [.docs/contracts/shared/plan-file-format.md](/.docs/contracts/shared/plan-file-format.md)).
- **Not subject:** the `plan` command's generation path and the `/flanders-plan` validator, which recognize valid task lines through the canonical task-line regex pinned in [src/prompts/.docs/rules/ai/skills/plan/validator-matches-task-line-regex.md](/src/prompts/.docs/rules/ai/skills/plan/validator-matches-task-line-regex.md). This rule governs only the malformed-candidate detection that runs alongside that recognizer.

## The malformed-task-line recognizer

A line is a malformed-task-line candidate when, and only when, it matches:

    /^\s*[-*+]\s+\[[^\]]*\]\{/

- `\s*` — optional leading indentation.
- `[-*+]\s+` — the markdown list marker followed by at least one space.
- `\[[^\]]*\]` — a bracketed token (the checkbox position), holding any run of non-`]` characters.
- `\{` — the metrics-object opener, immediately after the closing `]`, with no character between `]` and `{`.

A line that matches this candidate pattern but does NOT match the canonical task-line recognizer regex pinned in [src/prompts/.docs/rules/ai/skills/plan/validator-matches-task-line-regex.md](/src/prompts/.docs/rules/ai/skills/plan/validator-matches-task-line-regex.md) is a malformed task line: the parser collects it and the `implement` command exits non-zero, naming the offending line. A line that matches the candidate pattern AND the canonical recognizer is a valid task line, not malformed.

## How to apply this rule

- The metrics-object brace `{` immediately after the closing `]` is the sole discriminator that separates a malformed task attempt from ordinary content. A bracketed list item not followed by `{` is never collected as malformed.
- A markdown link bullet such as `- [rules/x.md](../rules/x.md)` has `]` followed by `(`, so it does not match the candidate pattern and is never reported as malformed, even when its bracketed text resembles a path or a reference.

## Failure signals

- The parser reports a markdown link bullet (`- [text](url)`) as a malformed checkbox line.
- The malformed recognizer matches a bracketed list item whose `]` is not immediately followed by `{`, flagging ordinary content as a malformed task attempt.
- The malformed recognizer diverges from the canonical task-line recognizer such that a valid task line is reported as malformed.
