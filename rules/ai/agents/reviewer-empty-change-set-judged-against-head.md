# When the worker's change set is empty, the reviewer judges the task against the committed working tree, not against the absence of a diff

When the adversarial reviewer of the `implement` inner loop enumerates the worker's change set and that enumeration is empty — `git status --porcelain` reports nothing, and both the unstaged and staged diffs are empty — the empty change set is not itself a failure. The reviewer reaches its verdict by judging the task's acceptance criteria against the committed working tree at `HEAD`, and it passes the task when every acceptance criterion is already satisfied there.

This is the case of an idempotent re-application: a task whose work a prior iteration already committed legitimately leaves the worker with nothing to change, so the current cycle produces no diff while the code that satisfies the task is present at `HEAD`.

## Who this applies to

- **Subject:** the adversarial reviewer agent of the `implement` inner loop, at the moment it decides its verdict, but only when the worker's change set enumerated per `rules/ai/agents/reviewer-enumerates-worker-changes-via-git.md` is empty.
- **Not subject:** the reviewer when the change set is non-empty — the standard review of the worker's diff is unchanged and is governed by the reviewer's other obligations.

## Behavior

When the enumerated change set is empty:

1. **The empty change set is not a failure on its own.** The reviewer does not record a violation for the sole reason that the worker produced no diff this cycle. The absence of a diff is the expected shape of an idempotent re-application of already-committed work.

2. **Acceptance criteria are judged against `HEAD`.** The reviewer verifies each acceptance criterion against the committed working tree, drawing the evidence each criterion's classification requires per `rules/ai/agents/evidence/claim-evidence-classification.md`: for a toolchain-guarded criterion, the automated signal the project already runs; for a test-guarded criterion, an existing passing test whose assertion a regression would trip; for a review-adjudicated criterion, the reviewer's inspection of the full working tree at `HEAD`. The reviewer does not require the evidence to originate from an uncommitted diff.

3. **The verdict follows from the criteria, not from the diff's size.** The reviewer passes the task — creating its per-reviewer error file empty per `rules/ai/agents/reviewer-verdict-via-error-log.md` — when every acceptance criterion is satisfied at `HEAD`. It records a violation only for an acceptance criterion, contract, or rule that is genuinely unsatisfied at `HEAD`.

## Why

A worker that correctly determines its task is already satisfied by committed code produces no diff. A reviewer that treats the empty diff as proof that "the acceptance criteria carry no evidence" fails such a task even though the code is present and its tests pass. That failure is a false negative: it consumes a full additional iteration — the worker re-runs and again produces nothing, every reviewer re-runs — and the task's state does not change, so the loop only converges if a reviewer eventually contradicts the empty-diff failure. Anchoring the verdict to the committed working tree removes that false negative and keeps the verdict consistent across reviewers, because the evidence each criterion needs already exists at `HEAD` through the same classification the project applies to every other claim: an existing test, an automated signal, or a full-working-tree inspection.

## Failure signals

- The reviewer records a violation whose sole basis is that `git status --porcelain` is empty or that the worker's diff contains no hunks.
- The reviewer requires an acceptance criterion's evidence to live in the worker's uncommitted diff and disregards an existing test, an automated signal, or the committed code at `HEAD` that already satisfies the criterion.
- Two reviewers of the same empty change set reach opposite verdicts because one judges the acceptance criteria against `HEAD` and the other treats the empty diff as a failure.
