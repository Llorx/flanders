# Rate-limit waits use the duration carried in the error itself

When the Claude runner retries a rate-limit error, the wait duration is the one signalled by the underlying API in the error itself, not the backoff used for other transient errors.

## Who this applies to

- **Subject:** the Claude runner.
- **Scope:** every retry caused by a rate-limit signal from the underlying Claude process.

## How the wait is determined

- The runner parses the rate-limit window's expected end out of the rate-limit signal received from the Claude process.
- The wait lasts until that end. The runner does not impose its own backoff curve on top of it, and does not shorten or extend it based on prior retries.
- The cycle repeats: each new rate-limit signal carries its own duration, and the runner waits exactly that.

## Why this is distinct from the transient backoff

Rate-limit signals carry an authoritative end time set by the server. Retrying earlier is wasted work; retrying later wastes the user's time. The exponential backoff defined in `transient-error-backoff.md` is for transient failures that do not include such a signal — applying it on top of a rate-limit window would be both unnecessary and incorrect.

## Failure signals

- The runner applies its own backoff curve to rate-limit waits, ignoring the duration carried in the error.
- The runner shortens the rate-limit wait based on a hard-coded ceiling, retrying before the API would accept the call.
- The runner conflates rate-limit and other transient failures into a single retry path that uses the same wait strategy for both.
