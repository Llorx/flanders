# The worker's first iteration on a task starts as a fork of the prep session

When the orchestrator launches the worker for iteration 1 on a task, it does not start from scratch and it does not start by resuming any previously stored `session_id`: it starts as a **fork** of the task's prep session. The worker arrives at iteration 1 with the task's reference material already loaded in its context by the prep.

## Who this applies to

- **Subject:** the orchestrator of `implement`'s inner loop (the code that decides who to launch at each stage and with what parent `session_id`).
- **Not subject:** the runner, which only needs to know that this call is a fork of a given parent `session_id`. The runner does not reason about which call is iteration 1 versus n>1.

## Behavior

1. **Prerequisite.** The task's prep session has been created and has produced a captured `session_id` per `rules/ai/session-ids/prep-session-per-task.md`.
2. **Launch.** The orchestrator invokes the worker with that prep `session_id` as the fork parent. The worker prompt is the same one defined by the inner-loop contract — the prep does not replace the worker's task instructions; it only seeds context.
3. **Capture.** When the worker responds, the orchestrator captures the worker's own `session_id` (which represents the fork, not the prep) and stores it as the task's worker session for use by later iterations.

The fork is one-shot in the sense that only iteration 1 forks from the prep. Subsequent iterations rely on the captured worker `session_id` per the existing continuity rule, not on a fresh fork.

## Relationship with neighbouring rules

- The prep session that this rule depends on is pinned in `rules/ai/session-ids/prep-session-per-task.md`. If the prep is missing or unforkable, this rule cannot be satisfied — the worker's iteration 1 must not silently fall back to a non-forked launch.
- The continuation of the worker across iterations n>1 is pinned in `rules/ai/session-ids/worker-session-across-iterations.md`. That rule keeps the worker on its own `session_id` once iteration 1 has produced one, instead of reforking from the prep on every iteration.
- The rate-limit retry behavior in `rules/ai/session-ids/rate-limit-retry-reuses-session.md` operates one layer below: if the iteration 1 call is cut off by rate-limit, the runner retries on the same fork — the orchestrator does not re-launch a new fork from the prep just to recover from a rate-limit.

## When this rule does not apply

- **Iterations n>1 on the same task.** They continue from the worker's own `session_id`, never refork from the prep.
- **A new task.** The previous task's worker `session_id` is discarded with the task; the new task creates its own prep, and the new task's iteration 1 forks from that new prep. There is no cross-task forking.

## Failure signals

- The orchestrator launches the worker's iteration 1 without specifying the prep `session_id` as fork parent.
- The orchestrator launches the worker's iteration 1 by resuming the prep `session_id` instead of forking it, so that the prep's own JSONL grows or gets mutated by the worker's actions.
- The orchestrator reforks the worker from the prep on iteration n>1, discarding the worker's own session and the lessons it carries from previous attempts.
- The worker's prompt is altered to skip the task's reference reading on the assumption that "the prep already did it" — the prep seeds the context, but the worker is still bound by its own prompt obligations. Removing those obligations belongs to the inner-loop contract, not to this rule.
- The orchestrator proceeds to launch iteration 1 after the prep failed to produce a usable `session_id`, instead of treating that as a blocker.
