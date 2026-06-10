# The worker resumes its captured session_id across iterations of the same task

For iterations n>1 on the same task, the orchestrator launches the worker by resuming the `session_id` captured during iteration 1 (per `src/commands/.docs/rules/ai/task-context/worker-iter1-context.md`). The worker arrives at iteration n>1 knowing what it itself tried in previous iterations — not as a brand-new conversation. The contracts/rules content is not re-injected; the previous-iteration briefing and the worker's continuity from iteration 1 are what carry the necessary context forward.

## Who this applies to

- **Subject:** the orchestrator of `implement`'s inner loop, at the moment it launches an iteration n>1 of the current task.
- **Not subject:** the AI runner. The runner only knows that the caller asked it to resume a given `session_id`.

## Behavior

For each iteration n>1 of a task:

1. The orchestrator looks up the worker `session_id` captured during the task's iteration 1 (or updated by a previous iteration n>1 per "Defensive capture" below).
2. The orchestrator invokes the worker through the AI runner with that `session_id` for resumption. The runner translates this to the tool-specific resume invocation (Claude: `--resume <session_id>`; Codex: `codex resume <session_id>` per `src/ai/.docs/rules/runner/claude-invocation.md` and `src/ai/.docs/rules/runner/codex-invocation.md`).
3. The worker prompt is the standard worker prompt for the iteration plus the previous-iteration briefing defined in the inner-loop contract. The orchestrator does NOT re-inject the contents of linked contracts/rules into the prompt for iteration n>1, regardless of how iteration 1 received them.
4. **Defensive capture.** If, during iteration n>1, the worker returns a `session_id` different from the stored one (renegotiation, regeneration, etc.), the orchestrator updates the stored value for subsequent iterations.

## When resume is not available

When the worker's previous iteration did not yield a capturable `session_id` (the runner did not surface one in the event stream, or the call was interrupted before any session id was emitted), iteration n>1 is launched as a **fresh** invocation — no resume, no fork.

In that fresh-invocation branch, the orchestrator does NOT re-inject the contents of linked contracts/rules into the worker prompt either. The worker is told what to implement, told where to find the plan, given the global lists of contracts/rules, and given the previous-iteration briefing pointing at `error.log`. The worker re-reads whatever files it needs from disk. The cost of re-reading is real but bounded; replaying full contract/rule content on every iteration would burn far more tokens for a marginal gain on the iteration's first turn.

This behavior holds even when the tool theoretically supports forking from the prep's `session_id`. Iteration n>1 must not refork from the prep — the lessons the worker accumulated during iterations 1..n-1 would be discarded.

## Discard

The worker's `session_id` is valid only within the current task. It is discarded in the following moments:

- **Task change.** When moving on to the next task, the previous task's `session_id` is discarded. Each task has its own conversation.
- **Hard stop by `MAX_ITER`.** When the limit is exceeded and the run ends, no future reuse is appropriate.
- **Successful task closure.** Once the task is marked done after a valid commit/check, its `session_id` is obsolete.

## Why no context replay

Re-injecting the contents of linked contracts/rules on every iteration would:

- Multiply token cost on every iteration past the first, with no qualitative benefit when the session is already loaded.
- Make the prompt's size proportional to the number of linked files even when the worker already has them in context.

The previous-iteration briefing alone is enough to direct the worker to the latest failure; the rest comes either from the resumed session (when available) or from the worker re-reading the project files it needs. This is the policy this rule pins.

## Failure signals

- The orchestrator launches iteration n>1 without passing the captured `session_id` when one is available.
- The orchestrator re-injects the contents of linked contracts/rules into the iteration n>1 prompt, replaying material the worker already has access to (either via session resume or via the working-tree files).
- Iteration n>1 reforks from the prep instead of resuming the worker's own session, discarding the worker's accumulated reasoning across iterations.
- The orchestrator keeps the worker's `session_id` across a task change, across a hard stop, or after a successful task closure.
- The orchestrator updates the stored `session_id` from a reviewer's response — only the worker's response can update the worker session id.
