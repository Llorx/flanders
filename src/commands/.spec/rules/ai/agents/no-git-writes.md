# Autonomous subagents never write to git

Any AI instance (Claude Code, Codex CLI, or any other supported tool) that runs as an autonomous agent inside this project — workers, reviewers, adversarial reviewers, validators, and in general any subagent launched by a skill, by an orchestration, or by the main session — is forbidden from running git commands that modify repository state. It may only read git, and only when its task requires it.

The only exempt instance is the interactive session with the user, which may run git write commands when the user explicitly asks for them in that same session.

## Who this applies to

- **Subject to the rule:** every subagent launched through the AI tool's subagent mechanism (in Claude Code, the `Agent` tool with any `subagent_type`; in Codex CLI, the equivalent when one exists), every AI-tool process launched by a skill or by the `implement` command as worker/reviewer/prep/validator/detect, and any instance that operates without a human answering turn by turn.
- **Exempt:** the interactive session in which the user is conversing with the AI tool. That session may run git write commands when the user asks for them explicitly. An order inferred or anticipated by Claude does not count as an explicit order.

A subagent does not inherit permission to write to git just because the session that launched it had it. The prohibition is by role, not by invocation chain.

## What counts as reading (allowed)

Operations that do not modify the working tree, the index, local refs, the stash, the reflog, hooks, or the repository configuration. For example:

- `git status`, `git diff`, `git log`, `git show`, `git blame`
- `git branch` (list), `git tag` (list), `git worktree list`
- `git ls-files`, `git ls-tree`, `git cat-file`, `git rev-parse`, `git rev-list`
- `git config --get` (read), `git remote -v` (read)

## What counts as writing (forbidden)

Any operation that modifies the repository's local state, even if it does not touch the network. For example, and without the list being exhaustive:

- Staging and index: `git add`, `git rm`, `git mv`, `git restore --staged`, `git reset` (any variant)
- Commits and history rewriting: `git commit`, `git commit --amend`, `git rebase`, `git cherry-pick`, `git revert`, `git merge`
- Refs and branches: `git branch` (create/rename/delete), `git tag` (create/delete), `git switch -c`, `git checkout -b`
- Working tree: `git checkout <path>`, `git restore <path>`, `git clean`
- Stash and worktrees: `git stash` (any subcommand), `git worktree add`, `git worktree remove`
- Configuration and hooks: `git config` (write), editing files under `.git/`
- Any remote command (already forbidden by the user's global rule): `git push`, `git pull`, `git fetch`, `git clone`

Achieving the same effect through alternative means is equally disallowed: editing `.git/HEAD`, `.git/index`, `.git/refs/*`, running `git` through a wrapper, invoking a library's git APIs, or asking another tool to run the command underneath.

## What the subagent does when a git write "would be needed"

When the subagent detects that its task requires a git change (commit, stage, merge, etc.), it must finish its work leaving the modified tree as is and report it to the invoker in its final message. It is the invoker's responsibility — the user's interactive session or an equivalent orchestrator — to decide whether to materialize that change in git.

The subagent must not ask the user for permission to make the commit itself: it simply does not do it.

## Failure signals

An execution violates this rule when, inside a subagent subject to the rule, any of the following appears:

- A call to the `Bash` tool (or equivalent) whose command starts with `git ` and is not in the reading list above.
- A direct edit to any file under `.git/`.
- A commit, stage, branch, tag, stash, or reset done through a library or wrapper instead of the git CLI.
- A message from the subagent to the invoker along the lines of "I committed X" or "I left Y staged".

If any of these signals appears, the behavior is incorrect even if the final result is the expected one.
