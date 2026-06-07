# `/flanders-plan` Skill Contract

## Purpose
Produce a single, ordered, contract-aware work plan that, when implemented, satisfies a user-supplied request without violating any existing contract. The skill runs inside the user's own AI-tool session and writes the plan file directly into the user's project.

## Provisioning
The skill becomes available only after the user runs `npx flanders install` (see `cli-commands/install.md`). The skill is installed for each AI tool the user picked at install time (Claude Code, Codex CLI, or both). The invocation form below is the same regardless of which AI tool the user is invoking it from.

## Invocation
The user invokes the skill from inside an AI-tool session as:

    /flanders-plan [<data>]

The optional `<data>` argument follows the same rule as `/flanders-spec`:
- Omitted: the skill takes the user's natural-language request inline from the conversation.
- Supplied and resolves to an existing file path: read and used as input.
- Supplied and does not resolve to an existing file: used verbatim as inline input.

## Behavior
The skill's sole deliverable is exactly one markdown plan file inside the project's `plans/` folder. The skill must not write, modify, or delete any source code or any file outside `plans/`. The full write-authority obligation that applies to `contracts/`, `rules/`, and `plans/` is pinned in `shared/spec-folder-write-authority.md`.

1. Resolve the input from the invocation rule above.
2. The plan is generated against the state of the project's `contracts/` and `rules/` folders as they exist at invocation. That state is the canonical reference for the run; the plan never references contracts or rules that are not present in it.
3. **Clarification phase.** The skill asks the user clarifying questions only when the question targets either an implementation choice in the code the tasks will produce that the request does not specify, or a task-scope ambiguity the skill cannot reasonably infer from the request or from the canonical contracts and rules. Any other doubt is resolved silently: the skill picks the most reasonable default and proceeds, documenting the choice in the relevant task's description when it is plan-local and load-bearing. Permitted questions are asked sequentially — one question per turn, multiple-choice preferred when the answer space is bounded.

   When the doubt is about how the code should be implemented, the skill resolves it through one of two outcomes:
   - **Cross-cutting convention** — the answer would apply to all future code of the same kind in the project and belongs in `rules/`. The skill surfaces the gap to the user and recommends creating the rule via `/flanders-spec` before the plan is drafted, instead of silently baking the decision into the plan. The user may explicitly elect to treat the decision as plan-local for this run; in that case it follows the plan-local outcome below.
   - **Plan-local implementation choice** — the answer is specific to the requested work and does not generalize. The chosen answer is embedded in the relevant task's description and acceptance criteria, and is never promoted to a rule.

   The skill itself never writes to `rules/` or `contracts/`. Rule creation, when the user elects it, happens through `/flanders-spec` as a separate, user-initiated act.
4. **Drafting phase.** Once the clarification phase is complete, the skill persists the plan file directly without presenting a layout summary, a section-by-section draft, or any other pre-write approval step. The user reviews the written plan file after the fact.
5. After approval, the skill persists exactly one markdown file inside the project's `plans/` folder. The filename is descriptive of the plan's subject, and the file content conforms to `shared/plan-file-format.md`.
6. **Post-write validation.** Before declaring complete, the skill runs the post-write validation gate per `ai-skills/post-write-validation.md`. If the gate fails, the skill follows the triage-then-fix loop defined there — re-entering this contract's clarification phase for any issue that closes a previously-unresolved ambiguity in this contract's clarification scope (the narrower of the two skills'), and fixing the rest in place. If the bounded loop exhausts, the skill does not declare complete and surfaces the final failure along with the plan file path.
7. Upon declaring complete, the skill prints a summary in chat containing:
   - The plan file path.
   - The plan file's character size.
   - The plan file's total line count.
   - The total number of detected tasks.

## Plan content rules
- No task the skill writes may describe work that creates, modifies, deletes, or renames files inside `contracts/`, `rules/`, or `plans/` (with the bounded checkbox/metrics exception that the `implement` command holds, not the worker). The skill's own write boundary and the immovability that applies to the tasks it generates are pinned in `shared/spec-folder-write-authority.md`.
- The persisted plan is free of placeholders, contradictions with existing contracts or rules, ambiguous task wording, missing acceptance criteria on leaf tasks, and missing contract or rule links on leaf tasks.
- The persisted plan is internally self-consistent: its narrative — context, rationale, and any explanatory prose — does not contradict the obligations, verification approach, or any other statement made in its task bodies, and no task contradicts that narrative. Where the prose describes how something is tested or built, it matches what the tasks prescribe.
- The plan only references contracts and rules that exist in the canonical state captured at invocation.
- Tasks are ordered top-to-bottom in the order they must be implemented, accounting for dependencies. A task that depends on another appears after the task it depends on.
- Every leaf task carries a detailed description and explicit acceptance criteria — the conditions that must be true once the task is implemented for it to be considered complete.
- Implementation decisions resolved during the clarification phase and classified as plan-local are embedded in the relevant task's description and acceptance criteria. They are never promoted to a rule.
- Task granularity is chosen so each task is small enough to be tackled by a single AI invocation without burning excessive tokens, and large enough that splitting it further would create artificial fragmentation. When in doubt, a broad task is subdivided.
- Every leaf task links the relevant contract file or files by their listed relative path. When the obligation lives in a specific section or line range, that section or line range is referenced as well.
- Every leaf task links the relevant rule file or files by their listed relative path. When a rule's enforcement is bound to a specific scope, that scope is referenced alongside the file path.
- Tasks are numbered hierarchically (`1`, `1.1`, `1.2`, `2`, `2.1`, ...) per `shared/plan-file-format.md`.
- The plan never violates any contract or rule on the canonical references.

## Output language
The plan file is written in the same natural language as the input request, unless the user says otherwise.

## Missing contracts or rules
If the `contracts/` folder is missing or empty, the skill warns the user in chat and produces a plan that includes whatever contracts the request implicitly requires before any implementation work. If the `rules/` folder is missing or empty, the skill warns the user in chat and proceeds without rule references on the resulting tasks.
