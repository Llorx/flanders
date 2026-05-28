# A claim's evidence requirement is set by whether a regression triggers an automated signal

Any Flanders subagent that classifies a claim (as defined in `rules/ai/agents/evidence-report.md`) to decide what evidence proves it classifies each claim by ONE question: would a plausible regression of the claim trigger an automated failure signal — a build error, a type error, a linker error, an existing test failing, or a runtime crash on a code path the test suite already exercises — WITHOUT any new test being added?

- **If yes**, the toolchain already guards the claim. The evidence is a `file:line` citation in the change plus the name of the automated failure a regression would trigger (for example, "removing this method breaks the call site at X:Y", "narrowing this type surfaces as a type error at Z"). Naming the signal is mandatory: a bare "structural", "verified by inspection", or "N/A regression" without an identified automated failure does not place a claim in this branch.
- **If no**, the claim has no implicit guard. It is satisfied only when a test — new or existing — would fail under the regression. The evidence is the test's `file:line`, the assertion that performs the check, and a one-sentence regression argument naming the change that would break that exact assertion. "The behavior is correct in the current code" is never sufficient on its own for a claim in this branch.

## Who this applies to

- **Subject:** every Flanders-launched subagent that produces or grades evidence for a claim. The canonical cases today are the `worker` subagent — when assembling its Evidence Report per `rules/ai/agents/evidence-report.md` — and the adversarial `reviewer` subagent — when deciding PASS or FAIL on each claim. Any future role of the same shape — produce-then-be-audited, or audit-another's-output — falls under this rule.
- **Not subject:** the `/flanders-spec` and `/flanders-plan` post-write validators. They grade markdown spec and plan files, not code under test; their checks live in their own per-skill rules and do not use the regression-signal question.

## Cases that never have an implicit guard

Regardless of language, framework, or toolchain, the following claim shapes ALWAYS fall in the "no implicit guard" branch — a compiler, type system, or linker cannot observe them, so only an explicit test guards them. A subagent that places one of these in the toolchain-guarded branch is misclassifying:

- **Literal content.** The claim prescribes the literal content of a string, comment, docstring, configuration value, template, generated file, or any other artifact whose content is data rather than code. Changing one byte of such content produces no automated signal anywhere. The guard is a test that would fail if the prescribed content were removed or altered.
- **Absence of a pattern.** The claim prescribes that something does NOT occur — no occurrence of a token, no call to a function, no reference to a path, no multi-assertion `ASSERT` block, no `private`-state peek. Absence is invisible to a compiler; the guard is a search-based test that asserts zero matches. Many rules of the form "must not X" land in this shape.
- **Order.** The claim prescribes that items appear in a specific order. Order within a string or data structure is opaque to type systems; the guard is a positional or sequence assertion that would fail if the items were reordered.
- **Count.** The claim prescribes a quantity — exactly N occurrences, at least N items, no more than N call sites. Counts are opaque to type systems; the guard is a counting assertion that would fail if the quantity changed.

## Why a single question instead of a category list

A taxonomy of named categories ("structural", "behavioral", "negative-scope", and so on) invites a subagent to pick whichever label lets it skip the regression check on a claim it has already decided is satisfied — and two runs over the same artifact can pick different labels for the same claim, producing inconsistent verdicts. The regression-signal question removes that freedom: the subagent cannot classify a claim as toolchain-guarded without naming the concrete build, type, link, test, or runtime failure a regression would trigger. If it cannot name one, the claim is in the no-implicit-guard branch by definition, and an explicit test is required. The classification follows from the toolchain's actual behavior, not from a label the subagent is free to assign.

## Failure signals

- A subagent classifies a claim as toolchain-guarded ("structural", "verified by inspection", "N/A regression") without naming the concrete automated signal a regression would trigger.
- A claim that prescribes literal content, the absence of a pattern, an order, or a count is marked satisfied by a citation of the artifact alone, with no test that would fail if the prescribed content were removed, reordered, or its count changed.
- A subagent accepts "the behavior is correct in the current code" as evidence for a claim in the no-implicit-guard branch.
- Two audits of the same unchanged artifact place the same claim in different branches, because the subagent assigned a category label rather than answering the regression-signal question.
- A rule claim with an absence-of-a-pattern shape (for example, the testing rule against multiple independent `Assert.*` calls inside a single `ASSERT` block) is marked satisfied without a search-based assertion that confirms zero matches in the diff.
