# The worker's first iteration receives its context per the prep-optimization branch

When the orchestrator launches the worker for iteration 1 on a task, the way the task's reference material reaches the worker depends on whether the prep optimization is active for the task (see [src/commands/.docs/rules/ai/task-context/prep-optimization.md](/src/commands/.docs/rules/ai/task-context/prep-optimization.md)).

## Who this applies to

- **Subject:** the orchestrator of `implement`'s inner loop, at the moment it launches iteration 1 for a task.
- **Not subject:** the AI runner. The runner is told whether to fork from a parent `session_id` or to start a fresh invocation; it does not reason about iteration count.

## Behavior

**Branch A — prep optimization is active for the task.** The orchestrator invokes the worker through the AI runner as a **fork** of the task's prep `session_id` captured per [src/commands/.docs/rules/ai/task-context/prep-optimization.md](/src/commands/.docs/rules/ai/task-context/prep-optimization.md). The worker prompt is the standard worker prompt defined by the inner-loop contract (plan path, task line/title verbatim, instructions, contract and rule lists, build/test script paths). The worker arrives at iteration 1 with the contracts and rules referenced by the task already in its loaded context, because the prep that produced the fork parent already read them.

The worker prompt does NOT additionally inline the full content of those contracts and rules; doing so would duplicate the loaded context and inflate the prompt for no gain. The worker is still bound by its own prompt instructions to respect every linked contract and rule — that obligation is independent of how the content reached the context.

**Branch B — prep optimization is skipped for the task.** The orchestrator invokes the worker through the AI runner as a **fresh** invocation (no fork parent, no resume). The worker prompt is the same standard worker prompt as above, with one addition: it inlines the full text of every contract file and every rule file the task explicitly links. The worker arrives at iteration 1 with that content present in the prompt itself.

The orchestrator does NOT, in either branch, inject the global contracts/rules listings' contents — only the explicitly linked ones. The global listings (relative paths) are passed in both branches so the worker can consult any additional file at its discretion.

## Session capture

In both branches, the orchestrator captures the worker's `session_id` from the runner's event stream as iteration 1 progresses. That captured `session_id` is what [src/commands/.docs/rules/ai/task-context/worker-continuity.md](/src/commands/.docs/rules/ai/task-context/worker-continuity.md) uses to continue the worker across iterations n>1.

In branch A, the captured `session_id` represents the fork — distinct from the prep's `session_id` — not the prep itself.

## Why this split

The prep is built with the worker's own tool, model, and effort, so whenever the prep ran the worker's first iteration can always fork it. The prep runs when at least one reviewer also shares the worker's triple, so its loaded context is reused by the worker and by every matching reviewer (per [src/commands/.docs/rules/ai/task-context/prep-optimization.md](/src/commands/.docs/rules/ai/task-context/prep-optimization.md)). When no reviewer matches the worker, the prep is not launched at all, and inlining the linked content into the worker prompt is the cheapest way to give the worker access to it without paying for an in-context load that no caller would reuse.

## Failure signals

- Branch A is taken and the worker prompt also inlines the full content of the linked contracts and rules, duplicating what is already in the forked context.
- Branch B is taken and the worker prompt does not inline the linked contracts and rules, leaving the worker without access to the obligations it is told to respect.
- The orchestrator confuses the prep's `session_id` with the worker's: stores the prep's id as the worker session for n>1 reuse, or stores the worker's id as the fork parent for the reviewer.
- The orchestrator selects branch A or B based on something other than the active state of the prep optimization (for example, "always branch A because the worker tool is `claude`").
- The orchestrator inlines the full content of every global contract and rule in either branch, instead of only the task-linked ones.
