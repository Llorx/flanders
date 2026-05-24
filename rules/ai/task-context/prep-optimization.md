# The prep agent runs only when worker and reviewer share tool, model and effort

The "prep" agent — a read-only AI call that loads the task's contracts and rules into a session whose `session_id` is then reused by the worker (iter 1) and by every reviewer call — is an optimization, not a mandatory stage. The contract `contracts/cli-commands/implement/iteration-loop.md` does not require it; this rule pins exactly when the optimization runs and when it is skipped.

## Who this applies to

- **Subject:** the orchestrator of `implement`'s outer loop, at the moment it picks a new task and before it enters the inner loop.
- **Not subject:** the AI runner, which only knows whether the caller passed it a parent `session_id` to fork from. The runner does not decide whether the prep ran.

## The condition

The orchestrator launches a prep agent for a task if and only if **all three** of the following hold, by exact string equality on the values read from `.flanders/config.json` per `rules/flanders-config/file-format.md`:

1. `worker.tool == reviewer.tool`
2. `worker.model == reviewer.model` (including both being the empty string `""`)
3. `worker.effort == reviewer.effort` (including both being the empty string `""`)

If any of the three differs, the prep is skipped for the entire task. There is no partial reuse — the prep agent's `session_id` is only useful when the consumer's invocation parameters match the producer's exactly, because cross-tool, cross-model, and cross-effort context reuse is not supported (or not stable) on the underlying CLIs.

The condition is re-evaluated only when the configuration changes (in practice, never within a single `implement` run, because `.flanders/config.json` is loaded once at startup). It does not depend on per-task data.

## When the prep runs

When the condition holds:

1. The orchestrator spawns a prep agent through the AI runner, using `worker.tool`, `worker.model`, and `worker.effort` (equivalently, the reviewer's values — they are the same by assumption).
2. The prep prompt instructs the agent to read the full content of the task line, every contract and rule referenced by the task, and any additional file from the global lists the prep judges relevant, then to end with a short acknowledgement (for example `READY`) and no pending tool calls.
3. The orchestrator captures the prep's `session_id` from the runner's stream.
4. That `session_id` becomes the **fork parent** for:
   - The worker's first iteration on the task (per `rules/ai/task-context/worker-iter1-context.md`).
   - Every reviewer invocation across every iteration of the task (per `rules/ai/task-context/reviewer-context.md`).
5. The prep's `session_id` is discarded when the task closes (success, hard stop, or task change).

The prep is read-only on the project: it does not edit, write, rename, or delete any file, and it does not write to git (subject to `rules/ai/agents/no-git-writes.md`).

If the prep fails to produce a usable forkable `session_id` — the runner surfaces a non-retryable error, or the prep does not end in a state suitable for forking — the orchestrator hard-stops the run. The failure mode mirrors `MAX_ITER`: the run prints an error naming the task, preserves the temporary folder on disk (suppressing automatic cleanup), and exits non-zero. The orchestrator must not silently fall back to "skip prep, run without it" — the condition for running the prep is fixed, and a prep failure while the condition holds is a hard error.

## When the prep is skipped

When any of the three equality checks fails:

1. The orchestrator does not spawn a prep agent.
2. The worker and reviewer invocations on the task receive the contracts/rules content reconstituted in their own prompts (per `rules/ai/task-context/worker-iter1-context.md` and `rules/ai/task-context/reviewer-context.md`), not via session fork.
3. No fork-parent `session_id` is captured for the task.

Skipping the prep is a routine, silent path; it does not produce a diagnostic and does not affect the run's success.

## Why this condition specifically

Both Claude Code and Codex CLI support session resumption and forking, but the cached internal state inside a session is bound to the model and effort that produced it. Forking a session produced by `model=A effort=high` into a call that requests `model=B effort=low` either re-tokenizes the entire conversation (negating the savings) or is rejected by the underlying CLI. The strict triple-equality condition is what guarantees the optimization actually saves work; any laxer condition would trade soundness for nothing.

## Failure signals

- The orchestrator launches a prep agent when any of the three equality checks fails.
- The orchestrator skips the prep when all three checks hold, and instead inlines the full reference content in every worker/reviewer prompt.
- The orchestrator decides whether to launch the prep based on something other than the three exact-equality checks — for example, "skip if tools match but effort differs" or "skip when models are empty strings on both sides because they are 'sort of the same'".
- The orchestrator launches the prep with one tool/model/effort triple and then forks from its `session_id` for a different one.
- The orchestrator continues with worker or reviewer launches after a prep failure under the holding condition, instead of hard-stopping.
- The orchestrator persists the prep's `session_id` across tasks instead of discarding it on task change.
