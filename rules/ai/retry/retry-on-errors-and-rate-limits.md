# The runner retries retryable errors and rate-limits via the tool-interface events

The AI runner (see `contracts/cli-commands/implement/ai-runner.md`) decides whether to retry a failed invocation by reading the terminal event the per-tool adapter emits on the generic tool-adapter interface (`rules/ai/runner/tool-interface.md`). The detection logic does not live in the runner — the adapter has already classified the failure by the time it emits an `error` or a `rate_limit` event. The runner only needs to read the event type.

## Who this applies to

- **Subject:** the AI runner, on the code path that consumes adapter events.
- **Not subject:** per-tool adapters. Their job is to map the tool's native error surface to the abstract events; what to do with the classification is the runner's job.

## Behavior

When the adapter emits its terminal event, the runner reacts as follows:

- `{ type: "done" }` — the runner returns success to the caller.
- `{ type: "rate_limit", waitUntilMs }` — the runner waits until `waitUntilMs` per `rules/ai/retry/long-wait-chunked-timer.md` (chunked when the wait exceeds an hour), then re-invokes the same adapter with the same arguments, reusing the captured `session_id` per `rules/ai/retry/retry-reuses-session.md`.
- `{ type: "error", retryable: true, message }` — the runner waits per `rules/ai/retry/transient-error-backoff.md` (exponential backoff capped at one minute), then re-invokes the same adapter with the same arguments, reusing the captured `session_id`.
- `{ type: "error", retryable: false, message }` — the runner stops, surfaces the error to the caller as a non-retryable failure, and does not re-invoke. The `message` is what the caller sees and what is logged to `error.log`.

The cycle continues indefinitely on retryable failures: there is no maximum retry count. Only `done` or a non-retryable `error` ends the runner's loop for a given call.

## The `retryable` boolean is authoritative

The runner does NOT inspect the `message` field of an `error` event to second-guess the `retryable` boolean. Whatever the adapter set is what the runner uses. If an adapter classifies a failure incorrectly (a retryable failure marked non-retryable or vice versa), the fix is in the adapter's rule, not in the runner.

## Where the per-tool detection lives

The mapping from a tool's native error surface to the abstract events lives in each per-tool adapter rule:

- For Claude: `rules/ai/runner/claude-invocation.md` (sections on event mapping and on error/rate-limit emission).
- For Codex: `rules/ai/runner/codex-invocation.md` (same sections).

Adding a new AI tool means writing a new adapter rule that includes its own mapping — this rule does not change.

## Failure signals

- The runner inspects the `message` field of an `error` event to override the adapter's `retryable` classification.
- The runner adds tool-specific detection on top of the events it receives (for example, "if the configured tool is Claude and the message contains '503', retry even when the adapter marked the error non-retryable").
- The runner conflates the two terminal failure shapes — applying the transient backoff to a `rate_limit` event, or applying the rate-limit wait to a plain `error retryable=true`.
- The runner retries after a non-retryable `error` because "transient failures are bounded by some other counter anyway".
- The runner re-invokes the adapter with arguments different from the original invocation (different prompt, different model, different effort, missing `resumeSessionId`), instead of re-issuing the exact same call.
- The runner gives up after a finite retry count, propagating a retryable failure that should have been absorbed.
