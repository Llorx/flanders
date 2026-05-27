# Adversarially-reviewed subagents self-audit via an Evidence Report

Any Flanders subagent whose deliverable is subsequently graded PASS/FAIL by an adversarial reviewer must, before declaring its task complete, produce an Evidence Report enumerating every acceptance criterion in the task and citing the concrete evidence in the working tree that satisfies each one. The Evidence Report is a self-audit step: its purpose is to surface assertions that pass today but would not detect a future regression — the most common cause of reviewer rejection.

The report lives in the subagent's final text output, as the closing section of its response. It is not a file; it is captured in the subagent's per-iteration log.

## Subject

The prompt of any Flanders-launched subagent whose **deliverable** — not its verdict — is graded PASS/FAIL by an adversarial reviewer. A deliverable is source code, tests, configuration, or behavior-affecting documentation produced by the subagent in the working tree. The canonical case today is the `worker` subagent of the `implement` command's inner loop. Any future role with the same shape — produce a deliverable, then be reviewed — falls under this rule.

The rule pins how the subagent's prompt is constructed, not how the subagent happens to reason. A prompt without the Evidence Report instruction violates this rule even if the subagent self-audits on its own initiative.

## Not subject

**The adversarial reviewer.** Explicitly excluded, even though it reads this rule as part of the rule-discovery scan. The reviewer audits the Evidence Report produced by the worker; it does not produce one of its own. Its output is a verdict, not a deliverable.

This exclusion is load-bearing for the reviewer's terminal format. The reviewer's prompt requires its final output to be exactly a single line of the form `PASS` or `FAIL <reason>`, with the FAIL enumeration encoded inline on that one line. This rule must never lead a reviewer to:

- Append an Evidence Report (or any other multi-line content) after the final PASS/FAIL line.
- Insert an Evidence Report (or any other section labelled as such) before the final PASS/FAIL line.
- Reword its final line to embed Evidence-Report-shaped content.

If a reader of this rule is the reviewer, the correct application is: use the structure of the Evidence Report as a checklist when auditing the worker's report, then reply with the single PASS or FAIL line exactly as the reviewer prompt specifies.

**Subagents that do not produce reviewable deliverables.** For example, the build/test detection agent writes scripts but is not adversarially reviewed; it is out of scope. Any subagent that only inspects or summarizes without producing artifacts that are subsequently graded is also out of scope.

## What the Evidence Report must contain

For every acceptance criterion in the task, the report contains an entry with:

1. **The criterion**, stated verbatim or as a brief paraphrase clear enough to match it to the task description.
2. **Evidence in the working tree**, as a `file:line` citation — the code, test, or both that satisfies the criterion.
3. **The evidence the criterion's classification requires**, per `rules/ai/agents/acceptance-criteria/criterion-evidence-classification.md`. The subagent classifies each criterion by that rule's regression-signal question and produces the evidence it prescribes: for a toolchain-guarded criterion, the named automated failure a regression would trigger; for a criterion with no implicit guard, the assertion `file:line` and a sound one-sentence regression argument. The literal-content, absence, order, and count cases that rule enumerates always need a test that would fail under the regression — the report cites that test, never "the fact holds by inspection". When a regression argument cannot be soundly constructed — the assertion would still pass under a regression the criterion forbids — the assertion is too weak: the subagent strengthens it (typically by replacing substring, prefix, or inclusion checks with exact-match comparisons on literal values), re-runs the toolchain, and updates the report. The subagent must not declare complete while any criterion in the no-implicit-guard branch has an unsound or missing regression argument.

One entry per criterion. A criterion that enumerates N independent facts ("X AND Y AND Z", "items A, B, C, D") expands into one entry per fact, each with its own evidence, per `rules/ai/agents/acceptance-criteria/enumerated-criterion-coverage.md`.

## Why this exists

The adversarial reviewer applies a strict acceptance-criteria verification protocol that rejects "the behavior is correct in the current code" as evidence: a criterion is satisfied only when a hypothetical regression of it would produce concrete evidence of failure (failing test, missing file, type error, etc.). Subagents that do not self-audit against the same standard regularly produce work that passes the current toolchain but does not protect the criterion against regression, which then causes a FAIL at the review stage and a costly extra iteration. The Evidence Report forces the subagent to perform that audit before the reviewer is invoked, catching most weak-evidence patterns at the cost of the report itself.

The report is also the artifact a human can read in the per-iteration log to understand what the subagent claims to have delivered and how it argues each piece.

## Failure signals

- The prompt of an in-scope subagent does not include the instruction to produce an Evidence Report before declaring complete.
- The subagent declares complete without an Evidence Report in its final output.
- A criterion in the no-implicit-guard branch (per `rules/ai/agents/acceptance-criteria/criterion-evidence-classification.md`) cites only the source-code change without identifying the assertion that would fail under a regression.
- A literal-content, absence, order, or count criterion is paired with an assertion that would still pass under the regression it must detect — a substring or prefix check where exact match is required, a search that does not confirm zero matches, or an order or count fact asserted "by inspection".
- A criterion classified as toolchain-guarded does not name the concrete automated failure (build error, type error, linker error, existing test failing, runtime crash on an exercised path) a regression would trigger.
- A regression argument is missing, hand-waved ("the test covers this"), or trivially defeated by a plausible regression the assertion would still pass under — and the subagent does not strengthen the assertion before declaring complete.
- The Evidence Report omits criteria from the task, or collapses an enumerated criterion's N independent facts into fewer than N entries (see `rules/ai/agents/acceptance-criteria/enumerated-criterion-coverage.md`).
- The reviewer produces an Evidence Report (or any content beyond the single final PASS/FAIL line) — this is a violation of the reviewer's terminal format, which this rule preserves rather than overrides.
