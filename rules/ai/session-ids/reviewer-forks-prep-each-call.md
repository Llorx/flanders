# Every reviewer invocation is a fork of the task's prep session

Every time `implement` launches the adversarial reviewer, the launch is a **fork** of the current task's prep session. There is no fresh-from-scratch reviewer launch and there is no reviewer-to-reviewer continuity: every reviewer call across every iteration of the task forks from the same prep `session_id`.

## Who this applies to

- **Subject:** the orchestrator of `implement`'s inner loop (the code that decides who to launch at each stage and with what parent `session_id`).
- **Not subject:** the runner, which only needs to know that this call is a fork of a given parent `session_id`.

## Behavior

1. **Prerequisite.** The task's prep session has been created and has produced a captured `session_id` per `rules/ai/session-ids/prep-session-per-task.md`.
2. **Launch.** For every reviewer call — iteration 1, iteration n>1, and any future iteration before the task closes — the orchestrator invokes the reviewer with the prep's `session_id` as the fork parent. The reviewer prompt is the same one defined by the inner-loop contract.
3. **No capture for reuse.** The orchestrator does **not** store the reviewer's own `session_id` for later reviewer invocations. The next reviewer call forks again from the same prep. The reviewer never resumes a previous reviewer's session.

## Why a fork from prep is still adversarial

The reviewer's value depends on independent judgment: it must evaluate the worker's changes against the task, contracts, and rules without inheriting the worker's reasoning, the worker's rationalisations, or another reviewer's prior verdict on the same task.

The prep is **neutral**: it contains the task's description, the contracts and rules referenced by the task, and the global contracts and rules judged relevant — but it does **not** contain any worker implementation, any worker reasoning, or any prior reviewer reasoning. Forking from a neutral context is not the same as forking from the worker's session: the reviewer arrives at the diff with reference material already in mind but with no opinion about the implementation yet.

For that reason, the historical formulation "the reviewer always starts on a fresh session" is preserved in spirit: the reviewer never starts contaminated. What changes is the technical mechanism — fresh-from-prep replaces fresh-from-nothing because the savings are real and the independence is not lost.

## Relationship with neighbouring rules

- The prep session that this rule depends on is pinned in `rules/ai/session-ids/prep-session-per-task.md`. If the prep is missing or unforkable, this rule cannot be satisfied.
- The exclusion of the reviewer from the worker's session reuse is pinned in `rules/ai/session-ids/worker-session-across-iterations.md`. That rule explicitly forbids handing the worker's `session_id` to the reviewer; this rule complements it by stating where the reviewer's parent `session_id` actually comes from.
- The rate-limit retry behavior in `rules/ai/session-ids/rate-limit-retry-reuses-session.md` operates one layer below: if a reviewer call is cut off by rate-limit, the runner retries on the same fork — the orchestrator does not launch a new fork from the prep just to recover from a rate-limit.

## When this rule does not apply

- **Build/test detection.** That agent is not task-scoped and has no prep; it does not fork.
- **Cross-task reuse.** When the orchestrator advances to a new task, the old prep is discarded; reviewer calls on the new task fork from the new task's prep. There is no reviewer fork across task boundaries.

## Failure signals

- The orchestrator launches any reviewer call without specifying the prep `session_id` as fork parent.
- The orchestrator launches a reviewer by resuming the prep `session_id` instead of forking it, so that the prep's own JSONL grows or gets mutated by the reviewer's actions.
- The orchestrator stores a reviewer's own `session_id` and passes it to the next reviewer invocation on the same task, creating reviewer-to-reviewer continuity.
- The orchestrator passes the worker's `session_id` to the reviewer instead of the prep's, contaminating the reviewer with the worker's reasoning.
- The orchestrator launches a reviewer after the prep failed to produce a usable `session_id`, instead of treating that as a blocker.
