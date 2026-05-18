# `implement` Command Contract — Git Integration

## Purpose
Define how the implement command interacts with git: when the integration is active, what is checked before the run starts, how each accepted task is committed, and how a failing commit is handled.

## Activation
The git integration is active for a run only when all three of the following hold:

1. The `git` command is available on the host (executable on `PATH`).
2. The current working directory is inside a git working tree.
3. The `--no-git` flag was not passed to `implement`.

When any of these is false, the implement command runs without git: no preflight check, no commits, and no other git operations. Missing git or running outside a working tree is not an error condition — the command simply proceeds in its non-git mode.

## Flag
- `--no-git` — disables the git integration even when git is available and the project is a git working tree. When passed, the run behaves identically to a run on a non-git project.

## Preflight check
When the integration is active, the command runs a preflight check before setting up the workspace (see `cli-commands/implement/workspace.md`):

- The working tree must be clean except for the plan file selected for this run.
- The selected plan file is excluded from the check unconditionally, regardless of whether it is listed in `.gitignore`. This avoids spurious failures when the plan file is tracked and was modified by a previous, partially-committed run.
- Any other pending modification, addition, or deletion in the working tree causes the preflight to fail.

On preflight failure the command exits non-zero with a diagnostic that asks the user to commit or stash the pending changes before re-running. The diagnostic does NOT list the offending files — the list may be long and is left to the user to inspect via `git status`.

## Commit per task
When the integration is active, the commit/check stage of the inner loop (see `cli-commands/implement/iteration-loop.md`) commits the work for the accepted task. The sequence for that stage is:

1. The plan file is updated in place: the task's checkbox is flipped from `[ ]` to `[x]` and its metrics object is finalized for that task.
2. The orchestrator stages every change in the working tree with `git add -A`.
3. The orchestrator creates a commit with `--allow-empty`. The commit message is exactly the task's plan number followed by a single space and the task's title, both taken verbatim from the plan file. For example, a task that appears in the plan file as `7.3 Validate plan file at startup` produces the commit message `7.3 Validate plan file at startup`.

The commit therefore captures both the worker's implementation changes and the orchestrator's update to the plan file as a single atomic unit per task.

The commit is generated with `--allow-empty` so that an accepted task always produces a commit even when the working tree has no changes to stage — for example, when the worker finds the task already satisfied for any reason and makes no edits, and the plan file is excluded from the index (so flipping its checkbox does not show up as a staged change either). The one-commit-per-accepted-task invariant must hold regardless of the resulting diff.

Because the preflight guarantees a clean working tree at startup and every accepted task ends in a commit, the working tree is always clean at the start of each task; consequently `git add -A` at commit time picks up only that task's changes without any additional snapshotting or bookkeeping.

## Commit failure
If `git commit` exits non-zero (for example because a pre-commit hook rejects the change), the commit/check stage is treated as a failing stage exactly like a failing build, test, or adversarial review stage:

- The checkbox flip from step 1 of the commit sequence is reverted in the plan file (the task's checkbox is rewritten from `[x]` back to `[ ]`), so the plan file on disk stays consistent with the absence of a commit. The metrics object is not reverted: its values reflect real consumption and the next iteration will continue to accumulate on top of them.
- The combined stdout and stderr of the failed git invocation are written into the `error.log` file inside the temporary folder, overwriting any previous contents.
- The inner loop restarts at stage 1 of the next iteration, which increments `iteration` and counts toward `MAX_ITER`. The next iteration's worker prompt receives the previous-iteration briefing as usual, so the worker is informed that the previous attempt failed.

## Output
All `git` invocations emitted by the implement command — preflight checks, staging, and commits — stream their stdout and stderr into the output region defined in `cli-commands/implement/ui.md`, like any other subprocess the command spawns.

## Non-git mode
When the integration is inactive (any of the activation conditions is false), the command behaves as defined in the rest of the implement contracts without any git-specific behavior: there is no preflight check, no `git add`, no `git commit`, and a failing commit cannot be the cause of an iteration restart. The plan file is still updated in place as work progresses; persistence to disk simply does not include creating a git commit.
