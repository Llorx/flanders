# `/flanders-work` finalizes a clean review without committing, updating a plan, or writing Flanders configuration

When a `/flanders-work` review round ends with the reviewer reporting no violations, the skill's work is complete and it stops there. It does not commit the changes, does not create or modify any plan file, and does not write any Flanders configuration. The implemented changes are left in the working tree for the user to dispose of.

## Who this applies to

- **Subject:** the source content that produces the `/flanders-work` skill artifact body, and the `/flanders-work` skill at runtime, at the moment a review round ends with an empty verdict file per [src/prompts/.docs/rules/ai/skills/work/review-loop-driven-by-error-log-presence.md](/src/prompts/.docs/rules/ai/skills/work/review-loop-driven-by-error-log-presence.md).
- **Not subject:** the `implement` command, which finalizes an accepted task by flipping its plan-file checkbox and creating a per-task commit (see [.docs/contracts/cli-commands/implement/iteration-loop.md](/.docs/contracts/cli-commands/implement/iteration-loop.md) and [.docs/contracts/cli-commands/implement/git-integration.md](/.docs/contracts/cli-commands/implement/git-integration.md)).

## Behavior

On a clean review, the skill:

1. **Does not commit.** It runs no `git add`, `git commit`, or any other git command that mutates repository state. The changes remain as an uncommitted working tree for the user to review, amend, commit, or discard. (The reviewer subagent is separately forbidden from writing to git by [src/commands/.docs/rules/ai/agents/no-git-writes.md](/src/commands/.docs/rules/ai/agents/no-git-writes.md); this rule pins that the skill's own finalization also performs no commit.)

2. **Does not touch `plans/`.** It creates, modifies, deletes, and renames nothing in the `plans/` folder. `/flanders-work` has no plan file: its spec is the user's request, not a plan task, so there is no checkbox to flip and no metrics to record.

3. **Does not write Flanders configuration.** It writes nothing to `.flanders/`. The skill consumes no configuration and produces none.

The skill then reports completion to the user in chat, in the interaction language of [.docs/contracts/ai-skills/interaction-language.md](/.docs/contracts/ai-skills/interaction-language.md).

## Why

`/flanders-work` is the lightweight path that deliberately skips the `implement` pipeline's bookkeeping — plan files, per-task commits, and task metrics. Leaving the accepted changes uncommitted in the working tree hands control of how the work enters history back to the user, which fits a quick, in-session task where the user is present and decides what to do next.

## Failure signals

- The skill commits, stages, or otherwise mutates git state when a review passes.
- The skill writes a plan file, or flips a checkbox or rewrites metrics in an existing plan file, to record the completed work.
- The skill writes to `.flanders/` as part of finishing.
- The skill treats a clean review as requiring a commit before the work is considered done.
