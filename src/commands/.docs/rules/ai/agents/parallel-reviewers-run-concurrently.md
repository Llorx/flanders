# Reviewers run concurrently, one independent runner invocation each, and the stage ends when the last finishes

The adversarial review stage launches every configured reviewer concurrently rather than one after another. Each reviewer is its own AI-runner invocation that manages its own retries and rate-limit waits independently of the others, and the stage's reviewer work is complete only when the last reviewer has finished. Reviewers are read-only on the project, so running them at the same time is safe.

## Who this applies to

- **Subject:** the orchestrator of the `implement` inner loop, at the adversarial review stage, when it launches the reviewers configured in the `reviewers` array (see `.docs/contracts/shared/flanders-config.md`).
- **Not subject:** the AI runner, which absorbs the retries and rate-limit waits of the single invocation it is given (see `src/ai/.docs/contracts/ai-runner.md`); it is unaware that sibling reviewer invocations are running alongside it.

## Behavior

1. **One invocation per reviewer, launched concurrently.** The orchestrator issues a separate AI-runner invocation for each configured reviewer and starts them together, without waiting for one reviewer to finish before starting the next. It does not serialize the reviewers into a sequential loop.

2. **Independent retry and rate-limit handling.** Each reviewer's runner invocation absorbs that reviewer's own retryable errors and rate-limit waits per `src/ai/.docs/rules/retry/retry-on-errors-and-rate-limits.md`. One reviewer entering a rate-limit wait does not pause, delay, or restart the other reviewers; each proceeds, retries, and waits on its own schedule.

3. **Each writes only its own per-reviewer error file.** Because each reviewer writes exclusively to its own per-reviewer error file (per `src/commands/.docs/rules/ai/agents/reviewer-verdict-via-error-log.md`) and performs no project writes, concurrent execution produces no write contention between reviewers.

4. **The stage waits for the last reviewer.** The stage's reviewer work completes only once every reviewer has run to a verdict (including any per-reviewer re-launches for an absent file). The orchestrator forms the stage verdict (per `src/commands/.docs/rules/ai/agents/review-stage-aggregates-error-logs.md`) only after the last reviewer has finished.

## Why concurrent

Reviewers are read-only and independent, so serializing them would make the stage's wall-clock time the sum of the reviewers' durations instead of the duration of the slowest one — and rate-limit waits, which can last minutes to hours, would stack. Running them concurrently bounds the stage by the slowest single reviewer and lets each reviewer's rate-limit wait overlap with the others' real work.

## Failure signals

- The orchestrator runs the reviewers in a sequential loop, awaiting each before starting the next.
- One reviewer's rate-limit wait or retry stalls the other reviewers instead of each handling its own independently.
- The orchestrator forms the stage verdict before every reviewer has finished, ignoring reviewers still running.
- A reviewer is made to share another reviewer's runner invocation or error file, coupling their execution or their output.
