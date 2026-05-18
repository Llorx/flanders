# Retries reuse the interrupted call's session_id

When the Claude runner retries a call that was cut off by a retryable error, it reuses the `session_id` of the interrupted call — if the underlying session exposes one — so the retry continues the same conversation rather than opening a new one.

## Who this applies to

- **Subject:** the Claude runner (the central utility that owns retry detection and retry).
- **Scope:** every call routed through that runner. The originating role does not matter — worker, adversarial reviewer, validator, or any future caller — the `session_id` reuse on retry is a property of the runner, not of the caller.

Callers do not configure this behavior: they get it for free by going through the runner.

## When the reuse applies

The reuse applies exclusively to the retry of the **same turn** after a retryable error — both rate-limit and any of the other retryable signals defined in `rules/ai/retry/retryable-error-taxonomy.md`. In that flow:

1. The runner detects that the call failed with a retryable error and waits the appropriate duration.
2. On wake, it re-invokes Claude with the same prompt.
3. If the interrupted call exposed a `session_id` (or if the caller supplied one when invoking the runner), that same `session_id` is passed to the retry.
4. The cycle repeats on the same session until the call either succeeds or fails with a non-retryable error.

This rule does **not** cover continuity across distinct invocations of the runner. Other forms of session reuse — for example, keeping the worker's `session_id` across iterations of the inner loop — live in their own rules and operate at a higher layer.

## When the reuse does not apply

- **The underlying session does not expose a `session_id`.** The runner does not fabricate an identifier of its own; it simply retries without one. The behavior is still correct: what is lost is conversational continuity, not the correctness of the wait.
- **The error is not retryable.** Any non-retryable failure propagates to the caller with no retry and therefore no `session_id` reuse.
- **A fresh call from the same caller after a completed one.** That is not a retry; it is a distinct invocation and falls outside the scope of this rule.

## Failure signals

- The runner retries after a retryable error with a fresh session when the underlying session did expose a usable `session_id`.
- The runner asks the caller to decide whether to reuse the `session_id` instead of doing so itself.
- A caller implements its own retry detection and retry policy, bypassing the runner — which breaks the session-continuity guarantee this rule pins.
- The runner persists the `session_id` beyond the current call (between distinct invocations), making a decision that belongs to the orchestration layer, not to the runner.
