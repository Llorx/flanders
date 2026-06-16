# Every Flanders adversarial reviewer records its verdict by writing violations into its error-log file, never via its output or exit code

The outcome a Flanders adversarial reviewer signals is carried exclusively by its own verdict file — a fixed-name error-log file the reviewer is given. Whether the reviewer produced that file at all, and what it holds, is the only signal read from the reviewer. Nothing the reviewer prints to its streamed output, and no process exit code, is consulted to learn its verdict. This rule pins how every Flanders reviewer prompt instructs the reviewer to record its result; how the file is provisioned, inspected, and re-launched against differs per surface and is pinned separately.

## Who this applies to

- **Subject:** the construction of every Flanders adversarial reviewer prompt — the `implement` command's reviewer(s) (see [.spec/contracts/cli-commands/implement/iteration-loop.md](/.spec/contracts/cli-commands/implement/iteration-loop.md)) and the `/flanders-work` skill's reviewer subagent (see [.spec/contracts/ai-skills/work-skill.md](/.spec/contracts/ai-skills/work-skill.md)).
- **Not subject:** the lifecycle of the verdict file — its provisioning before the reviewer runs, its inspection afterward, and any re-launch on absence. That lifecycle is the orchestrating surface's, pinned for `implement` by [src/commands/.spec/rules/ai/agents/reviewer-verdict-via-error-log.md](/src/commands/.spec/rules/ai/agents/reviewer-verdict-via-error-log.md) and for `/flanders-work` by [src/prompts/.spec/rules/ai/skills/work/review-loop-driven-by-error-log-presence.md](/src/prompts/.spec/rules/ai/skills/work/review-loop-driven-by-error-log-presence.md).

## Behavior

The reviewer prompt instructs the reviewer to record its result through its error-log file, and only through that file:

1. **Append every violation as it is found.** The reviewer appends each violation to its error-log file as it discovers it — append mode, never overwrite — so the file is created on first write and partial findings survive even if the reviewer is interrupted mid-review. Each appended entry is independently actionable: precise enough that the next round of work can act on it from the file alone, citing concrete `file:line` references, contract or rule paths, and the exact behavior or evidence that is missing.

2. **Create the file empty when there is no violation.** When the reviewer finds no violation across every verification, it must still create its error-log file as an empty file as its final act, so the file always exists once the reviewer has run to a verdict.

3. **Never write non-violation content.** The reviewer must not write a pass confirmation or any other non-violation content into the file: any content there is read as a failure.

4. **The verdict lives only in the file.** The reviewer's streamed output has no prescribed format — it may narrate, summarize, or format its reasoning however it wants — and is never parsed for a verdict token. A process exit code is never the signal either: a completed single-turn agent invocation exits zero whether or not it found violations.

The reading of this signal — an absent file means the reviewer did not run to a verdict, a present empty file means a clean pass, a present non-empty file means violations — is performed by the orchestrating surface per the per-surface rules named under "Not subject".

## Why

An LLM reviewer does not reliably honor an instruction to end with a single bare `PASS`/`FAIL` line: it wraps the token in markdown, prepends prose, or restructures the verdict, and a parser keying on the token then misreads a genuine pass as an unrecognized verdict and burns a round re-running work that was already correct. The process exit code is no better: a completed agent turn exits zero whether the reviewer passed or failed the work. A file whose presence and content carry the verdict removes both failure modes: it is an unambiguous, format-independent signal that does not depend on the reviewer phrasing anything a particular way. Requiring the reviewer to create the file even on a clean pass makes "the reviewer looked and found nothing" distinguishable from "the reviewer never reached a verdict".

## Failure signals

- A reviewer prompt instructs the reviewer to end with a `PASS`/`FAIL` token, or lets its streamed output or exit code stand in for the verdict.
- A reviewer prompt does not instruct the reviewer to append the violations it finds into its error-log file, or instructs it to overwrite the file instead of appending.
- A reviewer prompt does not instruct the reviewer to create an empty file when it finds no violation, so a clean review leaves the file absent and indistinguishable from a reviewer that never ran.
- A reviewer prompt instructs the reviewer to write a pass confirmation, or any other non-violation content, into the file, so a clean review leaves the file non-empty.
- A violation entry is not independently actionable — it lacks the `file:line`, the contract or rule path, or the description of what is missing — forcing the next round of work to rediscover the problem.
