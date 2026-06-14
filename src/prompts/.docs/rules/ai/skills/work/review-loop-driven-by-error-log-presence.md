# The `/flanders-work` review loop is driven by the presence and content of a temporary error-log file

After it performs the work, the `/flanders-work` skill drives its work-then-review loop entirely from a temporary error-log file — the reviewer's verdict file. Before each review round the skill provisions that file as absent; the reviewer writes its verdict into it per the shared verdict rule; and the skill then branches on whether the file is absent, present and empty, or present and non-empty. The loop has no fixed upper bound. Each review round is preceded by the build and test gates passing, per [.docs/contracts/ai-skills/work-skill.md](/.docs/contracts/ai-skills/work-skill.md) and [.docs/contracts/shared/build-test-validation.md](/.docs/contracts/shared/build-test-validation.md), so the reviewer only ever runs against changes that already build and pass tests.

## Who this applies to

- **Subject:** the source content that produces the `/flanders-work` skill artifact body, and the `/flanders-work` skill at runtime, in the loop that follows performing the work.
- **Not subject:** the `implement` command's orchestrator, whose per-reviewer verdict-file lifecycle — per-reviewer folders, delete-before, and unbounded re-launch across a configured reviewer list — is pinned by [src/commands/.docs/rules/ai/agents/reviewer-verdict-via-error-log.md](/src/commands/.docs/rules/ai/agents/reviewer-verdict-via-error-log.md). The reviewer's own obligation to write the file is pinned by [src/prompts/.docs/rules/ai/review/reviewer-records-verdict-via-error-log.md](/src/prompts/.docs/rules/ai/review/reviewer-records-verdict-via-error-log.md).

## Behavior

For each review round:

1. **Provision the verdict file as absent.** Before launching the reviewer, the skill ensures the temporary error-log file does not exist (deleting it if a previous round left one), so the reviewer recreating it is observable. The skill passes the reviewer the path to that file.

2. **Launch the reviewer and wait for its completion.** The skill spawns the reviewer per [src/prompts/.docs/rules/ai/skills/work/reviewer-hosted-as-in-session-subagent.md](/src/prompts/.docs/rules/ai/skills/work/reviewer-hosted-as-in-session-subagent.md) and waits until it completes.

3. **Branch on the file once the reviewer has completed:**
   - **Absent** — the reviewer did not produce the file it was required to produce, so it did not run to a verdict. The skill relaunches the reviewer for the same review round, repeating with no maximum count until the file exists. An absent file is never read as a pass.
   - **Present and empty** — the reviewer ran to a verdict and found no violation. The work is accepted; the loop ends and the skill finalizes per [src/prompts/.docs/rules/ai/skills/work/finalization-without-commit-or-plan.md](/src/prompts/.docs/rules/ai/skills/work/finalization-without-commit-or-plan.md).
   - **Present and non-empty** — the reviewer ran to a verdict and recorded violations. The skill reworks the implementation to address every recorded violation, re-runs the build and test gates per [.docs/contracts/ai-skills/work-skill.md](/.docs/contracts/ai-skills/work-skill.md) (which must pass before the review runs again), then starts a new review round from step 1 against a freshly-provisioned absent file.

4. **No fixed upper bound.** The work-then-review cycle repeats until a round ends with a present empty file. There is no iteration cap; the user interrupts the session to stop it.

The verdict is read only from the file's presence and content, never from the reviewer's streamed output or exit code, consistent with [src/prompts/.docs/rules/ai/review/reviewer-records-verdict-via-error-log.md](/src/prompts/.docs/rules/ai/review/reviewer-records-verdict-via-error-log.md).

## Why

A single in-session reviewer needs an unambiguous, format-independent verdict signal, and the file provides one: provisioning it absent before the round makes the reviewer recreating it the proof that it ran, so an empty file means "looked and found nothing" while an absent file means "never reached a verdict" and is retried rather than trusted. Relaunching on absence rather than counting it as a pass prevents a reviewer that silently did nothing from closing the loop prematurely. Reworking on non-empty content and re-reviewing, with no cap, lets the skill converge on small tasks without the ceremony of a configured iteration limit.

## Failure signals

- The skill reads an absent verdict file as a pass and finishes, instead of relaunching the reviewer.
- The skill does not provision the verdict file as absent before a review round, so a stale file from a previous round is mistaken for the current verdict.
- The skill decides the verdict from the reviewer's streamed output or exit code instead of the file's presence and content.
- The skill finishes on a non-empty verdict file instead of reworking the recorded violations and re-reviewing.
- The skill imposes a fixed iteration cap on the work-then-review cycle.
