# A deliverable subagent scopes rule and contract claims by its own diff, not by the task's link list

When a deliverable-producing subagent (today the `worker` of `implement`'s inner loop) assembles the rule-claim and contract-claim entries of its Evidence Report per [src/commands/.docs/rules/ai/agents/evidence-report.md](/src/commands/.docs/rules/ai/agents/evidence-report.md), it derives the set of in-scope rules and contracts from the diff its iteration produced — every file the iteration created, modified, deleted, or renamed — not from the subset of rules and contracts the task happens to link. The diff is the authoritative scope. The set is unioned with whatever the task explicitly linked: rules and contracts the task linked stay in scope whether or not the diff touches anything related; the diff-driven scope is additive on top of the link list, never a replacement.

## Who this applies to

- **Subject:** every Flanders-launched subagent whose deliverable is graded PASS/FAIL by an adversarial reviewer. The canonical case today is the `worker` subagent of the `implement` command's inner loop. Any future role with the same shape — produce a deliverable in the working tree, then be reviewed — falls under this rule.
- **Not subject:** the adversarial `reviewer` subagent. Its mandate, pinned in [.docs/contracts/cli-commands/implement/iteration-loop.md](/.docs/contracts/cli-commands/implement/iteration-loop.md) and reinforced in [src/commands/.docs/rules/ai/agents/evidence-report.md](/src/commands/.docs/rules/ai/agents/evidence-report.md), is to audit the full working tree against every rule and contract that should have applied, whether the task linked it or not. The reviewer must not bound its audit by the worker's diff; doing so would defeat the adversarial-review point.
- **Not subject:** the `/flanders-spec` and `/flanders-plan` post-write validators. They grade markdown spec and plan files, not code under test.

## How the scope is derived

For each rule and contract namespace in the global listings the subagent received in its prompt, the subagent walks its own diff and asks: does any obligation in this namespace's files plausibly apply to the kinds of work this diff performs? When the answer is yes for any file in the namespace, every file in that namespace whose obligation could be triggered by the diff becomes an in-scope claim and earns an entry in the Evidence Report. The default when in doubt is to include rather than skip: a namespace omitted on the grounds that the task did not link it is a violation when the diff actually triggers it.

The scope-derivation is namespace-first, the same heuristic the planner uses in [src/prompts/.docs/rules/ai/skills/plan/scope-driven-rule-selection.md](/src/prompts/.docs/rules/ai/skills/plan/scope-driven-rule-selection.md) for picking task links — applied here to a different surface (the worker's actual diff) and for a different purpose (auditing already-written code rather than picking links for a task that has not yet been worked).

## Scope examples

The list below illustrates the pattern and is not exhaustive:

- A diff that **modifies or adds tests** earns in-scope claims for every applicable file under `src/.docs/rules/testing/`.
- A diff that **creates or modifies anything with timers, listeners, controllers, child processes, or other async lifecycle** earns in-scope claims for every applicable file under `src/.docs/rules/disposables/`.
- A diff that **changes terminal UI or live-region output** earns in-scope claims for every applicable file under `src/ui/.docs/rules/`.
- A diff that **adds or modifies retry, backoff, or rate-limit handling around AI or external calls** earns in-scope claims for every applicable file under `src/ai/.docs/rules/retry/`.
- A diff that **changes how the AI runner invokes a CLI tool** earns in-scope claims for every applicable file under `src/ai/.docs/rules/runner/`.
- A diff that **adds or modifies a subagent's prompt construction** earns in-scope claims for every applicable file under `src/commands/.docs/rules/ai/agents/`.
- A diff that **touches any contract obligation** earns in-scope claims for every contract file whose obligation is affected, regardless of whether the task linked it.

When the diff spans multiple kinds of work — for example, "added a new test that exercises a controller with a timer" — the in-scope set is the union across all kinds.

## Why worker-lightweight and reviewer-heavyweight

The deliverable subagent has direct knowledge of its diff: it can enumerate, file by file, what it changed and therefore what scope to audit. Scoping its self-audit to the diff is cheap, accurate, and catches the bulk of weak-evidence patterns before the reviewer runs. The reviewer, in contrast, audits the working tree without prior knowledge of which files the worker touched — its mandate is broader and its check is heavier. The worker's self-audit is the first line of defense; the reviewer's audit is the gate. Both audits use the same claim-evidence framework ([src/commands/.docs/rules/ai/agents/evidence/claim-evidence-classification.md](/src/commands/.docs/rules/ai/agents/evidence/claim-evidence-classification.md) and [src/commands/.docs/rules/ai/agents/evidence/enumerated-claim-coverage.md](/src/commands/.docs/rules/ai/agents/evidence/enumerated-claim-coverage.md)); only the scope differs.

## Failure signals

- The deliverable subagent's Evidence Report enumerates only the rule and contract claims the task linked, ignoring rules and contracts the diff actually triggers (for example, a diff that adds tests but omits every applicable `src/.docs/rules/testing/*` claim because the task linked only some of them).
- The deliverable subagent skips a namespace on the grounds that the request or task did not mention it by keyword, even though the diff triggers obligations in that namespace.
- The deliverable subagent's Evidence Report contains rule or contract claims for files the diff does not touch and the task does not link, padding the audit beyond its scope.
- The deliverable subagent narrows the scope so aggressively that an obligation linked by the task is omitted from the Evidence Report because the diff does not touch it — the diff-driven scope is additive on top of the link list, never a replacement.
- The adversarial reviewer bounds its own audit by the worker's diff or by the worker's enumerated claims, instead of auditing the full working tree against every rule and contract that should have applied.
