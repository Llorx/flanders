# When the change set is empty, the reviewer judges the spec against the committed working tree, not against the absence of a diff

When a Flanders adversarial reviewer enumerates the change set under review and that enumeration is empty — `git status --porcelain` reports nothing, and both the unstaged and staged diffs are empty — the empty change set is not itself a failure. The reviewer reaches its verdict by judging the spec under review against the committed working tree at `HEAD`, and it passes when that spec is already satisfied there.

This is the case of an idempotent re-application: work that a prior step already committed legitimately leaves nothing to change, so the current review produces no diff while the code that satisfies the spec is present at `HEAD`.

## Who this applies to

- **Subject:** every Flanders adversarial reviewer — the `implement` command's reviewer(s) (see [.docs/contracts/cli-commands/implement/iteration-loop.md](/.docs/contracts/cli-commands/implement/iteration-loop.md)) and the `/flanders-work` skill's reviewer subagent (see [.docs/contracts/ai-skills/work-skill.md](/.docs/contracts/ai-skills/work-skill.md)) — at the moment it decides its verdict, but only when the change set enumerated per [src/prompts/.docs/rules/ai/review/reviewer-derives-change-set-from-git.md](/src/prompts/.docs/rules/ai/review/reviewer-derives-change-set-from-git.md) is empty. The spec under review is the plan task and its acceptance criteria for `implement`, and the user's request for `/flanders-work`.
- **Not subject:** the reviewer when the change set is non-empty — the standard review of the changes is unchanged and is governed by the reviewer's other obligations.

## Behavior

When the enumerated change set is empty:

1. **The empty change set is not a failure on its own.** The reviewer does not record a violation for the sole reason that there is no diff this cycle. The absence of a diff is the expected shape of an idempotent re-application of already-committed work.

2. **The spec is judged against `HEAD`.** The reviewer verifies each element of the spec against the committed working tree, drawing the evidence each element's classification requires per [src/commands/.docs/rules/ai/agents/evidence/claim-evidence-classification.md](/src/commands/.docs/rules/ai/agents/evidence/claim-evidence-classification.md): for a toolchain-guarded element, the automated signal the project already runs; for a test-guarded element, an existing passing test whose assertion a regression would trip; for a review-adjudicated element, the reviewer's inspection of the full working tree at `HEAD`. The reviewer does not require the evidence to originate from an uncommitted diff.

3. **The verdict follows from the spec, not from the diff's size.** The reviewer passes — recording its verdict by leaving its error-log file empty per [src/prompts/.docs/rules/ai/review/reviewer-records-verdict-via-error-log.md](/src/prompts/.docs/rules/ai/review/reviewer-records-verdict-via-error-log.md) — when the spec under review is satisfied at `HEAD`. It records a violation only for a spec element, contract, or rule that is genuinely unsatisfied at `HEAD`.

## Why

An agent that correctly determines its work is already satisfied by committed code produces no diff. A reviewer that treats the empty diff as proof that "the spec carries no evidence" fails such work even though the code is present and its tests pass. That failure is a false negative: it consumes a full additional iteration in which the work re-runs and again produces nothing, and the state does not change. Anchoring the verdict to the committed working tree removes that false negative, because the evidence each spec element needs already exists at `HEAD` through the same classification the project applies to every other claim: an existing test, an automated signal, or a full-working-tree inspection.

## Failure signals

- The reviewer records a violation whose sole basis is that `git status --porcelain` is empty or that the diff contains no hunks.
- The reviewer requires a spec element's evidence to live in an uncommitted diff and disregards an existing test, an automated signal, or the committed code at `HEAD` that already satisfies it.
- Two reviewers of the same empty change set reach opposite verdicts because one judges the spec against `HEAD` and the other treats the empty diff as a failure.
