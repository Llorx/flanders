# `implement` Command Contract — Git Integration

## Purpose
Define how the implement command interacts with git: the requirement that the project be a git repository, what is checked before the run starts, how each accepted task is committed, and how a failing commit is handled.

## Requirement
The implement command requires the project to be a git repository: `git` must be available on the host (executable on `PATH`) and the command's working directory must be inside a git working tree. Git is not optional and is not toggled by any flag. When the project is not a git repository — `git` is unavailable, or the working directory is not inside a git working tree — the command exits non-zero at startup, before setting up any workspace, with a diagnostic that tells the user the project must be a git repository. There is no mode in which the command runs without git.

## Preflight check
Before setting up the workspace (see `.docs/contracts/cli-commands/implement/workspace.md`), the command runs a preflight check:

- The project must be a git repository, per the Requirement above.
- The working tree must be clean except for the plan file selected for this run.
- The selected plan file is excluded from the check unconditionally, regardless of whether it is listed in `.gitignore`. This avoids spurious failures when the plan file is tracked and was modified by a previous, partially-committed run.
- Any other pending modification, addition, or deletion in the working tree causes the preflight to fail.

On preflight failure the command exits non-zero with a diagnostic, before setting up any workspace. When the failure is an unclean working tree, the diagnostic asks the user to commit or stash the pending changes before re-running; it does NOT list the offending files — the list may be long and is left to the user to inspect via `git status`.

## Commit per task
The commit/check stage of the inner loop (see `.docs/contracts/cli-commands/implement/iteration-loop.md`) commits the work for the accepted task. The sequence for that stage is:

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
All `git` invocations emitted by the implement command — preflight checks, staging, and commits — stream their stdout and stderr into the output region defined in `.docs/contracts/cli-commands/implement/ui.md`, like any other subprocess the command spawns.
