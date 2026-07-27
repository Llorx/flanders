# `implement` Command Contract — Git Integration

## Purpose
Define how the implement command interacts with git: the requirement that the project be a git repository, what is checked before the run starts, how each accepted task is committed, and how a failing commit is handled.

## Requirement
The implement command requires the project to be a git repository: `git` must be available on the host (executable on `PATH`) and the command's working directory must be inside a git working tree. Git is not optional and is not toggled by any flag. When the project is not a git repository — `git` is unavailable, or the working directory is not inside a git working tree — the command exits non-zero at startup, before setting up any workspace, with a diagnostic that tells the user the project must be a git repository.

## Preflight check
Before setting up the workspace (see [.spec/contracts/cli-commands/implement/workspace.md](/.spec/contracts/cli-commands/implement/workspace.md)), the command runs a preflight check. It passes only when all of the following hold:

- The project is a git repository, per the Requirement above.
- No spec file carries an uncommitted change. A spec file is any file whose path traverses a directory named `.spec` at any depth (see [.spec/contracts/shared/spec-folder-layout.md](/.spec/contracts/shared/spec-folder-layout.md)), so the condition covers that folder's contracts, rules, and Flanders behavior rules alike. An uncommitted change is any modification, addition (including an untracked file that was never added to the index), deletion, or rename that the index or the working tree holds and the current commit does not — staged and unstaged alike.
- No file other than the selected plan file and the spec files the previous condition governs carries an unstaged change. An unstaged change is any modification, addition (including an untracked file that was never added to the index), or deletion that is present in the working tree but not recorded in the index. A file that is partially staged — it carries staged content and further unstaged content at the same time — has unstaged changes.
- Staged changes to files that are not spec files are permitted: they are left in the index untouched, they form the run baseline defined below, and they are folded into the first accepted task's commit as part of that task's work.

The selected plan file is excluded from the check unconditionally, regardless of whether it is listed in `.gitignore` and regardless of whether its changes are staged. This avoids spurious failures when the plan file is tracked and was modified by a previous, partially-committed run.

On preflight failure the command exits non-zero with a diagnostic, before setting up any workspace. The diagnostic reports every condition the check found violated, so a single run surfaces all of them at once:

- For an uncommitted spec file, the diagnostic tells the user the spec must be committed before re-running, and lists the path of every offending spec file.
- For an unstaged change to any other file, the diagnostic asks the user to stage, commit, or stash the unstaged changes before re-running; it does NOT list the offending files — the list may be long and is left to the user to inspect via `git status`.

## Run baseline
Once the preflight above passes, the command captures the pending state of the working tree as the run baseline: the content of every change already present in the tree when the run started — necessarily staged, since the preflight admits no other pending change — together with the plan file the preflight excludes. The baseline is captured before the first task's worker is launched and stays fixed for the whole run.

The baseline is what separates the work a run performs from the state it inherited. Every change a task's worker produces is a change that postdates the baseline, and the pending changes the baseline holds are no worker's work: they were authored before the run began, by whatever produced them. Each adversarial reviewer therefore judges the changes produced since the baseline rather than every pending change the tree carries, and the orchestrator provides each reviewer what it needs to tell the two apart (see [.spec/contracts/cli-commands/implement/iteration-loop.md#inner-loop-per-task](/.spec/contracts/cli-commands/implement/iteration-loop.md#inner-loop-per-task) and [src/prompts/.spec/rules/ai/review.md#every-flanders-adversarial-reviewer-derives-the-change-set-from-git-status-not-from-git-diff-alone](/src/prompts/.spec/rules/ai/review.md#every-flanders-adversarial-reviewer-derives-the-change-set-from-git-status-not-from-git-diff-alone)). A path the baseline carries is still reviewed for whatever content a worker later adds to it: the baseline excludes the inherited content, not the file.

The baseline governs review only. The commit sequence below is unaffected: the baseline's changes are staged and captured by the first accepted task's commit exactly as any other pending change, so the run still leaves a clean tree after every task.

## Staging after the worker
After the worker stage of the inner loop completes on each iteration (see [.spec/contracts/cli-commands/implement/iteration-loop.md](/.spec/contracts/cli-commands/implement/iteration-loop.md)), and before the build, test, and adversarial-review gates run, the orchestrator stages every change in the working tree with `git add -A`. This is the point at which the worker's output — including files it created that were never tracked — enters the index. It runs on every iteration, so each re-attempt of a task re-stages the working tree as it then stands.

## Commit per task
The commit/check stage of the inner loop (see [.spec/contracts/cli-commands/implement/iteration-loop.md](/.spec/contracts/cli-commands/implement/iteration-loop.md)) commits the work for the accepted task. The sequence for that stage is:

1. The plan file is updated in place: the task's checkbox is flipped from `[ ]` to `[x]` and its metrics object is finalized for that task.
2. The orchestrator stages every change in the working tree with `git add -A` again. The worker stage already staged the worker's output (see Staging after the worker above); this second `git add -A` re-stages so that anything the build or test gates produced after that staging is captured by the commit too.
3. The orchestrator creates a commit with `--allow-empty`. The commit message is exactly the task's plan number followed by a single space and the task's title, both taken verbatim from the plan file. For example, a task that appears in the plan file as `7.3 Validate plan file at startup` produces the commit message `7.3 Validate plan file at startup`.

The commit therefore captures both the worker's implementation changes and the orchestrator's update to the plan file as a single atomic unit per task.

The commit is generated with `--allow-empty` so that an accepted task always produces a commit even when the working tree has no changes to stage — for example, when the worker finds the task already satisfied for any reason and makes no edits, and the plan file is excluded from the index (so flipping its checkbox does not show up as a staged change either). The one-commit-per-accepted-task invariant must hold regardless of the resulting diff.

Staged changes to files that are not spec files are the only uncommitted state the preflight permits at startup, and the first accepted task's commit captures them alongside that task's own changes. Every accepted task ends in a commit that stages and captures the whole working tree, so after each task the working tree is clean and every subsequent task starts from a clean tree. Consequently the staging performed for a task picks up only that task's changes — plus, for the first task, the run baseline the user had pending before the run, which the commit captures without the review having attributed it to that task's worker.

## Commit failure
If `git commit` exits non-zero (for example because a pre-commit hook rejects the change), the commit/check stage is treated as a failing stage exactly like a failing build, test, or adversarial review stage:

- The checkbox flip from step 1 of the commit sequence is reverted in the plan file (the task's checkbox is rewritten from `[x]` back to `[ ]`), so the plan file on disk stays consistent with the absence of a commit. The metrics object is not reverted: its values reflect real consumption and the next iteration will continue to accumulate on top of them.
- The combined stdout and stderr of the failed git invocation are written into the `error.log` file inside the temporary folder, overwriting any previous contents.
- The inner loop restarts at stage 1 of the next iteration, which increments `iteration` and counts toward `MAX_ITER`. The next iteration's worker prompt receives the previous-iteration briefing as usual, so the worker is informed that the previous attempt failed.

## Output
All `git` invocations emitted by the implement command — preflight checks, staging, and commits — stream their stdout and stderr into the output region defined in [.spec/contracts/cli-commands/implement/ui.md](/.spec/contracts/cli-commands/implement/ui.md), like any other subprocess the command spawns.
