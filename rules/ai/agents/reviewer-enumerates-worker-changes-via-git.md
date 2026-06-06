# Inside a git work tree, the reviewer derives the worker's change set from `git status`, not from `git diff` alone

When the `implement` command runs inside a git work tree, the adversarial reviewer treats git as the authoritative source for the complete set of files the worker produced. It enumerates that set with `git status --porcelain` — which surfaces modified, created, deleted, and renamed files in one pass, including created files that were never staged — and inspects every file in the set. Relying on `git diff` or `git diff --stat` alone is not enough: those surfaces only report tracked changes, so a file the worker created but did not `git add` is untracked and never appears in them, and a reviewer anchored on diff alone can miss a brand-new file in full.

## Who this applies to

- **Subject:** the adversarial reviewer agent of the `implement` inner loop, at the moment it determines which files the worker changed, but only when the project is a git work tree (git is available and the project root is inside a working tree).
- **Not subject:** the reviewer when the project is not a git work tree. There the rule imposes nothing — the reviewer falls back to the files the task references and whatever its judgment deems relevant. This rule adds an obligation only when git is present; it does not remove or alter any other reviewer obligation.

## Behavior

When the reviewer runs inside a git work tree:

1. **Enumerate with `git status --porcelain`.** The reviewer runs `git status --porcelain` and reads its output as the authoritative, complete enumeration of the worker's uncommitted work: tracked modifications (` M`, `M `), staged or unstaged creations, untracked creations (`??`), deletions (` D`, `D `), and renames (`R `). This enumeration — not the list of files the task happens to name — is the set the reviewer must account for.

2. **Inspect every file in the set.** The reviewer inspects each file the enumeration reports. It does not narrow its inspection to the files the task references when `git status` reports more, and it does not skip a created or deleted file because it was not mentioned in the task.

3. **Read content the right way per file kind.** For tracked modifications, the reviewer inspects content with `git diff` (and `git diff --cached` for staged hunks). For created files that are still untracked — which `git diff` does not surface — the reviewer inspects the file by reading it directly from disk. A created file is never left uninspected on the grounds that `git diff` showed nothing for it.

When the enumeration above is empty — `git status --porcelain` reports no files — the verdict the reviewer reaches is pinned by `rules/ai/agents/reviewer-empty-change-set-judged-against-head.md`.

All of these are read-only git operations and are permitted under `rules/ai/agents/no-git-writes.md`; this rule never authorizes the reviewer to mutate repository state.

## Why

The worker's changes are uncommitted when the reviewer runs, and the worker does not reliably stage them. `git diff HEAD` and `git diff --stat` report only tracked paths, so a newly created file that was never `git add`-ed is invisible to them. A reviewer that discovers the worker's changes through diff alone therefore has a blind spot precisely where a whole new file was added — the case where an unreviewed file is most dangerous. `git status --porcelain` lists tracked changes and untracked creations together, in a stable machine-readable form, so making it the authoritative enumeration removes the blind spot and guarantees the reviewer accounts for every file the worker touched, created, or removed.

## Failure signals

- The reviewer determines the worker's change set from `git diff`, `git diff HEAD`, or `git diff --stat` alone and never runs `git status`, so untracked created files are absent from what it reviews.
- A file the worker created but did not stage exists in the work tree, yet the reviewer never inspects it because no diff surface reported it.
- The reviewer confines its inspection to the files the task references while `git status` reports additional modified, created, or deleted files that go unexamined.
- The reviewer sees an untracked created file in `git status` but skips its content because `git diff` produced no hunks for it, instead of reading the file directly.
