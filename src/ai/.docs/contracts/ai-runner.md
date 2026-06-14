# AI Runner Contract

## Purpose
Provide a single function that `implement` uses to invoke an AI tool for any role (worker, reviewer, or any other AI invocation the command needs), so that AI invocation rules live in exactly one place.

## Interface
Callers pass in the AI tool to invoke, the model to use (or the "default configured model" marker for "do not pass an explicit model"), a prompt, and any additional invocation options. The runner returns either:
- The AI's result, once the tool has responded successfully.
- A rejection with an unknown-error reason, when the failure is not retryable.

The runner does not read the Flanders configuration on its own. Resolving which tool and model to use for a given invocation — for example, looking up the worker's configured tool from `.flanders/` (see [.docs/contracts/shared/flanders-config.md](/.docs/contracts/shared/flanders-config.md)) — is the caller's responsibility.

When the invocation reports a retryable error, the runner absorbs it: it waits and re-invokes the same tool with the same prompt and options, repeating until the call either succeeds or fails with a non-retryable error. A caller never has to handle retryable errors itself. What counts as retryable for a given tool is determined by the transient-error surface that tool documents; the precise detection is implementation.

## Cancellation
While the runner is waiting between retries, the surrounding command may be interrupted by the user. In that case the wait must abort promptly so the program can shut down without forcing the user to wait out the full sleep.

## Contract for callers
- Call sites inside `implement` must not implement their own retry detection or retry logic. The runner is the single source of truth for that behavior.
- Call sites receive either a successful result or a non-retryable error. They do not need to inspect the error to decide whether to retry.
- Call sites do not branch on which AI tool was passed when handling the result. Any tool-specific behavior is encapsulated inside the runner.
