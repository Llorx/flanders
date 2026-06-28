# AI Runner Contract

## Purpose
Provide a single function that `implement` uses to invoke an AI tool for any role (worker, reviewer, or any other AI invocation the command needs), so that AI invocation rules live in exactly one place.

## Interface
Callers pass in the AI tool to invoke, the model to use (or the "default configured model" marker for "do not pass an explicit model"), a prompt, and any additional invocation options. The runner returns either:
- The AI's result, once the tool has responded successfully.
- A rejection with an unknown-error reason, when the failure is not retryable.

The runner does not read the Flanders configuration on its own. Resolving which tool and model to use for a given invocation — for example, looking up the worker's configured tool from `.flanders/` (see [.spec/contracts/shared/flanders-config.md](/.spec/contracts/shared/flanders-config.md)) — is the caller's responsibility.

When the invocation reports a retryable error, the runner absorbs it: it waits and re-invokes the same tool with the same prompt and options, repeating until the call either succeeds or fails with a non-retryable error. A caller never has to handle retryable errors itself. What counts as retryable for a given tool is determined by the transient-error surface that tool documents; the precise detection is implementation.

## Cancellation
While the runner is waiting between retries, the surrounding command may be interrupted by the user. In that case the wait must abort promptly so the program can shut down without forcing the user to wait out the full sleep.

Cancellation is per-invocation: a caller may cancel an individual in-flight invocation on its own — for example, `implement` cancelling an optional reviewer that is still in a usage-limit wait once its review round can complete without it (see [src/commands/.spec/rules/ai/agents.md#a-review-round-completes--cancelling-any-still-waiting-reviewers--once-no-reviewer-is-running-every-required-reviewer-has-a-verdict-and-the-minimum-is-met](/src/commands/.spec/rules/ai/agents.md#a-review-round-completes--cancelling-any-still-waiting-reviewers--once-no-reviewer-is-running-every-required-reviewer-has-a-verdict-and-the-minimum-is-met)). A cancelled invocation aborts its wait promptly and ends without producing a result — neither a successful result nor a non-retryable error — and the runner performs no further retry for it.

## Surfacing waits to the caller

While the runner absorbs a retryable failure by waiting before it re-invokes (see `Interface`), it surfaces that wait to its caller, so the caller can show the user that the invocation is paused and when it is expected to resume. The runner surfaces a wait only when the wait has a knowable expected end — a rate-limit wait, whose end instant is fixed before the wait begins. A short transient-error backoff carries no meaningful end to display and is not surfaced as a wait: across such a backoff the invocation stays, from the caller's view, in progress.

This surfacing is a property of the runner, so every invocation routed through it gets it identically, whatever the caller's role — the worker, each adversarial reviewer, or any other invocation the command makes. For each invocation the runner reports:

- **Entering a wait.** The moment the invocation enters a rate-limit wait, the runner reports to the caller that this invocation is now waiting and the wall-clock instant the wait is expected to end.
- **Leaving a wait.** The moment the wait is over — because the runner re-invokes the tool, because the invocation completes, or because the invocation is cancelled (see `Cancellation`) — the runner reports to the caller that this invocation is no longer waiting.

The expected end the runner reports is the same instant it waits until before re-invoking. When a single invocation enters several rate-limit waits in succession, each one is reported on entry and on exit in turn.

This is the source the live UI draws the wait countdown from: the worker stage's waiting footer state and each reviewer's per-reviewer waiting countdown both take their expected end, and their transition into and out of the waiting presentation, from these reports (see [.spec/contracts/cli-commands/implement/ui.md](/.spec/contracts/cli-commands/implement/ui.md), `Footer line — waiting state` and `Footer line — reviewing state`). That the runner surfaces rate-limit waits but not transient backoffs is what upholds the distinction pinned in [src/ui/.spec/rules/ui-behavior.md#the-waiting-footer-state-appears-only-for-long-retry-waits](/src/ui/.spec/rules/ui-behavior.md#the-waiting-footer-state-appears-only-for-long-retry-waits).

## Contract for callers
- Call sites inside `implement` must not implement their own retry detection or retry logic. The runner is the single source of truth for that behavior.
- Call sites receive either a successful result or a non-retryable error — or, when a call site cancels an in-flight invocation itself (per `Cancellation` above), no result at all. They do not need to inspect the error to decide whether to retry.
- Call sites do not branch on which AI tool was passed when handling the result. Any tool-specific behavior is encapsulated inside the runner.
