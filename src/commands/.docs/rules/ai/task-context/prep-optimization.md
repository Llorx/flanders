# The prep agent runs when at least one reviewer shares the worker's tool, model and effort

The "prep" agent — a read-only AI call that loads the task's contracts and rules into a session whose `session_id` is then reused by the worker (iter 1) and by every reviewer whose configuration matches the worker's — is an optimization, not a mandatory stage. The contract `.docs/contracts/cli-commands/implement/iteration-loop.md` does not require it; this rule pins exactly when the optimization runs, who forks the prep session, and when it is skipped.

## Who this applies to

- **Subject:** the orchestrator of `implement`'s outer loop, at the moment it picks a new task and before it enters the inner loop.
- **Not subject:** the AI runner, which only knows whether the caller passed it a parent `session_id` to fork from. The runner does not decide whether the prep ran.

## The condition

The prep agent is always built with the worker's tool, model, and effort. The orchestrator launches a prep agent for a task if and only if **at least one** reviewer in the `reviewers` array matches the worker on **all three** of the following, by exact string equality on the values read from `.flanders/config.json` per `src/.docs/rules/flanders-config/file-format.md`. A reviewer `r` matches the worker when:

1. `worker.tool == r.tool`
2. `worker.model == r.model` (including both being the empty string `""`)
3. `worker.effort == r.effort` (including both being the empty string `""`)

A reviewer that differs from the worker on any of the three does not match. The prep is launched when one or more reviewers match; it is skipped only when no reviewer matches. Partial reuse is the model: when the prep runs, it is forked by the worker's first iteration and by the matching reviewers, while non-matching reviewers receive their context inline and never fork the prep. A reviewer's `session_id` reuse is only sound when that reviewer's invocation parameters equal the prep's exactly, because cross-tool, cross-model, and cross-effort context reuse is not supported (or not stable) on the underlying CLIs — so each consumer is judged for fork-eligibility on its own against the worker's triple.

The condition is re-evaluated only when the configuration changes (in practice, never within a single `implement` run, because `.flanders/config.json` is loaded once at startup). It does not depend on per-task data.

## When the prep runs

When at least one reviewer matches the worker:

1. The orchestrator spawns a prep agent through the AI runner, using `worker.tool`, `worker.model`, and `worker.effort`.
2. The prep prompt instructs the agent to read the full content of the task line, every contract and rule referenced by the task, and any additional file from the global lists the prep judges relevant, then to end with a short acknowledgement (for example `READY`) and no pending tool calls.
3. The orchestrator captures the prep's `session_id` from the runner's stream.
4. That `session_id` becomes the **fork parent** for:
   - The worker's first iteration on the task (per `src/commands/.docs/rules/ai/task-context/worker-iter1-context.md`). The worker always forks the prep when the prep ran, because the prep carries the worker's own triple.
   - Every reviewer invocation, across every iteration of the task, whose tool, model, and effort match the worker's triple (per `src/commands/.docs/rules/ai/task-context/reviewer-context.md`). A reviewer whose triple differs from the worker's never forks the prep.
5. The prep's `session_id` is discarded when the task closes (success, hard stop, or task change).

The prep is read-only on the project: it does not edit, write, rename, or delete any file, and it does not write to git (subject to `src/commands/.docs/rules/ai/agents/no-git-writes.md`).

If the prep fails to produce a usable forkable `session_id` — the runner surfaces a non-retryable error, or the prep does not end in a state suitable for forking — the orchestrator hard-stops the run. The failure mode mirrors `MAX_ITER`: the run prints an error naming the task, preserves the temporary folder on disk (suppressing automatic cleanup), and exits non-zero. The orchestrator must not silently fall back to "skip prep, run without it" — the condition for running the prep is fixed, and a prep failure while the condition holds is a hard error.

## When the prep is skipped

When no reviewer matches the worker on all three checks:

1. The orchestrator does not spawn a prep agent.
2. The worker and every reviewer invocation on the task receive the contracts/rules content reconstituted in their own prompts (per `src/commands/.docs/rules/ai/task-context/worker-iter1-context.md` and `src/commands/.docs/rules/ai/task-context/reviewer-context.md`), not via session fork.
3. No fork-parent `session_id` is captured for the task.

Skipping the prep is a routine, silent path; it does not produce a diagnostic and does not affect the run's success.

## Why this condition specifically

Both Claude Code and Codex CLI support session resumption and forking, but the cached internal state inside a session is bound to the model and effort that produced it. Forking a session produced by `model=A effort=high` into a call that requests `model=B effort=low` either re-tokenizes the entire conversation (negating the savings) or is rejected by the underlying CLI. Building the prep with the worker's triple makes the worker's first iteration always able to fork it; launching the prep as soon as at least one reviewer also shares that triple means the prep's loaded context is amortized across the worker and every matching reviewer. Reviewers that differ are simply not fork-eligible and take the inline path, so the per-consumer exact-equality requirement is preserved while still capturing the savings whenever any reviewer can share the worker's prep.

## Failure signals

- The orchestrator launches a prep agent when no reviewer matches the worker on all three checks.
- The orchestrator skips the prep when at least one reviewer matches the worker, and instead inlines the full reference content in the worker prompt and in the matching reviewers' prompts.
- The orchestrator forks the prep into a reviewer whose tool, model, or effort differs from the worker's, instead of giving that reviewer the inline path.
- The orchestrator builds the prep with a tool/model/effort triple other than the worker's, or forks it into the worker's first iteration when the prep was not launched.
- The orchestrator decides fork-eligibility based on something other than exact equality of all three values against the worker — for example, "fork when tools match but effort differs" or "treat empty models on both sides as 'sort of the same' even when efforts differ".
- The orchestrator continues with worker or reviewer launches after a prep failure under the holding condition, instead of hard-stopping.
- The orchestrator persists the prep's `session_id` across tasks instead of discarding it on task change.
