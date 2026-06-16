# Evidence Report rules

## Adversarially-reviewed subagents self-audit via an Evidence Report

Any Flanders subagent whose deliverable is subsequently graded PASS/FAIL by an adversarial reviewer must, before declaring its task complete, produce an Evidence Report enumerating every claim the subagent is asserting and citing the concrete evidence in the working tree that satisfies each one. The Evidence Report is a self-audit step: its purpose is to surface assertions that pass today but would not detect a future regression — the most common cause of reviewer rejection.

The report lives in the subagent's final text output, as the closing section of its response. It is not a file; it is captured in the subagent's per-iteration log.

### What a claim is

A claim is an assertion the subagent must back with evidence in the report. Three kinds, each defined by where it comes from:

- **Acceptance-criterion claim.** A criterion stated in the task description that the deliverable must satisfy.
- **Rule claim.** A rule whose obligation is in scope for this iteration. A rule is in scope when it is either (a) explicitly linked by the task, or (b) triggered by the subagent's diff per [src/commands/.spec/rules/ai/evidence.md#a-deliverable-subagent-scopes-rule-and-contract-claims-by-its-own-diff-not-by-the-tasks-link-list](/src/commands/.spec/rules/ai/evidence.md#a-deliverable-subagent-scopes-rule-and-contract-claims-by-its-own-diff-not-by-the-tasks-link-list). The set is the union of the two; the diff-driven scope is additive on top of the link list, never a replacement.
- **Contract claim.** A contract whose obligation is in scope for this iteration, identified by the same union rule as for rule claims.

The classification framework in [src/commands/.spec/rules/ai/evidence.md#a-claims-evidence-requirement-is-set-by-what-signal-can-soundly-observe-its-regression](/src/commands/.spec/rules/ai/evidence.md#a-claims-evidence-requirement-is-set-by-what-signal-can-soundly-observe-its-regression) applies identically to the three kinds: every claim is classified by the same regression-signal question, and every claim in the no-implicit-guard branch needs a guard whose regression argument is sound.

### Worker-lightweight vs reviewer-heavyweight

The deliverable subagent's self-audit is bounded by its diff and the task's links per [src/commands/.spec/rules/ai/evidence.md#a-deliverable-subagent-scopes-rule-and-contract-claims-by-its-own-diff-not-by-the-tasks-link-list](/src/commands/.spec/rules/ai/evidence.md#a-deliverable-subagent-scopes-rule-and-contract-claims-by-its-own-diff-not-by-the-tasks-link-list); the adversarial reviewer audits the full working tree per [.spec/contracts/cli-commands/implement/iteration-loop.md](/.spec/contracts/cli-commands/implement/iteration-loop.md). Both audits use the same claim-evidence framework — [src/commands/.spec/rules/ai/evidence.md#a-claims-evidence-requirement-is-set-by-what-signal-can-soundly-observe-its-regression](/src/commands/.spec/rules/ai/evidence.md#a-claims-evidence-requirement-is-set-by-what-signal-can-soundly-observe-its-regression) and [src/commands/.spec/rules/ai/evidence.md#a-claim-that-enumerates-n-facts-needs-n-independent-guards](/src/commands/.spec/rules/ai/evidence.md#a-claim-that-enumerates-n-facts-needs-n-independent-guards) — but apply it at different scopes.

### Subject

The prompt of any Flanders-launched subagent whose **deliverable** — not its verdict — is graded PASS/FAIL by an adversarial reviewer. A deliverable is source code, tests, configuration, or behavior-affecting documentation produced by the subagent in the working tree. The canonical case today is the `worker` subagent of the `implement` command's inner loop. Any future role with the same shape — produce a deliverable, then be reviewed — falls under this rule.

The rule pins how the subagent's prompt is constructed, not how the subagent happens to reason. A prompt without the Evidence Report instruction violates this rule even if the subagent self-audits on its own initiative.

### Not subject

**The adversarial reviewer.** Explicitly excluded, even though it reads this rule as part of the rule-discovery scan. The reviewer audits the Evidence Report produced by the worker; it does not produce one of its own. Its result is a verdict, not a deliverable.

The reviewer signals that verdict by writing the violations it finds into the `error.log` file, per [src/prompts/.spec/rules/ai/review.md#every-flanders-adversarial-reviewer-records-its-verdict-by-writing-violations-into-its-error-log-file-never-via-its-output-or-exit-code](/src/prompts/.spec/rules/ai/review.md#every-flanders-adversarial-reviewer-records-its-verdict-by-writing-violations-into-its-error-log-file-never-via-its-output-or-exit-code); a review that finds nothing leaves that file empty. The reviewer's own streamed output has no prescribed format and the orchestrator does not read it for the verdict. This rule must therefore never lead a reviewer to produce an Evidence Report of its own, nor to treat the violations it records as a deliverable to be self-audited. If a reader of this rule is the reviewer, the correct application is: use the structure of the Evidence Report as a checklist when auditing the worker's report, and record each violation it finds into `error.log` rather than emitting a report of its own.

**Subagents that do not produce reviewable deliverables.** For example, the build/test detection agent writes scripts but is not adversarially reviewed; it is out of scope. Any subagent that only inspects or summarizes without producing artifacts that are subsequently graded is also out of scope.

**The in-session worker of the `/flanders-work` skill.** `/flanders-work` performs its work in the user's own session rather than through a Flanders-launched subagent, so it is not a subject of this rule even though its result is subsequently reviewed. It is not required to produce an Evidence Report; its result is validated directly by the `/flanders-work` reviewer (see [src/prompts/.spec/rules/ai/skills/work.md#the-flanders-work-review-loop-is-driven-by-the-presence-and-content-of-a-temporary-error-log-file](/src/prompts/.spec/rules/ai/skills/work.md#the-flanders-work-review-loop-is-driven-by-the-presence-and-content-of-a-temporary-error-log-file)). The "future role with the same shape" clause in the Subject above scopes future Flanders-launched subagents, not the in-session worker.

### What the Evidence Report must contain

The report has three sections, in order. Each section is rendered with a labelled heading so the reviewer can locate it.

#### Acceptance-criterion claims

For every acceptance criterion in the task, one entry with:

1. **The criterion**, stated verbatim or as a brief paraphrase clear enough to match it to the task description.
2. **Evidence in the working tree**, as a `file:line` citation — the code, test, or both that satisfies the criterion.
3. **The evidence the claim's classification requires**, per [src/commands/.spec/rules/ai/evidence.md#a-claims-evidence-requirement-is-set-by-what-signal-can-soundly-observe-its-regression](/src/commands/.spec/rules/ai/evidence.md#a-claims-evidence-requirement-is-set-by-what-signal-can-soundly-observe-its-regression). The subagent classifies each criterion by that rule's regression-signal question into one of its three branches and produces the evidence that branch prescribes: for a toolchain-guarded criterion, the named automated failure a regression would trigger; for a test-guarded criterion, the assertion `file:line` and a sound one-sentence regression argument; for a review-adjudicated criterion, the targeted `file:line` and the statement that the reviewer verifies it by inspection because no automated signal and no test-surface observation reaches it. A literal-content, order, count, or absence criterion that is observable through the public surface is test-guarded and cites a test that would fail under the regression, never "the fact holds by inspection"; the same shapes observable only by reading the subject's source as text are review-adjudicated and must not be given a source-reading test. When a test-guarded criterion's regression argument cannot be soundly constructed — the assertion would still pass under a regression the criterion forbids — the assertion is too weak: the subagent strengthens it (typically by replacing substring, prefix, or inclusion checks with exact-match comparisons on literal values), re-runs the toolchain, and updates the report. The subagent must not declare complete while any test-guarded criterion has an unsound or missing regression argument.

One entry per criterion. A criterion that enumerates N independent facts ("X AND Y AND Z", "items A, B, C, D") expands into one entry per fact, each with its own evidence, per [src/commands/.spec/rules/ai/evidence.md#a-claim-that-enumerates-n-facts-needs-n-independent-guards](/src/commands/.spec/rules/ai/evidence.md#a-claim-that-enumerates-n-facts-needs-n-independent-guards).

#### Rule claims

For every in-scope rule per [src/commands/.spec/rules/ai/evidence.md#a-deliverable-subagent-scopes-rule-and-contract-claims-by-its-own-diff-not-by-the-tasks-link-list](/src/commands/.spec/rules/ai/evidence.md#a-deliverable-subagent-scopes-rule-and-contract-claims-by-its-own-diff-not-by-the-tasks-link-list), one entry with:

1. **The rule**, identified by its namespace (its path relative to the project root).
2. **The trigger**, naming which part of the subagent's diff (or which task link) brought this rule into scope — for example, "added tests in `<file>` triggers [src/.spec/rules/testing.md#multiple-assertions-go-in-an-asserts-object](/src/.spec/rules/testing.md#multiple-assertions-go-in-an-asserts-object)".
3. **Evidence of compliance**, as `file:line` citations, classified by the same three-branch regression-signal question pinned in [src/commands/.spec/rules/ai/evidence.md#a-claims-evidence-requirement-is-set-by-what-signal-can-soundly-observe-its-regression](/src/commands/.spec/rules/ai/evidence.md#a-claims-evidence-requirement-is-set-by-what-signal-can-soundly-observe-its-regression). A rule obligation of the absence-of-a-pattern shape that is observable through the test surface — common in `src/.spec/rules/testing/` and `src/.spec/rules/disposables/`, for example an `ASSERT` block that records zero forbidden calls or a diff that contains no matching line — is test-guarded and needs a search-based or recorded-call assertion that confirms zero matches over that observable surface. An obligation that is a property of the subject's production source as text — for example the forbidden-import absence pinned by [src/.spec/rules/external-access-through-contexts.md](/src/.spec/rules/external-access-through-contexts.md), or a semantic-judgment obligation such as non-duplication — is review-adjudicated: its evidence is the targeted `file:line` plus the statement that the reviewer verifies it by inspection, and fabricating a source-reading test to guard it violates [src/.spec/rules/testing.md#tests-assert-through-the-public-surface-not-private-state](/src/.spec/rules/testing.md#tests-assert-through-the-public-surface-not-private-state). A rule whose obligation enumerates N distinct prohibited patterns or N distinct required patterns expands into N independent entries per [src/commands/.spec/rules/ai/evidence.md#a-claim-that-enumerates-n-facts-needs-n-independent-guards](/src/commands/.spec/rules/ai/evidence.md#a-claim-that-enumerates-n-facts-needs-n-independent-guards).

#### Contract claims

For every in-scope contract per [src/commands/.spec/rules/ai/evidence.md#a-deliverable-subagent-scopes-rule-and-contract-claims-by-its-own-diff-not-by-the-tasks-link-list](/src/commands/.spec/rules/ai/evidence.md#a-deliverable-subagent-scopes-rule-and-contract-claims-by-its-own-diff-not-by-the-tasks-link-list), one entry with the same three fields as a rule claim: the contract's namespace (its path relative to the project root), the trigger from the diff or task link, and the evidence of compliance classified by the regression-signal question. Contract obligations that pin literal public-surface details (string messages, output channels, error-shape fields) fall into the literal-content shape and require an exact-match assertion; a substring or prefix check on those details is too weak.

### Why this exists

The adversarial reviewer applies a strict claim-verification protocol that rejects "the behavior is correct in the current code" as evidence: a claim is satisfied only when a hypothetical regression of it would be caught — by an automated failure (failing test, missing file, type error, lint error), by a test assertion that would flip, or, for a review-adjudicated claim, by the reviewer's own re-inspection of the working tree on the next iteration. Subagents that do not self-audit against the same standard regularly produce work that passes the current toolchain but does not protect the claim against regression, which then causes a FAIL at the review stage and a costly extra iteration. The Evidence Report forces the subagent to perform that audit before the reviewer is invoked, catching most weak-evidence patterns at the cost of the report itself.

A self-audit limited to acceptance-criterion claims leaves a class of reviewer rejections uncaught: rules and contracts the diff implicitly triggers without being surfaced in the audit. Enumerating rule and contract claims in addition closes that gap, while keeping the scope bounded to the subagent's own diff per [src/commands/.spec/rules/ai/evidence.md#a-deliverable-subagent-scopes-rule-and-contract-claims-by-its-own-diff-not-by-the-tasks-link-list](/src/commands/.spec/rules/ai/evidence.md#a-deliverable-subagent-scopes-rule-and-contract-claims-by-its-own-diff-not-by-the-tasks-link-list) so the audit stays within the lightweight discipline that distinguishes the worker's self-audit from the reviewer's full-tree audit.

The report is also the artifact a human can read in the per-iteration log to understand what the subagent claims to have delivered and how it argues each piece.

### Failure signals

- The prompt of an in-scope subagent does not include the instruction to produce an Evidence Report before declaring complete.
- The subagent declares complete without an Evidence Report in its final output.
- The Evidence Report omits the acceptance-criterion section, the rule-claim section, or the contract-claim section, or collapses the three sections into a single undifferentiated list that does not name which kind of claim each entry covers.
- A test-guarded claim (per [src/commands/.spec/rules/ai/evidence.md#a-claims-evidence-requirement-is-set-by-what-signal-can-soundly-observe-its-regression](/src/commands/.spec/rules/ai/evidence.md#a-claims-evidence-requirement-is-set-by-what-signal-can-soundly-observe-its-regression)) cites only the source-code change without identifying the assertion that would fail under a regression.
- A review-adjudicated claim (a source-text property such as a forbidden-import absence, or a semantic-judgment property such as non-duplication) is guarded by a test that reads the subject's source as text or pierces its encapsulation, in violation of [src/.spec/rules/testing.md#tests-assert-through-the-public-surface-not-private-state](/src/.spec/rules/testing.md#tests-assert-through-the-public-surface-not-private-state); or it omits the targeted `file:line` the reviewer needs to inspect.
- A literal-content, absence, order, or count claim that is observable through the public surface is paired with an assertion that would still pass under the regression it must detect — a substring or prefix check where exact match is required, a search that does not confirm zero matches, or an order or count fact asserted "by inspection" — or is misclassified review-adjudicated to dodge the test.
- A claim classified as toolchain-guarded does not name the concrete automated failure (build error, type error, linker error, lint error from a checker the project runs, existing test failing, runtime crash on an exercised path) a regression would trigger.
- A regression argument is missing, hand-waved ("the test covers this"), or trivially defeated by a plausible regression the assertion would still pass under — and the subagent does not strengthen the assertion before declaring complete.
- The Evidence Report omits a rule or contract whose namespace is triggered by the subagent's diff per [src/commands/.spec/rules/ai/evidence.md#a-deliverable-subagent-scopes-rule-and-contract-claims-by-its-own-diff-not-by-the-tasks-link-list](/src/commands/.spec/rules/ai/evidence.md#a-deliverable-subagent-scopes-rule-and-contract-claims-by-its-own-diff-not-by-the-tasks-link-list), on the grounds that the task did not link it.
- The Evidence Report omits a rule or contract the task linked, on the grounds that the diff does not touch anything related — the diff-driven scope is additive on top of the link list, never a replacement.
- The Evidence Report collapses an N-fact claim into fewer than N entries (see [src/commands/.spec/rules/ai/evidence.md#a-claim-that-enumerates-n-facts-needs-n-independent-guards](/src/commands/.spec/rules/ai/evidence.md#a-claim-that-enumerates-n-facts-needs-n-independent-guards)), whether the claim is an acceptance criterion, a rule, or a contract.
- The reviewer produces an Evidence Report of its own, instead of recording the violations it finds into `error.log` per [src/prompts/.spec/rules/ai/review.md#every-flanders-adversarial-reviewer-records-its-verdict-by-writing-violations-into-its-error-log-file-never-via-its-output-or-exit-code](/src/prompts/.spec/rules/ai/review.md#every-flanders-adversarial-reviewer-records-its-verdict-by-writing-violations-into-its-error-log-file-never-via-its-output-or-exit-code).

## A claim's evidence requirement is set by what signal can soundly observe its regression

Any Flanders subagent that classifies a claim (as defined in [src/commands/.spec/rules/ai/evidence.md#adversarially-reviewed-subagents-self-audit-via-an-evidence-report](/src/commands/.spec/rules/ai/evidence.md#adversarially-reviewed-subagents-self-audit-via-an-evidence-report)) to decide what evidence proves it classifies each claim by ONE question: what kind of signal would soundly observe a plausible regression of the claim? The answer places the claim in exactly one of three branches, and the subagent must name the concrete observer the branch requires — it may never assert a claim satisfied without naming the automated failure, the asserting test, or the reviewer inspection that a regression would trip.

- **Toolchain-guarded** — a plausible regression triggers an automated failure signal WITHOUT any new test being added: a build error, a type error, a linker error, a linter or other static-analysis error from a checker the project actually runs, an existing test failing, or a runtime crash on a code path the test suite already exercises. The evidence is a `file:line` citation in the change plus the name of the automated failure a regression would trigger (for example, "removing this method breaks the call site at X:Y", "narrowing this type surfaces as a type error at Z", "adding the forbidden import trips the `no-restricted-imports` lint rule"). Naming the signal is mandatory: a bare "structural", "verified by inspection", or "N/A regression" without an identified automated failure does not place a claim in this branch. A linter signal qualifies only when the project actually runs that linter as part of its build or test flow; a linter that does not exist is not a signal.

- **Test-guarded** — no toolchain signal observes the regression, but the property is observable through the public behavioral surface a test is permitted to inspect per [src/.spec/rules/testing.md#tests-assert-through-the-public-surface-not-private-state](/src/.spec/rules/testing.md#tests-assert-through-the-public-surface-not-private-state): return values, fired callbacks, side effects recorded on injected dependencies, externally observable state, or an artifact the test legitimately constructs and reads back. The claim is satisfied only when a test — new or existing — would fail under the regression. The evidence is the test's `file:line`, the asserting call, and a one-sentence regression argument naming the change that would break that exact assertion. "The behavior is correct in the current code" is never sufficient on its own for a claim in this branch.

- **Review-adjudicated** — no toolchain signal observes the regression AND the property cannot be observed through the test surface without reading the subject's source as text or piercing its encapsulation. The guard is the adversarial reviewer's enumerated inspection of the working tree, which is re-run on every iteration per [.spec/contracts/cli-commands/implement/iteration-loop.md](/.spec/contracts/cli-commands/implement/iteration-loop.md). The evidence is a `file:line` citation plus the explicit statement that the property is verified by reviewer inspection because it has neither an automated signal nor a test-surface observation. Fabricating a test that reads the module's own source as text — `readFileSync`/`require('fs')` plus a pattern match over a `.ts` file — to "guard" such a claim is itself a violation: it breaks [src/.spec/rules/testing.md#tests-assert-through-the-public-surface-not-private-state](/src/.spec/rules/testing.md#tests-assert-through-the-public-surface-not-private-state) and must not be produced.

### Who this applies to

- **Subject:** every Flanders-launched subagent that produces or grades evidence for a claim. The canonical cases today are the `worker` subagent — when assembling its Evidence Report per [src/commands/.spec/rules/ai/evidence.md#adversarially-reviewed-subagents-self-audit-via-an-evidence-report](/src/commands/.spec/rules/ai/evidence.md#adversarially-reviewed-subagents-self-audit-via-an-evidence-report) — and the adversarial `reviewer` subagent — when deciding PASS or FAIL on each claim. Any future role of the same shape — produce-then-be-audited, or audit-another's-output — falls under this rule.
- **Not subject:** the `/flanders-spec` and `/flanders-plan` post-write validators. They grade markdown spec and plan files, not code under test; their checks live in their own per-skill rules and do not use the regression-signal question.

### How the non-toolchain shapes are placed

A claim with no toolchain signal lands in test-guarded or review-adjudicated according to whether the test surface can observe it. The following claim shapes never have a toolchain signal — a compiler, type system, or linker cannot observe them — so each is either test-guarded or review-adjudicated, never toolchain-guarded:

- **Literal content.** The claim prescribes the literal content of a string, comment, docstring, configuration value, template, generated file, or any other artifact whose content is data rather than code. Changing one byte produces no automated signal. When the content is observable through the public surface (a returned value, a recorded call argument, an emitted message), the guard is a **test** with an exact-match assertion that would fail if the content were removed or altered. When the content is observable only by reading the subject's source as text, the claim is **review-adjudicated**.
- **Absence of a pattern.** The claim prescribes that something does NOT occur — no occurrence of a token, no call to a function, no reference to a path, no multi-assertion `ASSERT` block, no `private`-state peek. When the absence is observable through the test surface — a stub records that a method was never called, a returned options object carries no forbidden key, the diff under audit contains no matching line — the guard is a **search-based or recorded-call test** that asserts zero matches over that observable surface. When the absence is a property of the subject's production source as text — no `child_process`/`process`/`os` import, no `process.platform` read, no direct `console.log` from a class with an output context — the claim is **review-adjudicated** (or toolchain-guarded by a linter the project runs, when one exists), never guarded by a source-reading test.
- **Order.** The claim prescribes that items appear in a specific order. When the order is observable through the public surface (a returned sequence, a recorded sequence of calls), the guard is a **test** with a positional assertion. When it is a property of the source as text, the claim is **review-adjudicated**.
- **Count.** The claim prescribes a quantity — exactly N occurrences, at least N items, no more than N call sites. When the quantity is observable through the public surface, the guard is a **test** with a counting assertion. When it is a property of the source as text, the claim is **review-adjudicated**.
- **Semantic judgment.** The claim prescribes a property no mechanical check decides soundly — no duplicated logic, sensible naming, the right abstraction, a design intent honored. These are always **review-adjudicated**: the adversarial reviewer judges them by reading the change, exactly as it already enumerates duplicated constants and swallowed errors. A heuristic test invented to approximate such a property is unsound and is not an acceptable guard.

### Why a single question with three answers, not a category list

A free taxonomy of named categories ("structural", "behavioral", "negative-scope", and so on) invites a subagent to pick whichever label lets it skip the work on a claim it has already decided is satisfied — and two runs over the same artifact can pick different labels, producing inconsistent verdicts. The regression-signal question removes that freedom in both directions:

- The subagent cannot claim **toolchain-guarded** without naming the concrete build, type, link, lint, test, or runtime failure a regression would trigger. If it cannot name one, the claim is not in this branch.
- The subagent cannot claim **review-adjudicated** to dodge writing a test for a property the test surface can actually observe. Review-adjudicated is reserved for properties genuinely unobservable through the public surface without reading source text or piercing encapsulation; a property a recorded stub call or a returned value would reveal is test-guarded, and "the reviewer will see it" does not excuse the missing test.

The classification follows from where the regression would actually show up, not from a label the subagent is free to assign.

### The regression story for a review-adjudicated claim

A review-adjudicated claim is not exempt from regression protection; its protection is structural rather than frozen. The adversarial reviewer audits the full working tree on every iteration, so a regression of the property is caught the next time the reviewer runs — that re-inspection is the guard, and it is why such a claim does not need a test and must not be given a source-reading one. "The behavior is correct in the current code" remains insufficient on its own: the worker's evidence must name which property the reviewer is to verify and at which `file:line`, so the reviewer's inspection is targeted rather than open-ended.

### Failure signals

- A subagent classifies a claim as toolchain-guarded ("structural", "verified by inspection", "N/A regression") without naming the concrete automated signal a regression would trigger, or names a linter the project does not actually run.
- A claim whose property is observable through the public surface (literal content, absence, order, or count visible in a returned value, a recorded call, or the diff under audit) is marked satisfied by a citation of the artifact alone, or is classified review-adjudicated, instead of carrying a test that would fail if the content were removed, reordered, or its count changed.
- A review-adjudicated claim (a source-text property such as a forbidden-import absence, or a semantic-judgment property such as non-duplication) is guarded by a test that reads the subject's source as text or pierces its encapsulation, in violation of [src/.spec/rules/testing.md#tests-assert-through-the-public-surface-not-private-state](/src/.spec/rules/testing.md#tests-assert-through-the-public-surface-not-private-state).
- A subagent classifies a claim review-adjudicated to avoid writing a test for a property the test surface can observe.
- A subagent accepts "the behavior is correct in the current code" as evidence for a claim in the test-guarded branch, or omits the targeted `file:line` for a review-adjudicated claim.
- Two audits of the same unchanged artifact place the same claim in different branches, because the subagent assigned a category label rather than answering the regression-signal question.

## A claim that enumerates N facts needs N independent guards

When a single claim (as defined in [src/commands/.spec/rules/ai/evidence.md#adversarially-reviewed-subagents-self-audit-via-an-evidence-report](/src/commands/.spec/rules/ai/evidence.md#adversarially-reviewed-subagents-self-audit-via-an-evidence-report)) enumerates N independent facts that the artifact must satisfy — "the body contains items A, B, C, D, E, and F", "the result has fields X AND Y AND Z", "the output covers cases (a), (b), (c), (d)", "no occurrence of X, Y, or Z" — each of the N facts needs its own independent guard. A claim guarded by evidence covering only K of its N facts (K < N) is FAIL on the (N − K) facts that lack a guard, even when the uncovered facts happen to hold in the current artifact.

### Who this applies to

- **Subject:** every Flanders-launched subagent that produces or grades evidence for a claim — the `worker` self-auditing per [src/commands/.spec/rules/ai/evidence.md#adversarially-reviewed-subagents-self-audit-via-an-evidence-report](/src/commands/.spec/rules/ai/evidence.md#adversarially-reviewed-subagents-self-audit-via-an-evidence-report), the adversarial `reviewer` deciding PASS or FAIL, and any future role of the same shape.
- **Not subject:** the `/flanders-spec` and `/flanders-plan` post-write validators, which grade markdown spec and plan files rather than code under test.

### The enumerated-minimum is a floor, never a ceiling

A task may list, as one claim, a minimum set of guards the artifact must carry ("the test has separate entries for A, B, C, D"). That enumerated list is a floor: it adds to this rule, it does not cap it. When one claim enumerates N facts the artifact must satisfy and another claim lists K < N of them as the required guards, the N-guard obligation governs — all N facts need guards regardless of the smaller list. The mismatch between the two claims never licenses guarding only K; it is itself a signal that the smaller list undercounts what the artifact must protect.

### Why each fact needs its own guard

A guard that covers a subset of an enumerated claim lets a regression of any uncovered fact pass silently — exactly the outcome the regression-signal classification in [src/commands/.spec/rules/ai/evidence.md#a-claims-evidence-requirement-is-set-by-what-signal-can-soundly-observe-its-regression](/src/commands/.spec/rules/ai/evidence.md#a-claims-evidence-requirement-is-set-by-what-signal-can-soundly-observe-its-regression) exists to prevent, applied fact by fact. A single guard standing in for several conjoined facts also fails the moment the artifact changes: if the guard checks fact A and facts B and C are deleted, the claim is reported satisfied while two of its three obligations are gone. One guard per enumerated fact is what makes each fact independently regression-detectable.

### Failure signals

- A claim enumerating N facts is marked satisfied by evidence covering only some of them, with the rest asserted to hold "by inspection".
- A subagent treats a task's enumerated-minimum guard list as the complete set of required guards when another claim enumerates more facts the artifact must satisfy.
- Independent facts joined by AND in one claim are collapsed into a single guard that would still pass if one of the conjuncts regressed.
- A rule claim that prohibits N distinct patterns (for example, "no `private`-state peek AND no `as any` cast AND no `// @ts-expect-error` comment for the same purpose") is guarded by an assertion that checks only one of the N patterns.

## A deliverable subagent scopes rule and contract claims by its own diff, not by the task's link list

When a deliverable-producing subagent (today the `worker` of `implement`'s inner loop) assembles the rule-claim and contract-claim entries of its Evidence Report per [src/commands/.spec/rules/ai/evidence.md#adversarially-reviewed-subagents-self-audit-via-an-evidence-report](/src/commands/.spec/rules/ai/evidence.md#adversarially-reviewed-subagents-self-audit-via-an-evidence-report), it derives the set of in-scope rules and contracts from the diff its iteration produced — every file the iteration created, modified, deleted, or renamed — not from the subset of rules and contracts the task happens to link. The diff is the authoritative scope. The set is unioned with whatever the task explicitly linked: rules and contracts the task linked stay in scope whether or not the diff touches anything related; the diff-driven scope is additive on top of the link list, never a replacement.

### Who this applies to

- **Subject:** every Flanders-launched subagent whose deliverable is graded PASS/FAIL by an adversarial reviewer. The canonical case today is the `worker` subagent of the `implement` command's inner loop. Any future role with the same shape — produce a deliverable in the working tree, then be reviewed — falls under this rule.
- **Not subject:** the adversarial `reviewer` subagent. Its mandate, pinned in [.spec/contracts/cli-commands/implement/iteration-loop.md](/.spec/contracts/cli-commands/implement/iteration-loop.md) and reinforced in [src/commands/.spec/rules/ai/evidence.md#adversarially-reviewed-subagents-self-audit-via-an-evidence-report](/src/commands/.spec/rules/ai/evidence.md#adversarially-reviewed-subagents-self-audit-via-an-evidence-report), is to audit the full working tree against every rule and contract that should have applied, whether the task linked it or not. The reviewer must not bound its audit by the worker's diff; doing so would defeat the adversarial-review point.
- **Not subject:** the `/flanders-spec` and `/flanders-plan` post-write validators. They grade markdown spec and plan files, not code under test.

### How the scope is derived

For each rule and contract namespace in the global listings the subagent received in its prompt, the subagent walks its own diff and asks: does any obligation in this namespace's files plausibly apply to the kinds of work this diff performs? When the answer is yes for any file in the namespace, every file in that namespace whose obligation could be triggered by the diff becomes an in-scope claim and earns an entry in the Evidence Report. The default when in doubt is to include rather than skip: a namespace omitted on the grounds that the task did not link it is a violation when the diff actually triggers it.

The scope-derivation is namespace-first, the same heuristic the planner uses in [src/prompts/.spec/rules/ai/skills/plan.md#flanders-plan-selects-rule-links-by-scope-not-by-topic](/src/prompts/.spec/rules/ai/skills/plan.md#flanders-plan-selects-rule-links-by-scope-not-by-topic) for picking task links — applied here to a different surface (the worker's actual diff) and for a different purpose (auditing already-written code rather than picking links for a task that has not yet been worked).

### Scope examples

The list below illustrates the pattern and is not exhaustive:

- A diff that **modifies or adds tests** earns in-scope claims for every applicable file under `src/.spec/rules/testing/`.
- A diff that **creates or modifies anything with timers, listeners, controllers, child processes, or other async lifecycle** earns in-scope claims for every applicable file under `src/.spec/rules/disposables/`.
- A diff that **changes terminal UI or live-region output** earns in-scope claims for every applicable file under `src/ui/.spec/rules/`.
- A diff that **adds or modifies retry, backoff, or rate-limit handling around AI or external calls** earns in-scope claims for every applicable file under `src/ai/.spec/rules/retry/`.
- A diff that **changes how the AI runner invokes a CLI tool** earns in-scope claims for every applicable file under `src/ai/.spec/rules/runner/`.
- A diff that **adds or modifies a subagent's prompt construction** earns in-scope claims for every applicable file under `src/commands/.spec/rules/ai/agents/`.
- A diff that **touches any contract obligation** earns in-scope claims for every contract file whose obligation is affected, regardless of whether the task linked it.

When the diff spans multiple kinds of work — for example, "added a new test that exercises a controller with a timer" — the in-scope set is the union across all kinds.

### Why worker-lightweight and reviewer-heavyweight

The deliverable subagent has direct knowledge of its diff: it can enumerate, file by file, what it changed and therefore what scope to audit. Scoping its self-audit to the diff is cheap, accurate, and catches the bulk of weak-evidence patterns before the reviewer runs. The reviewer, in contrast, audits the working tree without prior knowledge of which files the worker touched — its mandate is broader and its check is heavier. The worker's self-audit is the first line of defense; the reviewer's audit is the gate. Both audits use the same claim-evidence framework ([src/commands/.spec/rules/ai/evidence.md#a-claims-evidence-requirement-is-set-by-what-signal-can-soundly-observe-its-regression](/src/commands/.spec/rules/ai/evidence.md#a-claims-evidence-requirement-is-set-by-what-signal-can-soundly-observe-its-regression) and [src/commands/.spec/rules/ai/evidence.md#a-claim-that-enumerates-n-facts-needs-n-independent-guards](/src/commands/.spec/rules/ai/evidence.md#a-claim-that-enumerates-n-facts-needs-n-independent-guards)); only the scope differs.

### Failure signals

- The deliverable subagent's Evidence Report enumerates only the rule and contract claims the task linked, ignoring rules and contracts the diff actually triggers (for example, a diff that adds tests but omits every applicable `src/.spec/rules/testing/*` claim because the task linked only some of them).
- The deliverable subagent skips a namespace on the grounds that the request or task did not mention it by keyword, even though the diff triggers obligations in that namespace.
- The deliverable subagent's Evidence Report contains rule or contract claims for files the diff does not touch and the task does not link, padding the audit beyond its scope.
- The deliverable subagent narrows the scope so aggressively that an obligation linked by the task is omitted from the Evidence Report because the diff does not touch it — the diff-driven scope is additive on top of the link list, never a replacement.
- The adversarial reviewer bounds its own audit by the worker's diff or by the worker's enumerated claims, instead of auditing the full working tree against every rule and contract that should have applied.
