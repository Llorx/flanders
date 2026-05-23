# `implement` Command Contract — Iteration Loop

## Purpose
Define the loop that picks the next open task, drives a worker AI through implementation, validates the result through build, test, and adversarial-review gates, and either marks the task complete or briefs the next iteration about what failed.

## Per-run state
- `iteration` — counter for the current task. Reset to 0 every time a new task is picked.
- `MAX_ITER` — fixed upper bound of 5 iterations per task. Hardcoded; not configurable.

## Outer loop
While there is an unchecked task in the plan file:
1. Pick the next unchecked task. Capture both its line number in the plan file and its title verbatim, with no summarization or rewriting.
2. Reset `iteration` to 0.
3. Run the inner loop (below).
4. On a successful inner loop, the task's checkbox is flipped from open to done in the plan file. Continue with the next task.

When no unchecked tasks remain, print `all tasks completed` and exit successfully.

## Inner loop (per task)
Each iteration walks through the stages below in order. Any stage that fails writes context to the `error.log` file inside the temporary folder and restarts the inner loop at stage 1; the next iteration's worker prompt automatically includes the previous-iteration briefing because the iteration counter is greater than 1.

1. Increment `iteration`. If `iteration` exceeds `MAX_ITER`, hard stop: print an error that names the task and points at the workspace logs, and exit non-zero.

2. **Worker stage.** Spawn a worker AI (via the AI runner — see `cli-commands/implement/ai-runner.md`). The AI tool and model used for the worker are the ones selected in the Flanders configuration (see `shared/flanders-config.md`).

   How the worker is launched depends on the iteration:
   - **Iteration 1.** A fresh worker invocation. The worker has access to the task and to the contents of the contracts and rules linked by the task.
   - **Iteration n>1.** The worker continues from the work it produced in iteration 1, so prior tool calls and prior reasoning made by this task's worker remain available.

   The worker prompt contains:
   - The plan file path.
   - The task line number and the task title verbatim.
   - Instructions to find that line in the plan file, respect the obligations of every contract and rule linked by the task, implement the task, and update or extend tests so the new behavior is covered.
   - The full list of contract files and the full list of rule files (both by relative path from the project root, where each path is the contract's or rule's namespace). The worker may consult any file in these lists at its discretion in addition to the ones already linked to the task.
   - Instructions stating that, if the implementation changes how the project builds or how its tests run, the worker also updates the build and test scripts inside the temporary folder.
   - On every iteration after the first, the previous-iteration briefing (see below).

3. **Build stage.** Run the build script (when one exists). On non-zero exit, capture both stdout and stderr to the `error.log` file inside the temporary folder and restart the inner loop.

4. **Test stage.** Run the test script (when one exists). On non-zero exit, capture both stdout and stderr to the `error.log` file and restart the inner loop.

5. **Adversarial review stage.** Spawn a reviewer AI (via the AI runner). The AI tool and model used for the reviewer are the ones selected in the Flanders configuration (see `shared/flanders-config.md`), which may be the same as or different from the worker's. Every reviewer invocation for the task is a fresh invocation with no continuity from any prior reviewer invocation — there is no reviewer-to-reviewer continuity.

   The reviewer's prompt includes the same full lists of contract files and rule files (relative paths inside `contracts/` and `rules/`, where each path is the contract's or rule's namespace) that the worker receives in stage 2; the reviewer may consult any of them at its discretion. The reviewer is instructed to find why the working-tree changes FAIL to satisfy the task spec or to honor the contracts and rules referenced by the task. Verifying that every contract and rule referenced by the task is actually honored in the working-tree changes is an explicit obligation of the reviewer — a referenced contract or rule that is not honored is a FAIL; a contract or rule the reviewer determines should have applied but did not, even if not referenced by the task, is also a FAIL.

   The reviewer must run every verification it is required to run and every additional check its judgment deems applicable, and must not stop when the first violation is discovered. The four FAIL conditions above and the acceptance-criteria verification protocol are executed in full on every invocation; encountering a violation in one of them does not exempt the reviewer from completing the rest. The goal is that a single review produces the complete list of fixes the next worker needs to apply, so the next iteration can address every outstanding problem at once instead of one at a time across multiple iterations.

   The reviewer must reply with either:
   - `PASS` — proceed to the commit/check stage. Returned only when every applicable verification passed; a single unresolved violation forbids `PASS`.
   - `FAIL <detailed reason>` — write the detailed reason into the `error.log` file and restart the inner loop. The `<detailed reason>` is an enumeration of every violation the reviewer found across all verifications, not a single cause. Each entry in the enumeration must be independently actionable: precise enough that the next iteration's worker can act on it without having to rediscover the problem from the diff.

   The verdict is emitted as the final line of the reviewer's reply: a single line that begins with either `PASS` or `FAIL`, with no surrounding quotes and no markdown. When the verdict is `FAIL`, the enumeration of every violation is encoded inline on that same final line so that the entire reason lives on it (for example, as a numbered list with inline separators). The orchestrator parses that final line to decide between proceeding to the commit/check stage and writing the reason into `error.log` to restart the inner loop.

6. **Commit/check stage.** When the reviewer returns `PASS`, the task is finalized in this order: first, the task's checkbox is flipped from `[ ]` to `[x]` in the plan file and its metrics object is finalized for that task. Then, when the git integration is active (see `cli-commands/implement/git-integration.md`), the orchestrator runs `git add -A` followed by `git commit` with the task's plan number and title verbatim as the commit message. The inner loop ends with success only after both the plan-file update and (when applicable) the commit have completed.

   When the git integration is active and `git commit` exits non-zero, this stage is treated as a failing stage: the checkbox flip is reverted in the plan file, the git output is captured into `error.log`, and the inner loop restarts. The details of this recovery live in `cli-commands/implement/git-integration.md`.

## Task metrics persistence
The metrics object of the current task (defined in `shared/plan-file-format.md`) is kept up to date in the plan file while the inner loop runs. A user inspecting the plan file at any point during the run finds values that reflect what the tool has consumed on that task so far. The values are written back to the plan file often enough that the file never lags noticeably behind the live UI.

When a task is marked complete (its checkbox flipped to `[x]`), its metrics object reflects the total consumption accumulated over the entire effort on that task, including the cost of any iterations that failed before the one that passed the adversarial review.

## Previous-iteration error briefing
The previous-iteration briefing is a generic addendum appended to the worker prompt automatically whenever `iteration` is greater than 1. It identifies the current iteration number, states that the previous iteration produced a problem to review, and points at the `error.log` file inside the temporary folder. Iteration 1 receives no such addendum.

The decision to add the briefing depends only on the iteration counter — there is no separate flag. Failing stages do not set anything beyond writing to `error.log`; the counter increment in stage 1 of the next iteration is what makes the briefing appear.

`error.log` is overwritten on each failing iteration, so the next iteration sees only the most recent failure context. The same fixed file name is used regardless of which stage produced the failure (build, test, or reviewer), so the briefing wording stays generic.

## Hard stop
Exceeding `MAX_ITER` on any single task ends the entire run. The command prints an error that:
- Identifies the task by its line number and title.
- Points at the temporary folder so the user can inspect the per-iteration logs and `error.log`.

Unlike every other exit path, the hard stop intentionally preserves the temporary folder on disk so the user can inspect it; the automatic cleanup defined in `cli-commands/implement/workspace.md` is suppressed in this case.

The command then exits non-zero.

## Spec folder immovability
None of the AI agents spawned by the `implement` command — the worker or the reviewer — may write to `contracts/`, `rules/`, or `plans/`. The `implement` command itself writes to `plans/` only to rewrite the checkbox state and the metrics object of an existing task line as work progresses (per the commit/check and task-metrics-persistence sections above and per `shared/plan-file-format.md`); it does not create, delete, or rename plan files. See `shared/spec-folder-write-authority.md`.
