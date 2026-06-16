# Every Flanders adversarial reviewer prompt enumerates the same FAIL conditions and demands exhaustive enumeration

Every Flanders adversarial reviewer prompt instructs the reviewer to look adversarially for why the changes under review FAIL, against a fixed set of FAIL conditions, and to enumerate every violation it finds rather than stopping at the first. This is the review methodology shared across Flanders' reviewers; what differs per surface is the spec the reviewer measures the work against, not the conditions or the exhaustiveness discipline.

## Who this applies to

- **Subject:** the construction of every Flanders adversarial reviewer prompt — the `implement` command's reviewer(s) (see [.docs/contracts/cli-commands/implement/iteration-loop.md](/.docs/contracts/cli-commands/implement/iteration-loop.md)) and the `/flanders-work` skill's reviewer subagent (see [.docs/contracts/ai-skills/work-skill.md](/.docs/contracts/ai-skills/work-skill.md)). The spec under review is the plan task and its acceptance criteria for `implement`, and the user's request for `/flanders-work`.
- **Not subject:** the worker, the prep agent, the build/test detection agent, and the content-skill final validators (`/flanders-spec`, `/flanders-plan`), whose gate is governed by [src/prompts/.docs/rules/ai/skills/final-validator-host.md](/src/prompts/.docs/rules/ai/skills/final-validator-host.md).

## Behavior

The reviewer prompt instructs the reviewer to FAIL on ANY of the following five conditions; a violation of any one is a FAIL:

1. The spec under review is not satisfied.
2. A contract referenced by the work is not honored.
3. A rule referenced by the work is not actively applied — acknowledging a rule is not enough; the changes must demonstrate compliance.
4. A contract or rule from the project's spec corpus that the reviewer determines should have applied to the changes but was not honored, even if the spec under review did not reference it.
5. A behavior rule whose `.spec/flanders` scope encloses the files the changes touch is not honored, even if the spec under review did not reference it.

The prompt also imposes:

- **Exhaustiveness.** The reviewer runs every verification it is required to run and every additional check its judgment deems applicable, and does not stop when the first violation is discovered. The five conditions above and the spec-verification protocol below are executed in full on every invocation; encountering a violation in one does not exempt the reviewer from completing the rest. The goal is that a single review produces the complete list of fixes the next round of work needs.
- **Pattern occurrence enumeration.** When a violation is an instance of a pattern, the reviewer enumerates every occurrence of that pattern across the file and every other file in the same module or suite where it could recur, each as its own independently-actionable entry with its `file:line`. A FAIL that cites only a subset of a pattern's occurrences is itself a failure of this rule.
- **Spec-verification protocol.** Before deciding the work satisfies the spec under review, the reviewer enumerates every element of that spec as a separate item and classifies each by the regression-signal question of [src/commands/.docs/rules/ai/agents/evidence/claim-evidence-classification.md](/src/commands/.docs/rules/ai/agents/evidence/claim-evidence-classification.md), confirming the changes carry evidence of the type that classification requires. A spec element lacking that evidence is a violation. A spec element that enumerates N independent facts expands into N items per [src/commands/.docs/rules/ai/agents/evidence/enumerated-claim-coverage.md](/src/commands/.docs/rules/ai/agents/evidence/enumerated-claim-coverage.md).

How the reviewer records the violations it finds is pinned by [src/prompts/.docs/rules/ai/review/reviewer-records-verdict-via-error-log.md](/src/prompts/.docs/rules/ai/review/reviewer-records-verdict-via-error-log.md).

## Why

The reviewer's value is the completeness of the fix list it produces. A reviewer that stops at the first violation, or that cites one occurrence of a recurring pattern, forces each subsequent round of work to rediscover the rest one at a time, multiplying iterations. Fixing the FAIL conditions in one shared place keeps every Flanders reviewer measuring the same five failure modes, so the only thing a surface specializes is the spec it holds the work to.

## Failure signals

- A reviewer prompt omits one of the five FAIL conditions, or narrows the corpus-wide conditions 4 and 5 to only the contracts, rules, or behavior rules the spec under review explicitly references.
- A reviewer prompt instructs the reviewer to stop at the first violation, or does not require enumerating every occurrence of a recurring pattern.
- A reviewer prompt drops the spec-verification protocol, letting the reviewer pass the work on "the code looks right" without classifying each spec element and confirming regression-detecting evidence.
- A reviewer prompt is constructed per surface with its own divergent FAIL conditions instead of building on this shared set.
