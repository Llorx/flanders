# Every Flanders adversarial reviewer derives the change set from `git status`, not from `git diff` alone

Every Flanders adversarial reviewer treats git as the authoritative source for the complete set of files under review. It enumerates that set with `git status --porcelain` — which surfaces modified, created, deleted, and renamed files in one pass, including created files that were never staged — and inspects every file in the set. Relying on `git diff` or `git diff --stat` alone is not enough: those surfaces only report tracked changes, so a file that was created but never `git add`-ed is untracked and never appears in them, and a reviewer anchored on diff alone can miss a brand-new file in full.

## Who this applies to

- **Subject:** the construction of every Flanders adversarial reviewer prompt — the `implement` command's reviewer(s) (see [.docs/contracts/cli-commands/implement/iteration-loop.md](/.docs/contracts/cli-commands/implement/iteration-loop.md)) and the `/flanders-work` skill's reviewer subagent (see [.docs/contracts/ai-skills/work-skill.md](/.docs/contracts/ai-skills/work-skill.md)) — at the point where the prompt instructs the reviewer how to determine the change set under review. The change set under review is the worker's uncommitted changes for `implement`, and the working-tree changes present when the review runs for `/flanders-work`. The project is always a git repository in both cases, so this enumeration is unconditional.
- **Not subject:** the worker and other agents; this rule governs only how the adversarial reviewer enumerates the change set, not any other reviewer obligation. It also does not govern how the orchestrator or skill provisions or inspects the reviewer's verdict file.

## Behavior

When the reviewer determines the change set under review:

1. **Enumerate with `git status --porcelain`.** The reviewer runs `git status --porcelain` and reads its output as the authoritative, complete enumeration: tracked modifications (` M`, `M `), staged or unstaged creations, untracked creations (`??`), deletions (` D`, `D `), and renames (`R `). This enumeration — not the list of files the request or task happens to name — is the set the reviewer must account for.

2. **Inspect every file in the set.** The reviewer inspects each file the enumeration reports. It does not narrow its inspection to the files the request or task references when `git status` reports more, and it does not skip a created or deleted file because it was not mentioned.

3. **Read content the right way per file kind.** For tracked modifications, the reviewer inspects content with `git diff` (and `git diff --cached` for staged hunks). For created files that are still untracked — which `git diff` does not surface — the reviewer inspects the file by reading it directly from disk. A created file is never left uninspected on the grounds that `git diff` showed nothing for it.

When the enumeration above is empty — `git status --porcelain` reports no files — the verdict the reviewer reaches is pinned by [src/prompts/.docs/rules/ai/review/reviewer-empty-change-set-judged-against-head.md](/src/prompts/.docs/rules/ai/review/reviewer-empty-change-set-judged-against-head.md).

All of these are read-only git operations and are permitted under [src/commands/.docs/rules/ai/agents/no-git-writes.md](/src/commands/.docs/rules/ai/agents/no-git-writes.md); this rule never authorizes the reviewer to mutate repository state.

## Why

The changes are uncommitted when the reviewer runs, and the agent that produced them does not reliably stage them. `git diff HEAD` and `git diff --stat` report only tracked paths, so a newly created file that was never `git add`-ed is invisible to them. A reviewer that discovers the changes through diff alone therefore has a blind spot precisely where a whole new file was added — the case where an unreviewed file is most dangerous. `git status --porcelain` lists tracked changes and untracked creations together, in a stable machine-readable form, so making it the authoritative enumeration removes the blind spot and guarantees the reviewer accounts for every file that was touched, created, or removed.

## Failure signals

- The reviewer determines the change set from `git diff`, `git diff HEAD`, or `git diff --stat` alone and never runs `git status`, so untracked created files are absent from what it reviews.
- A file that was created but not staged exists in the work tree, yet the reviewer never inspects it because no diff surface reported it.
- The reviewer confines its inspection to the files the request or task references while `git status` reports additional modified, created, or deleted files that go unexamined.
- The reviewer sees an untracked created file in `git status` but skips its content because `git diff` produced no hunks for it, instead of reading the file directly.
