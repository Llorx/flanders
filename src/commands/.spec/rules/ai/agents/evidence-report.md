# Adversarially-reviewed subagents self-audit via an Evidence Report

Any Flanders subagent whose deliverable is subsequently graded PASS/FAIL by an adversarial reviewer must, before declaring its task complete, produce an Evidence Report enumerating every claim the subagent is asserting and citing the concrete evidence in the working tree that satisfies each one. The Evidence Report is a self-audit step: its purpose is to surface assertions that pass today but would not detect a future regression — the most common cause of reviewer rejection.

The report lives in the subagent's final text output, as the closing section of its response. It is not a file; it is captured in the subagent's per-iteration log.

## What a claim is

A claim is an assertion the subagent must back with evidence in the report. Three kinds, each defined by where it comes from:

- **Acceptance-criterion claim.** A criterion stated in the task description that the deliverable must satisfy.
- **Rule claim.** A rule whose obligation is in scope for this iteration. A rule is in scope when it is either (a) explicitly linked by the task, or (b) triggered by the subagent's diff per [src/commands/.spec/rules/ai/agents/evidence/scope-driven-self-audit.md](/src/commands/.spec/rules/ai/agents/evidence/scope-driven-self-audit.md). The set is the union of the two; the diff-driven scope is additive on top of the link list, never a replacement.
- **Contract claim.** A contract whose obligation is in scope for this iteration, identified by the same union rule as for rule claims.

The classification framework in [src/commands/.spec/rules/ai/agents/evidence/claim-evidence-classification.md](/src/commands/.spec/rules/ai/agents/evidence/claim-evidence-classification.md) applies identically to the three kinds: every claim is classified by the same regression-signal question, and every claim in the no-implicit-guard branch needs a guard whose regression argument is sound.

## Worker-lightweight vs reviewer-heavyweight

The deliverable subagent's self-audit is bounded by its diff and the task's links per [src/commands/.spec/rules/ai/agents/evidence/scope-driven-self-audit.md](/src/commands/.spec/rules/ai/agents/evidence/scope-driven-self-audit.md); the adversarial reviewer audits the full working tree per [.spec/contracts/cli-commands/implement/iteration-loop.md](/.spec/contracts/cli-commands/implement/iteration-loop.md). Both audits use the same claim-evidence framework — [src/commands/.spec/rules/ai/agents/evidence/claim-evidence-classification.md](/src/commands/.spec/rules/ai/agents/evidence/claim-evidence-classification.md) and [src/commands/.spec/rules/ai/agents/evidence/enumerated-claim-coverage.md](/src/commands/.spec/rules/ai/agents/evidence/enumerated-claim-coverage.md) — but apply it at different scopes.

## Subject

The prompt of any Flanders-launched subagent whose **deliverable** — not its verdict — is graded PASS/FAIL by an adversarial reviewer. A deliverable is source code, tests, configuration, or behavior-affecting documentation produced by the subagent in the working tree. The canonical case today is the `worker` subagent of the `implement` command's inner loop. Any future role with the same shape — produce a deliverable, then be reviewed — falls under this rule.

The rule pins how the subagent's prompt is constructed, not how the subagent happens to reason. A prompt without the Evidence Report instruction violates this rule even if the subagent self-audits on its own initiative.

## Not subject

**The adversarial reviewer.** Explicitly excluded, even though it reads this rule as part of the rule-discovery scan. The reviewer audits the Evidence Report produced by the worker; it does not produce one of its own. Its result is a verdict, not a deliverable.

The reviewer signals that verdict by writing the violations it finds into the `error.log` file, per [src/prompts/.spec/rules/ai/review/reviewer-records-verdict-via-error-log.md](/src/prompts/.spec/rules/ai/review/reviewer-records-verdict-via-error-log.md); a review that finds nothing leaves that file empty. The reviewer's own streamed output has no prescribed format and the orchestrator does not read it for the verdict. This rule must therefore never lead a reviewer to produce an Evidence Report of its own, nor to treat the violations it records as a deliverable to be self-audited. If a reader of this rule is the reviewer, the correct application is: use the structure of the Evidence Report as a checklist when auditing the worker's report, and record each violation it finds into `error.log` rather than emitting a report of its own.

**Subagents that do not produce reviewable deliverables.** For example, the build/test detection agent writes scripts but is not adversarially reviewed; it is out of scope. Any subagent that only inspects or summarizes without producing artifacts that are subsequently graded is also out of scope.

**The in-session worker of the `/flanders-work` skill.** `/flanders-work` performs its work in the user's own session rather than through a Flanders-launched subagent, so it is not a subject of this rule even though its result is subsequently reviewed. It is not required to produce an Evidence Report; its result is validated directly by the `/flanders-work` reviewer (see [src/prompts/.spec/rules/ai/skills/work/review-loop-driven-by-error-log-presence.md](/src/prompts/.spec/rules/ai/skills/work/review-loop-driven-by-error-log-presence.md)). The "future role with the same shape" clause in the Subject above scopes future Flanders-launched subagents, not the in-session worker.

## What the Evidence Report must contain

The report has three sections, in order. Each section is rendered with a labelled heading so the reviewer can locate it.

### Acceptance-criterion claims

For every acceptance criterion in the task, one entry with:

1. **The criterion**, stated verbatim or as a brief paraphrase clear enough to match it to the task description.
2. **Evidence in the working tree**, as a `file:line` citation — the code, test, or both that satisfies the criterion.
3. **The evidence the claim's classification requires**, per [src/commands/.spec/rules/ai/agents/evidence/claim-evidence-classification.md](/src/commands/.spec/rules/ai/agents/evidence/claim-evidence-classification.md). The subagent classifies each criterion by that rule's regression-signal question into one of its three branches and produces the evidence that branch prescribes: for a toolchain-guarded criterion, the named automated failure a regression would trigger; for a test-guarded criterion, the assertion `file:line` and a sound one-sentence regression argument; for a review-adjudicated criterion, the targeted `file:line` and the statement that the reviewer verifies it by inspection because no automated signal and no test-surface observation reaches it. A literal-content, order, count, or absence criterion that is observable through the public surface is test-guarded and cites a test that would fail under the regression, never "the fact holds by inspection"; the same shapes observable only by reading the subject's source as text are review-adjudicated and must not be given a source-reading test. When a test-guarded criterion's regression argument cannot be soundly constructed — the assertion would still pass under a regression the criterion forbids — the assertion is too weak: the subagent strengthens it (typically by replacing substring, prefix, or inclusion checks with exact-match comparisons on literal values), re-runs the toolchain, and updates the report. The subagent must not declare complete while any test-guarded criterion has an unsound or missing regression argument.

One entry per criterion. A criterion that enumerates N independent facts ("X AND Y AND Z", "items A, B, C, D") expands into one entry per fact, each with its own evidence, per [src/commands/.spec/rules/ai/agents/evidence/enumerated-claim-coverage.md](/src/commands/.spec/rules/ai/agents/evidence/enumerated-claim-coverage.md).

### Rule claims

For every in-scope rule per [src/commands/.spec/rules/ai/agents/evidence/scope-driven-self-audit.md](/src/commands/.spec/rules/ai/agents/evidence/scope-driven-self-audit.md), one entry with:

1. **The rule**, identified by its namespace (its path relative to the project root).
2. **The trigger**, naming which part of the subagent's diff (or which task link) brought this rule into scope — for example, "added tests in `<file>` triggers [src/.spec/rules/testing/asserts-object-for-multiple-assertions.md](/src/.spec/rules/testing/asserts-object-for-multiple-assertions.md)".
3. **Evidence of compliance**, as `file:line` citations, classified by the same three-branch regression-signal question pinned in [src/commands/.spec/rules/ai/agents/evidence/claim-evidence-classification.md](/src/commands/.spec/rules/ai/agents/evidence/claim-evidence-classification.md). A rule obligation of the absence-of-a-pattern shape that is observable through the test surface — common in `src/.spec/rules/testing/` and `src/.spec/rules/disposables/`, for example an `ASSERT` block that records zero forbidden calls or a diff that contains no matching line — is test-guarded and needs a search-based or recorded-call assertion that confirms zero matches over that observable surface. An obligation that is a property of the subject's production source as text — for example the forbidden-import absence pinned by [src/.spec/rules/external-access-through-contexts.md](/src/.spec/rules/external-access-through-contexts.md), or a semantic-judgment obligation such as non-duplication — is review-adjudicated: its evidence is the targeted `file:line` plus the statement that the reviewer verifies it by inspection, and fabricating a source-reading test to guard it violates [src/.spec/rules/testing/assert-via-public-surface.md](/src/.spec/rules/testing/assert-via-public-surface.md). A rule whose obligation enumerates N distinct prohibited patterns or N distinct required patterns expands into N independent entries per [src/commands/.spec/rules/ai/agents/evidence/enumerated-claim-coverage.md](/src/commands/.spec/rules/ai/agents/evidence/enumerated-claim-coverage.md).

### Contract claims

For every in-scope contract per [src/commands/.spec/rules/ai/agents/evidence/scope-driven-self-audit.md](/src/commands/.spec/rules/ai/agents/evidence/scope-driven-self-audit.md), one entry with the same three fields as a rule claim: the contract's namespace (its path relative to the project root), the trigger from the diff or task link, and the evidence of compliance classified by the regression-signal question. Contract obligations that pin literal public-surface details (string messages, output channels, error-shape fields) fall into the literal-content shape and require an exact-match assertion; a substring or prefix check on those details is too weak.

## Why this exists

The adversarial reviewer applies a strict claim-verification protocol that rejects "the behavior is correct in the current code" as evidence: a claim is satisfied only when a hypothetical regression of it would be caught — by an automated failure (failing test, missing file, type error, lint error), by a test assertion that would flip, or, for a review-adjudicated claim, by the reviewer's own re-inspection of the working tree on the next iteration. Subagents that do not self-audit against the same standard regularly produce work that passes the current toolchain but does not protect the claim against regression, which then causes a FAIL at the review stage and a costly extra iteration. The Evidence Report forces the subagent to perform that audit before the reviewer is invoked, catching most weak-evidence patterns at the cost of the report itself.

A self-audit limited to acceptance-criterion claims leaves a class of reviewer rejections uncaught: rules and contracts the diff implicitly triggers without being surfaced in the audit. Enumerating rule and contract claims in addition closes that gap, while keeping the scope bounded to the subagent's own diff per [src/commands/.spec/rules/ai/agents/evidence/scope-driven-self-audit.md](/src/commands/.spec/rules/ai/agents/evidence/scope-driven-self-audit.md) so the audit stays within the lightweight discipline that distinguishes the worker's self-audit from the reviewer's full-tree audit.

The report is also the artifact a human can read in the per-iteration log to understand what the subagent claims to have delivered and how it argues each piece.

## Failure signals

- The prompt of an in-scope subagent does not include the instruction to produce an Evidence Report before declaring complete.
- The subagent declares complete without an Evidence Report in its final output.
- The Evidence Report omits the acceptance-criterion section, the rule-claim section, or the contract-claim section, or collapses the three sections into a single undifferentiated list that does not name which kind of claim each entry covers.
- A test-guarded claim (per [src/commands/.spec/rules/ai/agents/evidence/claim-evidence-classification.md](/src/commands/.spec/rules/ai/agents/evidence/claim-evidence-classification.md)) cites only the source-code change without identifying the assertion that would fail under a regression.
- A review-adjudicated claim (a source-text property such as a forbidden-import absence, or a semantic-judgment property such as non-duplication) is guarded by a test that reads the subject's source as text or pierces its encapsulation, in violation of [src/.spec/rules/testing/assert-via-public-surface.md](/src/.spec/rules/testing/assert-via-public-surface.md); or it omits the targeted `file:line` the reviewer needs to inspect.
- A literal-content, absence, order, or count claim that is observable through the public surface is paired with an assertion that would still pass under the regression it must detect — a substring or prefix check where exact match is required, a search that does not confirm zero matches, or an order or count fact asserted "by inspection" — or is misclassified review-adjudicated to dodge the test.
- A claim classified as toolchain-guarded does not name the concrete automated failure (build error, type error, linker error, lint error from a checker the project runs, existing test failing, runtime crash on an exercised path) a regression would trigger.
- A regression argument is missing, hand-waved ("the test covers this"), or trivially defeated by a plausible regression the assertion would still pass under — and the subagent does not strengthen the assertion before declaring complete.
- The Evidence Report omits a rule or contract whose namespace is triggered by the subagent's diff per [src/commands/.spec/rules/ai/agents/evidence/scope-driven-self-audit.md](/src/commands/.spec/rules/ai/agents/evidence/scope-driven-self-audit.md), on the grounds that the task did not link it.
- The Evidence Report omits a rule or contract the task linked, on the grounds that the diff does not touch anything related — the diff-driven scope is additive on top of the link list, never a replacement.
- The Evidence Report collapses an N-fact claim into fewer than N entries (see [src/commands/.spec/rules/ai/agents/evidence/enumerated-claim-coverage.md](/src/commands/.spec/rules/ai/agents/evidence/enumerated-claim-coverage.md)), whether the claim is an acceptance criterion, a rule, or a contract.
- The reviewer produces an Evidence Report of its own, instead of recording the violations it finds into `error.log` per [src/prompts/.spec/rules/ai/review/reviewer-records-verdict-via-error-log.md](/src/prompts/.spec/rules/ai/review/reviewer-records-verdict-via-error-log.md).
