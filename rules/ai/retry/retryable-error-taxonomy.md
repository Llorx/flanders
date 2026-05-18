# The retryable error set is defined by the result event shape

The Claude runner decides whether to retry a failed call by inspecting the terminal `result` event emitted by the underlying Claude process. The set of retryable signals is closed and explicit: anything not listed below propagates to the caller as a non-retryable error.

## Who this applies to

- **Subject:** the Claude runner.
- **Scope:** every failure produced by an invocation routed through the runner.

This rule defines the predicate "is this failure retryable?". The wait strategy applied once a failure is judged retryable lives in separate rules.

## When the failure is retryable

A `result` event with `is_error: true` is retryable when any of the following holds:

- `api_error_status` is a number greater than or equal to 500 (any 5xx HTTP status).
- `api_error_status` equals 408 or 425.
- `api_error_status` is null, which indicates a connection error or timeout with no HTTP response.
- `subtype` equals `"error_during_execution"`, indicating an unrecoverable crash inside the Claude process.

Rate-limit signals are also retryable but follow a different wait policy defined in `rate-limit-wait-from-error.md`.

## When the failure is not retryable

A `result` event with `is_error: true` is **not** retryable when any of the following holds:

- `subtype` equals `"error_max_turns"`.
- `subtype` equals `"error_max_budget_usd"`.
- `subtype` equals `"error_max_structured_output_retries"`.
- Any other shape not listed under the retryable section.

These represent intentional limits the caller configured or unrecognized failure modes. Retrying them would either defeat the caller's budget or mask a bug.

## Failure signals

- The runner inspects the prompt text or stderr to guess whether to retry, instead of reading the structured fields of the result event.
- A new failure mode appears upstream and the runner retries it before it has been added to the retryable set.
- An `error_max_*` subtype triggers a retry, defeating the caller-configured limit.
