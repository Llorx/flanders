# A review round completes — cancelling any still-waiting reviewers — once no reviewer is running, every required reviewer has a verdict, and the minimum is met

The adversarial review stage does not decide, reviewer by reviewer, whether to abandon a usage-limited reviewer. Instead it watches the whole reviewer set and, on every reviewer transition, asks one question: may the round complete now? The round completes when all three of these hold at once:

1. **No reviewer is running** — every reviewer is either finished with a verdict or sitting in a usage-limit wait. A reviewer in a short transient-error backoff counts as running, not waiting (see [.docs/contracts/cli-commands/implement/ui.md](/.docs/contracts/cli-commands/implement/ui.md) and [src/ui/.docs/rules/waiting-footer-applies-to-long-waits-only.md](/src/ui/.docs/rules/waiting-footer-applies-to-long-waits-only.md)).
2. **Every required reviewer has a verdict** — no required (non-optional) reviewer is still running or in a usage-limit wait. The `optional` flag that distinguishes the two is pinned in [.docs/contracts/shared/flanders-config.md](/.docs/contracts/shared/flanders-config.md).
3. **At least `minimumReviews` reviewers have a verdict** — the count of reviewers that ran to a verdict has reached the configured minimum.

When all three hold, the orchestrator cancels every reviewer still in a usage-limit wait (see [src/ai/.docs/contracts/ai-runner.md](/src/ai/.docs/contracts/ai-runner.md)) and forms the stage verdict from the reviewers that ran to a verdict (see [src/commands/.docs/rules/ai/agents/review-stage-aggregates-error-logs.md](/src/commands/.docs/rules/ai/agents/review-stage-aggregates-error-logs.md)). When any one of the three fails, no reviewer is cancelled and the round continues.

## Who this applies to

- **Subject:** the orchestrator of the `implement` inner loop, at the adversarial review stage, while it runs the reviewers configured in `.flanders/config.json`.
- **Not subject:** the AI runner, which absorbs the retries and rate-limit waits of any invocation that is not cancelled (see [src/ai/.docs/rules/retry/retry-on-errors-and-rate-limits.md](/src/ai/.docs/rules/retry/retry-on-errors-and-rate-limits.md)); it does not evaluate the round-completion condition. Also not subject: the reviewers themselves, which review identically whether or not they are optional.

## When the condition is evaluated

The orchestrator re-evaluates the condition on every reviewer transition that can newly satisfy it: a reviewer finishing with a verdict, and a reviewer entering a usage-limit wait. The condition is not checked once at a fixed point; it is re-checked each time the global reviewer state changes in one of these two ways, so the round completes at the earliest moment all three conditions hold.

## Why the decision is global, not per-reviewer

A reviewer that has entered a usage-limit wait is never abandoned on its own at the moment it hits the limit. While the round has not yet met its completion condition — for example because a required reviewer is still counting down a multi-hour usage-limit wait — a waiting optional reviewer's own usage limit may clear, and that reviewer may resume and run to a verdict, contributing its review. Cancelling it the instant it hit its limit would throw away a review the round still had time to collect. Only at the instant the round may complete are the reviewers still waiting cancelled, because at that instant their verdicts are no longer needed: every required reviewer is in and the minimum is met.

Because the condition requires every required reviewer to already have a verdict, a reviewer cancelled this way is always an optional one — a required reviewer is never cancelled; its usage-limit wait is always waited out. A cancelled reviewer produces no per-reviewer error file, is never re-launched, and does not contribute to the stage verdict (see [src/commands/.docs/rules/ai/agents/reviewer-verdict-via-error-log.md](/src/commands/.docs/rules/ai/agents/reviewer-verdict-via-error-log.md)).

## Errors are not part of this decision

A reviewer that fails with an error rather than entering a usage-limit wait is not handled here: its error follows the ordinary reviewer-error path — a retryable error is retried by the runner, and a non-retryable error surfaces with its message reaching the worker — regardless of whether the reviewer is optional (see [src/ai/.docs/rules/retry/retry-on-errors-and-rate-limits.md](/src/ai/.docs/rules/retry/retry-on-errors-and-rate-limits.md)). The round-completion condition concerns only reviewers that are running, in a usage-limit wait, or finished with a verdict.

## Failure signals

- The orchestrator cancels a reviewer the moment it enters a usage-limit wait, instead of leaving it to run while the round-completion condition is not yet met.
- The orchestrator completes the round while a reviewer is still running, or while a required reviewer has no verdict, or before `minimumReviews` reviewers have a verdict.
- The orchestrator cancels a required reviewer rather than waiting out its usage limit.
- The orchestrator treats a reviewer error as if it were a usage-limit wait, folding it into the round-completion decision instead of letting it reach the worker through the existing error path.
- The orchestrator evaluates the condition only once instead of on each qualifying reviewer transition, so the round fails to complete at the earliest moment all three conditions hold.
