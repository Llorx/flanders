# Runner retry rules

## The runner retries retryable errors and rate-limits via the tool-interface events

The AI runner (see [src/ai/.spec/contracts/ai-runner.md](/src/ai/.spec/contracts/ai-runner.md)) decides whether to retry a failed invocation by reading the terminal event the per-tool adapter emits on the generic tool-adapter interface ([src/ai/.spec/rules/runner.md#all-ai-tools-implement-the-same-generic-tool-adapter-interface](/src/ai/.spec/rules/runner.md#all-ai-tools-implement-the-same-generic-tool-adapter-interface)). The detection logic does not live in the runner — the adapter has already classified the failure by the time it emits an `error` or a `rate_limit` event. The runner only needs to read the event type.

### Who this applies to

- **Subject:** the AI runner, on the code path that consumes adapter events.
- **Not subject:** per-tool adapters. Their job is to map the tool's native error surface to the abstract events; what to do with the classification is the runner's job.

### Behavior

When the adapter emits its terminal event, the runner reacts as follows:

- `{ type: "done" }` — the runner returns success to the caller.
- `{ type: "rate_limit", waitUntilMs }` — the runner waits until `waitUntilMs` per [src/ai/.spec/rules/retry.md#long-waits-run-as-a-loop-of-bounded-chunks](/src/ai/.spec/rules/retry.md#long-waits-run-as-a-loop-of-bounded-chunks) (chunked when the wait exceeds an hour), then re-invokes the same adapter with the same arguments, reusing the captured `session_id` per [src/ai/.spec/rules/retry.md#retries-reuse-the-interrupted-calls-session_id](/src/ai/.spec/rules/retry.md#retries-reuse-the-interrupted-calls-session_id).
- `{ type: "error", retryable: true, message }` — the runner waits per [src/ai/.spec/rules/retry.md#transient-retries-use-exponential-backoff-capped-at-one-minute](/src/ai/.spec/rules/retry.md#transient-retries-use-exponential-backoff-capped-at-one-minute) (exponential backoff capped at one minute), then re-invokes the same adapter with the same arguments, reusing the captured `session_id`.
- `{ type: "error", retryable: false, message }` — the runner stops, surfaces the error to the caller as a non-retryable failure, and does not re-invoke. The `message` is what the caller sees and what is logged to `error.log`.

The cycle continues indefinitely on retryable failures: there is no maximum retry count. Only `done` or a non-retryable `error` ends the runner's loop for a given call.

### The `retryable` boolean is authoritative

The runner does NOT inspect the `message` field of an `error` event to second-guess the `retryable` boolean. Whatever the adapter set is what the runner uses. If an adapter classifies a failure incorrectly (a retryable failure marked non-retryable or vice versa), the fix is in the adapter's rule, not in the runner.

### Where the per-tool detection lives

The mapping from a tool's native error surface to the abstract events lives in each per-tool adapter rule:

- For Claude: [src/ai/.spec/rules/runner.md#the-claude-adapter-spawns-claude---print---output-format-stream-json-and-maps-its-events-to-the-tool-interface](/src/ai/.spec/rules/runner.md#the-claude-adapter-spawns-claude---print---output-format-stream-json-and-maps-its-events-to-the-tool-interface) (sections on event mapping and on error/rate-limit emission).
- For Codex: [src/ai/.spec/rules/runner.md#the-codex-adapter-spawns-codex-exec---json-and-maps-its-events-to-the-tool-interface](/src/ai/.spec/rules/runner.md#the-codex-adapter-spawns-codex-exec---json-and-maps-its-events-to-the-tool-interface) (same sections).

Adding a new AI tool means writing a new adapter rule that includes its own mapping — this rule does not change.

### Failure signals

- The runner inspects the `message` field of an `error` event to override the adapter's `retryable` classification.
- The runner adds tool-specific detection on top of the events it receives (for example, "if the configured tool is Claude and the message contains '503', retry even when the adapter marked the error non-retryable").
- The runner conflates the two terminal failure shapes — applying the transient backoff to a `rate_limit` event, or applying the rate-limit wait to a plain `error retryable=true`.
- The runner retries after a non-retryable `error` because "transient failures are bounded by some other counter anyway".
- The runner re-invokes the adapter with arguments different from the original invocation (different prompt, different model, different effort, missing `resumeSessionId`), instead of re-issuing the exact same call.
- The runner gives up after a finite retry count, propagating a retryable failure that should have been absorbed.

## Transient retries use exponential backoff capped at one minute

For retryable failures that do not carry a wait duration of their own, the AI runner waits before each retry using an exponential backoff capped at one minute, resetting once a call succeeds.

### Who this applies to

- **Subject:** the AI runner (see [src/ai/.spec/contracts/ai-runner.md](/src/ai/.spec/contracts/ai-runner.md)).

### How the backoff progresses

- The first retry after a successful (or initial) call uses a short initial wait, well below the one-minute ceiling.
- Each consecutive retry doubles the wait of the previous one.
- The wait is hard-capped at one minute: once doubling would exceed one minute, the wait stays at one minute for every subsequent retry.
- The cycle continues indefinitely. There is no maximum retry count — only success or a non-retryable failure terminates the loop.

### When the backoff resets

The backoff counter resets to its initial wait the moment a call succeeds. A future transient failure starts again from the short initial wait, not from wherever the previous failure series ended.

### Failure signals

- The runner uses a fixed delay for transient retries, ignoring how long the previous failure series has been running.
- The runner caps the wait at a value other than one minute, or removes the cap entirely.
- The backoff fails to reset after a success, so a single later transient failure inherits the long wait of a previous outage.
- The runner gives up after a finite retry count, propagating a transient error the caller would otherwise have absorbed.

## Long waits run as a loop of bounded chunks

Any wait that can plausibly last beyond an hour is implemented as a loop of bounded chunks rather than a single long timer. JavaScript timers are not reliable for arbitrarily long durations, and an absolute clock is subject to drift; chunking re-checks the remaining time after every chunk and keeps the wait correct.

### Who this applies to

- **Subject:** any wait inside Flanders that can run for an hour or more.

### How the wait is structured

- Each chunk lasts at most one hour.
- After each chunk completes, the wait recomputes how much time remains and either waits another chunk (a full hour or the remainder, whichever is smaller) or exits the loop because the target end has been reached.
- The mechanism is a single reusable helper: a wait function that takes a target duration (or end time) and a maximum chunk size, and returns when the full duration has elapsed.

### Why this is needed

- JavaScript timers (`setTimeout`) cannot reliably schedule arbitrarily long single delays; very long delays are subject to skipped, clamped, or coalesced behavior.
- The system clock can drift, jump, or be adjusted while a long wait is sleeping; chunking gives the wait an opportunity to re-anchor against the current clock after each chunk.

### Failure signals

- A wait longer than the chunk size is implemented as a single timer.
- A long-wait path uses absolute timestamps without re-checking remaining time after intermediate chunks.
- A second, parallel implementation of the chunked-wait pattern appears in the codebase instead of reusing the existing helper.

## Retries reuse the interrupted call's session_id

When the AI runner retries a call that was cut off by a retryable terminal event, it reuses the `id` of the most recent `{ type: "session", id }` event the interrupted call's adapter emitted (or the `resumeSessionId` the caller originally passed), so the retry continues the same conversation rather than opening a new one. The runner passes the captured id back through `resumeSessionId` on the next invocation.

### Who this applies to

- **Subject:** the AI runner (see [src/ai/.spec/contracts/ai-runner.md](/src/ai/.spec/contracts/ai-runner.md)).
- **Scope:** every call routed through that runner. The originating role does not matter — worker, adversarial reviewer, detect agent, or any future caller — the `session_id` reuse on retry is a property of the runner, not of the caller.

Callers do not configure this behavior: they get it for free by going through the runner.

### When the reuse applies

The reuse applies exclusively to the retry of the **same turn** after a retryable terminal event — `{ type: "error", retryable: true }` or `{ type: "rate_limit", waitUntilMs }` as defined in [src/ai/.spec/rules/runner.md#all-ai-tools-implement-the-same-generic-tool-adapter-interface](/src/ai/.spec/rules/runner.md#all-ai-tools-implement-the-same-generic-tool-adapter-interface). In that flow:

1. The runner sees the terminal event and waits the appropriate duration per the rate-limit or transient-backoff rule.
2. On wake, it re-invokes the same adapter with the same arguments.
3. If the interrupted call's adapter emitted a `{ type: "session", id }` event (or if the caller supplied a `resumeSessionId` when invoking the runner), that same `id` is passed back to the adapter via `resumeSessionId`. The adapter translates that into the tool's resume invocation.
4. The cycle repeats on the same session until the call either succeeds or fails with a non-retryable error.

This rule does **not** cover continuity across distinct invocations of the runner. Other forms of session reuse — for example, keeping the worker's `session_id` across iterations of the inner loop — live in their own rules (see [src/commands/.spec/rules/ai/task-context.md#the-worker-resumes-its-captured-session_id-across-iterations-of-the-same-task](/src/commands/.spec/rules/ai/task-context.md#the-worker-resumes-its-captured-session_id-across-iterations-of-the-same-task)) and operate at a higher layer.

### When the reuse does not apply

- **The interrupted call did not expose a `session_id` and the caller did not supply one.** The runner does not fabricate an identifier of its own; it simply retries without one. The behavior is still correct: what is lost is conversational continuity, not the correctness of the wait.
- **The error is not retryable.** Any non-retryable failure propagates to the caller with no retry and therefore no `session_id` reuse.
- **A fresh call from the same caller after a completed one.** That is not a retry; it is a distinct invocation and falls outside the scope of this rule.

### Failure signals

- The runner retries after a retryable error with a fresh session when the underlying call did expose a usable `session_id`.
- The runner asks the caller to decide whether to reuse the `session_id` instead of doing so itself.
- A caller implements its own retry detection and retry policy, bypassing the runner — which breaks the session-continuity guarantee this rule pins.
- The runner persists the `session_id` beyond the current call (between distinct invocations), making a decision that belongs to the orchestration layer, not to the runner.
