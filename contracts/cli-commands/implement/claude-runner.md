# Claude Runner Contract

## Purpose
Provide a single function that `implement` uses to invoke a Claude AI instance, so that AI invocation rules live in exactly one place.

## Interface
Callers pass in a prompt and any additional invocation options. The runner returns either:
- The AI's result, once Claude has responded successfully.
- A rejection with an unknown-error reason, when the failure is not retryable.

When the Claude invocation reports a retryable error, the runner absorbs it: it waits and re-invokes Claude with the same prompt and same session, repeating until the call either succeeds or fails with a non-retryable error. A caller never has to handle retryable errors itself.

## Cancellation
While the runner is waiting between retries, the surrounding command may be interrupted by the user. In that case the wait must abort promptly so the program can shut down without forcing the user to wait out the full sleep.

## Contract for callers
- Call sites inside `implement` must not implement their own retry detection or retry logic. The runner is the single source of truth for that behavior.
- Call sites receive either a successful result or a non-retryable error. They do not need to inspect the error to decide whether to retry.
