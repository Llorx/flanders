# `implement` Command Contract — Iteration Loop

## Purpose
Define how the `implement` command advances a plan one task at a time: which task it picks, what it contributes to the single-task cycle each task runs, and how an accepted task is recorded in the plan file. The cycle itself — the worker, build, test, adversarial-review, and commit stages, the five-iteration cap, the previous-iteration briefing, and the hard-stop conditions — is the shared cycle of [.spec/contracts/shared/task-cycle.md](/.spec/contracts/shared/task-cycle.md).

## Outer loop
While there is an unchecked task in the plan file:
1. Pick the next unchecked task. Capture its line number in the plan file, its title verbatim, and its full task text — the verbatim region running from its task line through its body, delimited per [.spec/contracts/shared/plan-file-format.md](/.spec/contracts/shared/plan-file-format.md) — all with no summarization or rewriting.
2. Run the shared single-task cycle for that task, with the captured task text as the task text the cycle injects.
3. On a successful cycle, the task's checkbox has been flipped from open to done in the plan file by the commit stage below. Continue with the next task.

When no unchecked tasks remain, print the all-tasks-completed message — one variant chosen at random from its pool (see [.spec/contracts/cli-commands/implement/overview.md](/.spec/contracts/cli-commands/implement/overview.md)) — and exit successfully.

## What the command contributes to the cycle

### Worker and reviewer provisioning
Beyond the task text and the global contract and rule listings the cycle already carries, the orchestrator consolidates the content of every contract and rule the task references into a `spec.md` file that the prompt directs the agent to read in full — the linked section when the reference carries a section anchor, the whole file when it does not. The worker's `spec.md` lives in the main temporary folder and each reviewer's in its own, per [src/commands/.spec/rules/ai/task-context.md#the-workers-first-iteration-receives-the-task-and-reference-content-by-deterministic-script-injection](/src/commands/.spec/rules/ai/task-context.md#the-workers-first-iteration-receives-the-task-and-reference-content-by-deterministic-script-injection) and [src/commands/.spec/rules/ai/task-context.md#every-reviewer-invocation-is-fresh-and-receives-the-deterministic-script-injection](/src/commands/.spec/rules/ai/task-context.md#every-reviewer-invocation-is-fresh-and-receives-the-deterministic-script-injection). This is what lets each agent honor the task's referenced obligations without locating and opening each file itself; a contract or rule the reviewer determines should have applied but the task did not reference is still its own to consult and to fail the work over.

### Commit-stage bookkeeping
The bookkeeping the cycle's commit stage performs before it stages and commits is, for this command, in this order: the task's checkbox is flipped from `[ ]` to `[x]` in the plan file and its metrics object is finalized for that task; and when this task is the last open task — so that flipping it leaves no unchecked task in the plan — the plan file is also renamed to mark the plan complete by prepending the marker `V-` to the very start of its filename, ahead of every other part of the name, including the generation-timestamp prefix `/flanders-plan` wrote (see [src/prompts/.spec/rules/ai/skills/plan.md#flanders-plan-prefixes-every-plan-filename-with-the-generation-timestamp](/src/prompts/.spec/rules/ai/skills/plan.md#flanders-plan-prefixes-every-plan-filename-with-the-generation-timestamp)), so a plan file named `<name>` becomes `V-<name>` and a completed plan's filename begins with exactly one `V-`.

The commit message the cycle's commit carries is exactly the task's plan number followed by a single space and the task's title, both taken verbatim from the plan file. For example, a task that appears in the plan file as `7.3 Validate plan file at startup` produces the commit message `7.3 Validate plan file at startup`.

On a failing commit, the bookkeeping the cycle reverts is the checkbox flip: the task's checkbox is rewritten from `[x]` back to `[ ]`, so the plan file on disk stays consistent with the absence of a commit. The metrics object is not reverted: its values reflect real consumption and the next iteration continues to accumulate on top of them. See [.spec/contracts/cli-commands/implement/git-integration.md](/.spec/contracts/cli-commands/implement/git-integration.md).

## Task metrics persistence
The metrics object of the current task (defined in [.spec/contracts/shared/plan-file-format.md](/.spec/contracts/shared/plan-file-format.md)) is kept up to date in the plan file while the cycle runs. A user inspecting the plan file at any point during the run finds values that reflect what the tool has consumed on that task so far. The values are written back to the plan file often enough that the file never lags noticeably behind the live UI.

When a task is marked complete (its checkbox flipped to `[x]`), its metrics object reflects the total consumption accumulated over the entire effort on that task, including the cost of any iterations that failed before the one that passed the adversarial review.

## Hard stop
When the shared cycle hard-stops (see [.spec/contracts/shared/task-cycle.md#hard-stop](/.spec/contracts/shared/task-cycle.md#hard-stop)), the command prints an error and exits non-zero. The error identifies the task by its line number and title, when the hard stop occurred while a task was being worked; reproduces the content of `hard-stop.log` on a worker-declared stop; and points at the temporary folder so the user can inspect the preserved logs (see [.spec/contracts/cli-commands/implement/workspace.md](/.spec/contracts/cli-commands/implement/workspace.md)). On a login-failure hard stop the printed error is task-independent: it states that the configured AI tool is not logged in and instructs the user to log in and re-run.

Unlike every other exit path, the hard stop intentionally preserves the temporary folder on disk so the user can inspect it, and so the `/flanders-hard-stop-review` skill can diagnose the stop from it (see [.spec/contracts/ai-skills/hard-stop-review-skill.md](/.spec/contracts/ai-skills/hard-stop-review-skill.md)).

## Spec folder immovability
No AI agent the command spawns may write to any `.spec/contracts` folder, any `.spec/rules` folder, any `.spec/flanders` folder, or the `plans/` folder. The command itself writes to `plans/` to rewrite the checkbox state and the metrics object of an existing task line as work progresses, and to rename a plan file once, as it finalizes the task that completes the plan; it does not create new plan files or delete existing ones. See [.spec/contracts/shared/spec-folder-write-authority.md](/.spec/contracts/shared/spec-folder-write-authority.md).
