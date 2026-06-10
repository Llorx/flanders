# Retries reuse the interrupted call's session_id

When the AI runner retries a call that was cut off by a retryable terminal event, it reuses the `id` of the most recent `{ type: "session", id }` event the interrupted call's adapter emitted (or the `resumeSessionId` the caller originally passed), so the retry continues the same conversation rather than opening a new one. The runner passes the captured id back through `resumeSessionId` on the next invocation.

## Who this applies to

- **Subject:** the AI runner (see `src/ai/.docs/contracts/ai-runner.md`).
- **Scope:** every call routed through that runner. The originating role does not matter — worker, adversarial reviewer, prep, detect agent, or any future caller — the `session_id` reuse on retry is a property of the runner, not of the caller.

Callers do not configure this behavior: they get it for free by going through the runner.

## When the reuse applies

The reuse applies exclusively to the retry of the **same turn** after a retryable terminal event — `{ type: "error", retryable: true }` or `{ type: "rate_limit", waitUntilMs }` as defined in `src/ai/.docs/rules/runner/tool-interface.md`. In that flow:

1. The runner sees the terminal event and waits the appropriate duration per the rate-limit or transient-backoff rule.
2. On wake, it re-invokes the same adapter with the same arguments.
3. If the interrupted call's adapter emitted a `{ type: "session", id }` event (or if the caller supplied a `resumeSessionId` when invoking the runner), that same `id` is passed back to the adapter via `resumeSessionId`. The adapter translates that into the tool's resume invocation.
4. The cycle repeats on the same session until the call either succeeds or fails with a non-retryable error.

This rule does **not** cover continuity across distinct invocations of the runner. Other forms of session reuse — for example, keeping the worker's `session_id` across iterations of the inner loop — live in their own rules (see `src/commands/.docs/rules/ai/task-context/worker-continuity.md`) and operate at a higher layer.

## When the reuse does not apply

- **The interrupted call did not expose a `session_id` and the caller did not supply one.** The runner does not fabricate an identifier of its own; it simply retries without one. The behavior is still correct: what is lost is conversational continuity, not the correctness of the wait.
- **The error is not retryable.** Any non-retryable failure propagates to the caller with no retry and therefore no `session_id` reuse.
- **A fresh call from the same caller after a completed one.** That is not a retry; it is a distinct invocation and falls outside the scope of this rule.

## Failure signals

- The runner retries after a retryable error with a fresh session when the underlying call did expose a usable `session_id`.
- The runner asks the caller to decide whether to reuse the `session_id` instead of doing so itself.
- A caller implements its own retry detection and retry policy, bypassing the runner — which breaks the session-continuity guarantee this rule pins.
- The runner persists the `session_id` beyond the current call (between distinct invocations), making a decision that belongs to the orchestration layer, not to the runner.
