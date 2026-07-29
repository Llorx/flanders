# `implement` Command Contract — Git Integration

## Purpose
Define how the `implement` command interacts with git: the requirement that the project be a git repository, and what is checked before the run starts. The git behavior of the work itself — the run baseline, the staging after each worker, the commit that closes an accepted task, and the handling of a failing commit — is the shared cycle's (see [.spec/contracts/shared/task-cycle.md](/.spec/contracts/shared/task-cycle.md)); what this command contributes to it is the bookkeeping and the commit message pinned in [.spec/contracts/cli-commands/implement/iteration-loop.md](/.spec/contracts/cli-commands/implement/iteration-loop.md).

## Requirement
The implement command requires the project to be a git repository: `git` must be available on the host (executable on `PATH`) and the command's working directory must be inside a git working tree. Git is not optional and is not toggled by any flag. When the project is not a git repository — `git` is unavailable, or the working directory is not inside a git working tree — the command exits non-zero at startup, before setting up any workspace, with a diagnostic that tells the user the project must be a git repository.

## Preflight check
Before setting up the workspace (see [.spec/contracts/cli-commands/implement/workspace.md](/.spec/contracts/cli-commands/implement/workspace.md)), the command runs a preflight check. It passes only when all of the following hold:

- The project is a git repository, per the Requirement above.
- No spec file carries an uncommitted change. A spec file is any file whose path traverses a directory named `.spec` at any depth (see [.spec/contracts/shared/spec-folder-layout.md](/.spec/contracts/shared/spec-folder-layout.md)), so the condition covers that folder's contracts, rules, and Flanders behavior rules alike. An uncommitted change is any modification, addition (including an untracked file that was never added to the index), deletion, or rename that the index or the working tree holds and the current commit does not — staged and unstaged alike.
- No file other than the selected plan file and the spec files the previous condition governs carries an unstaged change. An unstaged change is any modification, addition (including an untracked file that was never added to the index), or deletion that is present in the working tree but not recorded in the index. A file that is partially staged — it carries staged content and further unstaged content at the same time — has unstaged changes.
- Staged changes to files that are not spec files are permitted: they are left in the index untouched, they form the run baseline the cycle captures, and they are folded into the first accepted task's commit as part of that task's work.

The selected plan file is excluded from the check unconditionally, regardless of whether it is listed in `.gitignore` and regardless of whether its changes are staged. This avoids spurious failures when the plan file is tracked and was modified by a previous, partially-committed run.

On preflight failure the command exits non-zero with a diagnostic, before setting up any workspace. The diagnostic reports every condition the check found violated, so a single run surfaces all of them at once:

- For an uncommitted spec file, the diagnostic tells the user the spec must be committed before re-running, and lists the path of every offending spec file.
- For an unstaged change to any other file, the diagnostic asks the user to stage, commit, or stash the unstaged changes before re-running; it does NOT list the offending files — the list may be long and is left to the user to inspect via `git status`.

The command refuses the run rather than committing the pending spec itself, because the spec is the user's own authored work and committing it is the user's decision. The run baseline the cycle then captures holds only the staged non-spec changes this check admits, together with the plan file it excludes.

## Every accepted task ends in a clean tree
Staged changes to files that are not spec files are the only uncommitted state the preflight permits at startup, and the first accepted task's commit captures them alongside that task's own changes. Every accepted task ends in a commit that stages and captures the whole working tree, so after each task the working tree is clean and every subsequent task starts from a clean tree. Consequently the staging performed for a task picks up only that task's changes — plus, for the first task, the run baseline the user had pending before the run, which the commit captures without the review having attributed it to that task's worker.

## Output
All `git` invocations emitted by the implement command — preflight checks, staging, and commits — stream their stdout and stderr into the output region defined in [.spec/contracts/cli-commands/implement/ui.md](/.spec/contracts/cli-commands/implement/ui.md), like any other subprocess the command spawns.
