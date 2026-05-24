# Transient retries use exponential backoff capped at one minute

For retryable failures that do not carry a wait duration of their own, the AI runner waits before each retry using an exponential backoff capped at one minute, resetting once a call succeeds.

## Who this applies to

- **Subject:** the AI runner (see `contracts/cli-commands/implement/ai-runner.md`).

## How the backoff progresses

- The first retry after a successful (or initial) call uses a short initial wait, well below the one-minute ceiling.
- Each consecutive retry doubles the wait of the previous one.
- The wait is hard-capped at one minute: once doubling would exceed one minute, the wait stays at one minute for every subsequent retry.
- The cycle continues indefinitely. There is no maximum retry count — only success or a non-retryable failure terminates the loop.

## When the backoff resets

The backoff counter resets to its initial wait the moment a call succeeds. A future transient failure starts again from the short initial wait, not from wherever the previous failure series ended.

## Failure signals

- The runner uses a fixed delay for transient retries, ignoring how long the previous failure series has been running.
- The runner caps the wait at a value other than one minute, or removes the cap entirely.
- The backoff fails to reset after a success, so a single later transient failure inherits the long wait of a previous outage.
- The runner gives up after a finite retry count, propagating a transient error the caller would otherwise have absorbed.
