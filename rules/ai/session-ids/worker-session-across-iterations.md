# The worker preserves its session_id across iterations of the same task

During `implement`'s inner loop, the orchestrator captures the worker's `session_id` after the first iteration on a task and reuses it every time the worker is relaunched in a later iteration of **that same task**. The worker arrives at iterations >1 knowing what it itself tried in previous iterations — not as a brand-new conversation.

The adversarial reviewer is out of scope for this rule: it has its own session-handling rule that forks every call from the task's prep — see `rules/ai/session-ids/reviewer-forks-prep-each-call.md`.

## Who this applies to

- **Subject:** the orchestrator of `implement`'s inner loop (the code that decides who to launch at each stage and with what `session_id`).
- **Not subject:** the runner. Rate-limit retry continuity is a separate rule and lives in `rules/ai/session-ids/rate-limit-retry-reuses-session.md`. This rule operates one layer above: it dictates which `session_id` the orchestrator hands to the runner when relaunching the worker.

## Behavior

1. **Iteration 1 of a task.** The orchestrator launches the worker as a fork of the task's prep session (see `rules/ai/session-ids/prep-session-per-task.md` and `rules/ai/session-ids/worker-first-iteration-forks-prep.md`). When the worker responds, the orchestrator captures its `session_id` — which represents the fork, not the prep — and stores it in memory associated with the current task.
2. **Iteration n>1 of the same task.** The orchestrator relaunches the worker passing the stored `session_id`, alongside the usual prompt (including the previous-iteration briefing defined in the inner-loop contract). The worker continues the same conversation with the full context of its previous attempts. It does not refork from the prep on n>1; only iteration 1 forks.
3. **Defensive capture.** If, on any iteration, the worker returns a `session_id` different from the stored one (renegotiation, regeneration, etc.), the orchestrator updates the stored value for subsequent iterations.

The previous-iteration briefing and the session continuity are complementary, not redundant: the briefing points at `error.log` for the concrete failure, while the session carries the reasoning and the changes the worker already made or considered.

## When the stored session_id is discarded

The worker's `session_id` is valid only within the current task. It is discarded in the following moments:

- **Task change.** When moving on to the next open task in the plan (step 1 of the outer loop), the previous task's `session_id` is discarded. Each task has its own conversation, and the next task's iteration 1 forks from the new task's prep — never from the previous task's worker or prep.
- **Hard stop by `MAX_ITER`.** When the limit is exceeded and the run ends, no future reuse is appropriate.
- **Successful task closure.** Once the task is marked done after a valid commit/check, its `session_id` is obsolete.

## The reviewer is explicitly excluded from worker-session reuse

The adversarial reviewer **never** receives the worker's `session_id` and never carries a `session_id` of its own across iterations. Every reviewer launch starts as a fresh fork of the task's prep session per `rules/ai/session-ids/reviewer-forks-prep-each-call.md`, so no reviewer ever inherits the reasoning of a previous reviewer or of the worker. The reason is the independence of adversarial judgment: if the reviewer dragged context from earlier reviews on the same task, or from the worker's own conversation, it would stop evaluating the current state of the working tree from scratch. The prep is neutral — task plus reference material, no implementation — so forking from it preserves that independence.

This does not conflict with the rate-limit rule: if a reviewer call is cut off by rate-limit and retried, the runner does reuse the `session_id` of **that call** to continue the same turn. What this rule forbids is the orchestrator storing that `session_id` for a later reviewer invocation.

## When reuse does not apply even within the same task

- **The worker did not expose a `session_id` in the previous iteration.** The orchestrator does not invent an identifier; the next iteration starts as a fresh fork of the task's prep and the briefing is still sent as usual.
- **A worker call is interrupted without yielding a capturable `session_id`.** Same treatment as above: the next iteration starts as a fresh fork of the prep.

In both cases the correctness of the loop does not depend on session reuse: the briefing and `error.log` still give the worker enough context not to blindly repeat the same mistake, and the prep guarantees the reference material is still loaded.

## Failure signals

- The orchestrator relaunches the worker for an iteration n>1 of the same task without passing the previously captured `session_id`, while one was available.
- The orchestrator keeps the worker's `session_id` across a task change, across a hard stop, or after the task closes successfully.
- The reviewer is given the worker's `session_id`, or the orchestrator stores a reviewer-side `session_id` across iterations.
- The orchestrator delegates this decision to the runner — the runner must not know which role is calling it, nor decide continuity between distinct invocations; that is the orchestrator's job.
- The previous-iteration briefing is dropped on the grounds that it is "redundant" with the persistent session. The two pieces are complementary, and the inner-loop contract (`contracts/cli-commands/implement/iteration-loop.md`) still mandates the briefing.
