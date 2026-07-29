# Evidence Report rules

## Adversarially-reviewed subagents self-audit via an Evidence Report

Any Flanders subagent whose deliverable is subsequently graded PASS/FAIL by an adversarial reviewer must, before declaring its task complete, produce an Evidence Report enumerating every claim the subagent is asserting and citing the concrete evidence in the working tree — a `file:line` in the code, the tests, or both — that satisfies each one. The Evidence Report is a self-audit step: enumerating every obligation and pointing at where the work satisfies it surfaces the obligations the diff left unmet before the adversarial reviewer runs.

The report lives in the subagent's final text output, as the closing section of its response. It is not a file; it is captured in the subagent's per-iteration log.

### What a claim is

A claim is an assertion the subagent must back with evidence in the report. Three kinds, each defined by where it comes from:

- **Acceptance-criterion claim.** A criterion stated in the task description that the deliverable must satisfy.
- **Rule claim.** A rule whose obligation is in scope for this iteration. A rule is in scope when it is either (a) explicitly linked by the task, or (b) triggered by the subagent's diff per [src/commands/.spec/rules/ai/evidence.md#a-deliverable-subagent-scopes-rule-and-contract-claims-by-its-own-diff-not-by-the-tasks-link-list](/src/commands/.spec/rules/ai/evidence.md#a-deliverable-subagent-scopes-rule-and-contract-claims-by-its-own-diff-not-by-the-tasks-link-list). The set is the union of the two; the diff-driven scope is additive on top of the link list, never a replacement.
- **Contract claim.** A contract whose obligation is in scope for this iteration, identified by the same union rule as for rule claims.

### Worker-lightweight vs reviewer-heavyweight

The deliverable subagent's self-audit is bounded by its diff and the task's links per [src/commands/.spec/rules/ai/evidence.md#a-deliverable-subagent-scopes-rule-and-contract-claims-by-its-own-diff-not-by-the-tasks-link-list](/src/commands/.spec/rules/ai/evidence.md#a-deliverable-subagent-scopes-rule-and-contract-claims-by-its-own-diff-not-by-the-tasks-link-list); the adversarial reviewer audits the full working tree per [.spec/contracts/shared/task-cycle.md](/.spec/contracts/shared/task-cycle.md). The worker's report is the first line of defence, scoped to what it changed; the reviewer's audit is the gate, scoped to the whole tree.

### Subject

The prompt of any Flanders-launched subagent whose **deliverable** — not its verdict — is graded PASS/FAIL by an adversarial reviewer. A deliverable is source code, tests, configuration, or behavior-affecting documentation produced by the subagent in the working tree. The canonical case today is the `worker` of the single-task cycle (see [.spec/contracts/shared/task-cycle.md](/.spec/contracts/shared/task-cycle.md)), on whichever surface runs it. Any future role with the same shape — produce a deliverable, then be reviewed — falls under this rule.

The rule pins how the subagent's prompt is constructed, not how the subagent happens to reason. A prompt without the Evidence Report instruction violates this rule even if the subagent self-audits on its own initiative.

### Not subject

**The adversarial reviewer.** Explicitly excluded, even though it reads this rule as part of the rule-discovery scan. The reviewer audits the Evidence Report produced by the worker; it does not produce one of its own. Its result is a verdict, not a deliverable.

The reviewer signals that verdict by writing the violations it finds into the `error.log` file, per [src/prompts/.spec/rules/ai/review.md#every-flanders-adversarial-reviewer-records-its-verdict-by-writing-violations-into-its-error-log-file-never-via-its-output-or-exit-code](/src/prompts/.spec/rules/ai/review.md#every-flanders-adversarial-reviewer-records-its-verdict-by-writing-violations-into-its-error-log-file-never-via-its-output-or-exit-code); a review that finds nothing leaves that file empty. The reviewer's own streamed output has no prescribed format and the orchestrator does not read it for the verdict. This rule must therefore never lead a reviewer to produce an Evidence Report of its own, nor to treat the violations it records as a deliverable to be self-audited. If a reader of this rule is the reviewer, the correct application is: use the structure of the Evidence Report as a checklist when auditing the worker's report, and record each violation it finds into `error.log` rather than emitting a report of its own.

**Subagents that do not produce reviewable deliverables.** For example, the build/test detection agent writes scripts but is not adversarially reviewed; it is out of scope. Any subagent that only inspects or summarizes without producing artifacts that are subsequently graded is also out of scope.

**The orchestrating session of the `/flanders-implement` skill.** That session drives the cycle and implements nothing itself (see [src/prompts/.spec/rules/ai/skills/implement.md#the-flanders-implement-skill-orchestrates-the-cycle-and-implements-nothing-itself](/src/prompts/.spec/rules/ai/skills/implement.md#the-flanders-implement-skill-orchestrates-the-cycle-and-implements-nothing-itself)), so it produces no deliverable to self-audit. The worker that skill launches does produce one and is a subject of this rule like any other worker of the cycle.

### What the Evidence Report must contain

The report has three sections, in order. Each section is rendered with a labelled heading so the reviewer can locate it.

#### Acceptance-criterion claims

For every acceptance criterion in the task, one entry with:

1. **The criterion**, stated verbatim or as a brief paraphrase clear enough to match it to the task description.
2. **Evidence in the working tree**, as a `file:line` citation — the code, the test, or both that satisfies the criterion.

One entry per criterion. A criterion that enumerates N independent facts ("X AND Y AND Z", "items A, B, C, D") expands into one entry per fact, each with its own evidence, per [src/commands/.spec/rules/ai/evidence.md#a-claim-that-enumerates-n-facts-needs-n-independent-confirmations](/src/commands/.spec/rules/ai/evidence.md#a-claim-that-enumerates-n-facts-needs-n-independent-confirmations).

#### Rule claims

For every in-scope rule per [src/commands/.spec/rules/ai/evidence.md#a-deliverable-subagent-scopes-rule-and-contract-claims-by-its-own-diff-not-by-the-tasks-link-list](/src/commands/.spec/rules/ai/evidence.md#a-deliverable-subagent-scopes-rule-and-contract-claims-by-its-own-diff-not-by-the-tasks-link-list), one entry with:

1. **The rule**, identified by its namespace (its path relative to the project root).
2. **The trigger**, naming which part of the subagent's diff (or which task link) brought this rule into scope — for example, "added tests in `<file>` triggers [src/.spec/rules/testing.md#multiple-assertions-go-in-an-asserts-object](/src/.spec/rules/testing.md#multiple-assertions-go-in-an-asserts-object)".
3. **Evidence of compliance**, as `file:line` citations in the working tree that show the rule's obligation applied. A rule whose obligation enumerates N distinct prohibited patterns or N distinct required patterns expands into N independent entries per [src/commands/.spec/rules/ai/evidence.md#a-claim-that-enumerates-n-facts-needs-n-independent-confirmations](/src/commands/.spec/rules/ai/evidence.md#a-claim-that-enumerates-n-facts-needs-n-independent-confirmations).

#### Contract claims

For every in-scope contract per [src/commands/.spec/rules/ai/evidence.md#a-deliverable-subagent-scopes-rule-and-contract-claims-by-its-own-diff-not-by-the-tasks-link-list](/src/commands/.spec/rules/ai/evidence.md#a-deliverable-subagent-scopes-rule-and-contract-claims-by-its-own-diff-not-by-the-tasks-link-list), one entry with the same three fields as a rule claim: the contract's namespace (its path relative to the project root), the trigger from the diff or task link, and the `file:line` evidence of compliance in the working tree.

### Why this exists

A subagent that enumerates every obligation it is under and cites the `file:line` where the work satisfies it catches the obligations its diff left unmet before the reviewer runs — the most common cause of a costly extra iteration. Enumerating rule and contract claims alongside the acceptance criteria, rather than the criteria alone, closes the gap of rules and contracts the diff implicitly triggers without being surfaced; keeping that scope bounded to the subagent's own diff per [src/commands/.spec/rules/ai/evidence.md#a-deliverable-subagent-scopes-rule-and-contract-claims-by-its-own-diff-not-by-the-tasks-link-list](/src/commands/.spec/rules/ai/evidence.md#a-deliverable-subagent-scopes-rule-and-contract-claims-by-its-own-diff-not-by-the-tasks-link-list) keeps the self-audit lightweight next to the reviewer's full-tree audit.

The report is also the artifact a human can read in the per-iteration log to understand what the subagent claims to have delivered and where each piece lives.

### Failure signals

- The prompt of an in-scope subagent does not include the instruction to produce an Evidence Report before declaring complete.
- The subagent declares complete without an Evidence Report in its final output.
- The Evidence Report omits the acceptance-criterion section, the rule-claim section, or the contract-claim section, or collapses the three sections into a single undifferentiated list that does not name which kind of claim each entry covers.
- An entry cites no `file:line` evidence in the working tree for the claim it makes, resting the claim on "the behavior is correct in the current code" alone.
- The Evidence Report omits a rule or contract whose namespace is triggered by the subagent's diff per [src/commands/.spec/rules/ai/evidence.md#a-deliverable-subagent-scopes-rule-and-contract-claims-by-its-own-diff-not-by-the-tasks-link-list](/src/commands/.spec/rules/ai/evidence.md#a-deliverable-subagent-scopes-rule-and-contract-claims-by-its-own-diff-not-by-the-tasks-link-list), on the grounds that the task did not link it.
- The Evidence Report omits a rule or contract the task linked, on the grounds that the diff does not touch anything related — the diff-driven scope is additive on top of the link list, never a replacement.
- The Evidence Report collapses an N-fact claim into fewer than N entries (see [src/commands/.spec/rules/ai/evidence.md#a-claim-that-enumerates-n-facts-needs-n-independent-confirmations](/src/commands/.spec/rules/ai/evidence.md#a-claim-that-enumerates-n-facts-needs-n-independent-confirmations)), whether the claim is an acceptance criterion, a rule, or a contract.
- The reviewer produces an Evidence Report of its own, instead of recording the violations it finds into `error.log` per [src/prompts/.spec/rules/ai/review.md#every-flanders-adversarial-reviewer-records-its-verdict-by-writing-violations-into-its-error-log-file-never-via-its-output-or-exit-code](/src/prompts/.spec/rules/ai/review.md#every-flanders-adversarial-reviewer-records-its-verdict-by-writing-violations-into-its-error-log-file-never-via-its-output-or-exit-code).

## A claim that enumerates N facts needs N independent confirmations

When a single claim (as defined in [src/commands/.spec/rules/ai/evidence.md#adversarially-reviewed-subagents-self-audit-via-an-evidence-report](/src/commands/.spec/rules/ai/evidence.md#adversarially-reviewed-subagents-self-audit-via-an-evidence-report)) enumerates N independent facts that the artifact must satisfy — "the body contains items A, B, C, D, E, and F", "the result has fields X AND Y AND Z", "the output covers cases (a), (b), (c), (d)", "no occurrence of X, Y, or Z" — each of the N facts needs its own independent confirmation. A claim confirmed by evidence covering only K of its N facts (K < N) is FAIL on the (N − K) facts left unconfirmed, even when the uncovered facts happen to hold in the current artifact.

### Who this applies to

- **Subject:** every Flanders-launched subagent that produces or grades evidence for a claim — the `worker` self-auditing per [src/commands/.spec/rules/ai/evidence.md#adversarially-reviewed-subagents-self-audit-via-an-evidence-report](/src/commands/.spec/rules/ai/evidence.md#adversarially-reviewed-subagents-self-audit-via-an-evidence-report), the adversarial `reviewer` deciding PASS or FAIL, and any future role of the same shape.
- **Not subject:** the `/flanders-spec` and `/flanders-plan` post-write validators, which grade markdown spec and plan files rather than code under test.

### The enumerated-minimum is a floor, never a ceiling

A task may list, as one claim, a minimum set of confirmations the artifact must carry ("the test has separate entries for A, B, C, D"). That enumerated list is a floor: it adds to this rule, it does not cap it. When one claim enumerates N facts the artifact must satisfy and another claim lists K < N of them as the required confirmations, the N-confirmation obligation governs — all N facts need confirmation regardless of the smaller list. The mismatch between the two claims never licenses confirming only K; it is itself a signal that the smaller list undercounts what the artifact must satisfy.

### Why each fact needs its own confirmation

A confirmation that covers a subset of an enumerated claim lets a regression of any uncovered fact pass silently. A single confirmation standing in for several conjoined facts also fails the moment the artifact changes: if it checks fact A and facts B and C are deleted, the claim is reported satisfied while two of its three obligations are gone. One confirmation per enumerated fact is what makes each fact independently checkable.

### Failure signals

- A claim enumerating N facts is marked satisfied by evidence covering only some of them, with the rest asserted to hold "by inspection".
- A subagent treats a task's enumerated-minimum list as the complete set of required confirmations when another claim enumerates more facts the artifact must satisfy.
- Independent facts joined by AND in one claim are collapsed into a single confirmation that would still pass if one of the conjuncts regressed.
- A rule claim that prohibits N distinct patterns (for example, "no `private`-state peek AND no `as any` cast AND no `// @ts-expect-error` comment for the same purpose") is confirmed by checking only one of the N patterns.

## A deliverable subagent scopes rule and contract claims by its own diff, not by the task's link list

When a deliverable-producing subagent (today the `worker` of `implement`'s inner loop) assembles the rule-claim and contract-claim entries of its Evidence Report per [src/commands/.spec/rules/ai/evidence.md#adversarially-reviewed-subagents-self-audit-via-an-evidence-report](/src/commands/.spec/rules/ai/evidence.md#adversarially-reviewed-subagents-self-audit-via-an-evidence-report), it derives the set of in-scope rules and contracts from the diff its iteration produced — every file the iteration created, modified, deleted, or renamed — not from the subset of rules and contracts the task happens to link. The diff is the authoritative scope. The set is unioned with whatever the task explicitly linked: rules and contracts the task linked stay in scope whether or not the diff touches anything related; the diff-driven scope is additive on top of the link list, never a replacement.

### Who this applies to

- **Subject:** every Flanders-launched subagent whose deliverable is graded PASS/FAIL by an adversarial reviewer. The canonical case today is the `worker` of the single-task cycle (see [.spec/contracts/shared/task-cycle.md](/.spec/contracts/shared/task-cycle.md)), on whichever surface runs it. Any future role with the same shape — produce a deliverable in the working tree, then be reviewed — falls under this rule.
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

The deliverable subagent has direct knowledge of its diff: it can enumerate, file by file, what it changed and therefore what scope to audit. Scoping its self-audit to the diff is cheap, accurate, and catches the bulk of unmet obligations before the reviewer runs. The reviewer, in contrast, audits the working tree without prior knowledge of which files the worker touched — its mandate is broader and its check is heavier. The worker's self-audit is the first line of defense; the reviewer's audit is the gate. Both audits enumerate every obligation and cite the working-tree evidence per [src/commands/.spec/rules/ai/evidence.md#adversarially-reviewed-subagents-self-audit-via-an-evidence-report](/src/commands/.spec/rules/ai/evidence.md#adversarially-reviewed-subagents-self-audit-via-an-evidence-report) and [src/commands/.spec/rules/ai/evidence.md#a-claim-that-enumerates-n-facts-needs-n-independent-confirmations](/src/commands/.spec/rules/ai/evidence.md#a-claim-that-enumerates-n-facts-needs-n-independent-confirmations); only the scope differs.

### Failure signals

- The deliverable subagent's Evidence Report enumerates only the rule and contract claims the task linked, ignoring rules and contracts the diff actually triggers (for example, a diff that adds tests but omits every applicable `src/.spec/rules/testing/*` claim because the task linked only some of them).
- The deliverable subagent skips a namespace on the grounds that the request or task did not mention it by keyword, even though the diff triggers obligations in that namespace.
- The deliverable subagent's Evidence Report contains rule or contract claims for files the diff does not touch and the task does not link, padding the audit beyond its scope.
- The deliverable subagent narrows the scope so aggressively that an obligation linked by the task is omitted from the Evidence Report because the diff does not touch it — the diff-driven scope is additive on top of the link list, never a replacement.
- The adversarial reviewer bounds its own audit by the worker's diff or by the worker's enumerated claims, instead of auditing the full working tree against every rule and contract that should have applied.
