# The /flanders-plan validator confirms task-line format by exact-matching the canonical recognizer regex

The format-and-shape check of the `/flanders-plan` validator does not re-derive what a task line looks like from prose. It validates every task line by exact-matching it against the canonical task-line recognizer regex — the same pattern the `implement` command's detector applies — so that a plan the validator passes is guaranteed to be a plan the `implement` command will recognize. The host inlines this exact regex verbatim into the validator's prompt; the validator must not be left to reconstruct the pattern from the shape description in `.docs/contracts/shared/plan-file-format.md`.

## Who this applies to

- **Subject:** the `/flanders-plan` skill, as the host that packages the validator's prompt — it MUST inline the canonical regex below verbatim alongside the format-and-shape category enumerated in `src/.docs/rules/ai/skills/plan/final-validator.md`.
- **Subject (when running as a subagent):** the validator instance, in performing the format-and-shape check by matching each candidate task line against the inlined regex.
- **Not subject:** the `/flanders-spec` validator, which audits a different artifact and has no task-line concept.

## The canonical task-line recognizer regex

A task line is recognized by, and only by, this pattern:

    /^(\s*[-*+]\s+)\[([ xX])\](\{[^}]*\})(\s.*)?$/

The capture groups, in order:

1. `(\s*[-*+]\s+)` — optional leading indentation, then the mandatory markdown list marker (`-`, `*`, or `+`), then at least one space. A line that reaches the checkbox without this leading marker does not match and is therefore not a task line.
2. `([ xX])` — the single checkbox character: a space for an open task or `x`/`X` for a done task.
3. `(\{[^}]*\})` — the metrics object, present immediately after the closing `]` with no whitespace between `]` and `{`.
4. `(\s.*)?` — the remainder of the line (the task number and title), which begins with whitespace.

This is the same pattern the `implement` command applies to detect and rewrite task lines; it is the single authoritative encoding of the task-line shape described in prose in `.docs/contracts/shared/plan-file-format.md`. The regex is the structural recognizer only: the byte-exact metrics value for freshly-generated tasks, the single-space spacing between the metrics object, the task number and the title, hierarchical numbering, and the leaf-vs-parent distinction remain the finer-grained obligations enumerated by the format-and-shape category in `src/.docs/rules/ai/skills/plan/final-validator.md`.

## How to apply this rule

- The host inlines the regex above verbatim into the validator's prompt — the literal pattern, not a paraphrase and not a pointer to the contract or to this rule by path.
- For every line the plan presents as a task (any line carrying a checkbox-and-metrics identifier), the validator confirms the line matches the regex. A line that the plan treats as a task but that fails to match — most commonly because it omits the leading list marker — is a format-and-shape FAIL, enumerated with the offending file:line.
- A plan whose task lines all read correctly to a human but none of which match the regex (so the `implement` command would report "no task lines") is FAIL, never PASS.

## Failure signals

- The host packages the validator prompt with the format-and-shape category but without the verbatim regex, leaving the validator to reconstruct the task-line pattern from prose.
- The validator reports PASS on a plan whose task lines omit the leading list marker — lines that begin with `[ ]{...}` instead of `- [ ]{...}` — on the grounds that the checkbox, metrics, and title all look correct.
- The validator treats the regex as advisory and accepts a task line that does not match it.
- The regex inlined into the validator's prompt diverges from the pattern the `implement` command's detector applies, so the validator passes lines the detector would skip.
