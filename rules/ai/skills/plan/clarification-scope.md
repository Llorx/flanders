# `/flanders-plan` clarification questions are limited to genuinely unspecified implementation and scope choices

`/flanders-plan` asks the user a clarification question only when the question targets one of two things: an implementation choice in the code the tasks will produce that the request does not specify, or a task-scope ambiguity the planner cannot reasonably infer from the request or from the canonical contracts and rules. Any other question is forbidden, even when it would technically reduce ambiguity. The default posture is silence: when in doubt about anything outside those two categories, the planner picks the most reasonable default and proceeds.

## Who this applies to

- **Subject:** `/flanders-plan` during its clarification phase, on every invocation. The same scope binds any re-entry of the clarification phase triggered by the post-write fix loop per `rules/ai/skills/final-validator-host.md` — a validator FAIL never broadens what `/flanders-plan` is allowed to ask about.
- **Not subject:** `/flanders-spec` — it runs its own clarification phase governed by its own contract.

## Forbidden topics

The planner does not ask the user about any of the following, regardless of how much ambiguity the planner perceives in them:

- The plan file's format, structure, location, filename, or any other property pinned by `contracts/ai-skills/plan-skill.md` or `contracts/shared/plan-file-format.md`.
- The skill's own output, chat messages, summary shape, or any other aspect of its UX.
- Obligations already pinned by any file in the canonical contracts or rules listings captured at invocation. The planner reads those files (per `rules/ai/skills/read-relevant-references-before-drafting.md`) and follows them silently.
- Scope choices the planner can reasonably infer from the request and the canonical references — for example, which existing module a feature naturally extends, which rule namespace a new task naturally falls under, or which obvious default applies when the request is silent on a non-load-bearing detail.

When the planner has a doubt of any of these kinds, it picks the most reasonable default. If the choice is plan-local and load-bearing for a task, the planner documents the choice in the relevant task's description; if the choice is a pure formatting, output, or UX decision, the planner just proceeds without mentioning it.

## Permitted topics

The planner asks the user only when both of the following are true:

1. The decision is genuinely unspecified — neither the request nor any file in the canonical contracts or rules listings fixes the answer.
2. The decision is either:
   - **An implementation choice in the code the tasks will produce** — which approach to take among multiple valid ones, which library or pattern to use, which trade-off to favor; or
   - **A task-scope ambiguity** the planner cannot reasonably infer — for example, "add tests" without naming the module, "refactor the controller" when there are several candidate controllers and the request gives no signal which one.

When this test passes, the question mechanics already pinned in `contracts/ai-skills/plan-skill.md` apply (one question per turn, multiple-choice preferred when the answer space is bounded).

## Failure signals

- The planner asks about the plan file's format, filename, location, output mechanism, or any other property pinned by an existing contract.
- The planner asks about the skill's own chat messages, summary shape, or UX.
- The planner asks the user to confirm an obligation already pinned by the canonical contracts or rules.
- The planner asks a scope question the request and the canonical references already answer (directly or by reasonable inference).
- The planner asks a question whose answer would not change any task's code-level implementation or any task's scope.
- The planner asks the user to choose a "default" for a non-load-bearing detail instead of picking it and moving on.
