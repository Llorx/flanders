# The /flanders-plan validator audits the plan against five categories

The `/flanders-plan` skill gates its work behind a final validator hosted as [src/prompts/.spec/rules/ai/skills/final-validator-host.md](/src/prompts/.spec/rules/ai/skills/final-validator-host.md) pins. This rule pins the five check categories the validator runs against the persisted plan file. Failure in ANY category is FAIL; the validator must run every check on every invocation and must not stop at the first violation.

## Who this applies to

- **Subject:** the `/flanders-plan` skill, as the host that packages the validator's prompt with the five categories enumerated below.
- **Subject (when running as a subagent):** the validator instance, in producing a verdict that audits all five categories independently.
- **Not subject:** the `/flanders-spec` validator — it has its own per-skill rule.

## What the validator receives

The host follows [src/prompts/.spec/rules/ai/skills/final-validator-host.md](/src/prompts/.spec/rules/ai/skills/final-validator-host.md) for the shared inputs (artifact path, canonical listings, output spec, read-only discipline, FAIL loop). On top of those, the host MUST inline the verbatim text of each of the five check categories below in the validator's prompt, and MUST pass the number of leaf task lines it generated, per [src/prompts/.spec/rules/ai/skills/plan/validator-detects-expected-task-count.md](/src/prompts/.spec/rules/ai/skills/plan/validator-detects-expected-task-count.md).

The canonical listings the host passes are:

1. The contracts listing captured at the start of the run (every contract's namespace — its project-root-relative path — across every `.spec/contracts` folder in the tree).
2. The rules listing captured at the start of the run (every rule's namespace across every `.spec/rules` folder in the tree).

Additionally, under the per-skill-inputs provision of [src/prompts/.spec/rules/ai/skills/final-validator-host.md](/src/prompts/.spec/rules/ai/skills/final-validator-host.md), the validator reads the on-disk source files the plan's tasks build on — not only the plan text and the specs — so it can audit each code-touching task against its baseline: the current source, plus the changes earlier tasks in the plan prescribe (per category 4 below). This is what lets categories 4 and 5 catch a task that misdescribes the code it builds on. Reading source is read-only and does not relax the validator's read-only discipline.

## What the validator must check

Five categories, all mandatory; failure in any one is a FAIL. Each category is audited independently and violations are enumerated exhaustively — encountering a violation in one category does not exempt the validator from completing the remaining four.

### 1. Format and shape

Every task line conforms to [.spec/contracts/shared/plan-file-format.md](/.spec/contracts/shared/plan-file-format.md):

- The task line matches the canonical task-line recognizer regex per [src/prompts/.spec/rules/ai/skills/plan/validator-matches-task-line-regex.md](/src/prompts/.spec/rules/ai/skills/plan/validator-matches-task-line-regex.md). The host inlines that exact regex verbatim in the validator's prompt, and the validator confirms every line the plan presents as a task matches it. In particular the line carries the mandatory leading markdown list marker (`-`, `*`, or `+` followed by a space) before the checkbox; a line that begins with `[ ]{...}` without the leading marker is FAIL, because the `implement` command's detector would skip it and treat the plan as having no tasks.
- Valid `[ ]` or `[x]` checkbox (no malformed variants such as `[]`, `[ x]`, or `[X ]`).
- Immediately-following metrics object literally equal to `{"it":0,"ot":0,"t":0}` for freshly-generated tasks. The check is byte-exact: no extra spaces, no reordered keys, no trailing commas.
- A single space between the closing `}` and the task number, and a single space between the task number and the title.
- Hierarchical task number coherent with document position (`1` before `2`, `1.1` before `1.2`, no malformed numbering).
- Leaf-vs-parent distinction respected: leaves carry checkbox and metrics; parents carry neither.
- Each leaf task carries a description and an explicit acceptance-criteria section.
- The number of task lines the validator detects via the canonical recognizer equals the expected leaf-task count the host passes, per [src/prompts/.spec/rules/ai/skills/plan/validator-detects-expected-task-count.md](/src/prompts/.spec/rules/ai/skills/plan/validator-detects-expected-task-count.md). A detected count that differs from the expected count in either direction is FAIL.

Additionally, the plan file lives inside `plans/`, is non-empty, and contains at least one task line.

### 2. Semantic dependency order

Tasks appear top-to-bottom in implementation order. The audit is semantic, not numeric: read each task's description and acceptance criteria and confirm that no task depends on work performed by a task that appears later in the document. A plan whose numbering is well-formed but whose dependencies flow upward is FAIL.

### 3. Spec-folder write boundary

No task — leaf or parent — describes work that creates, modifies, deletes, or renames any file inside any `.spec/contracts` folder, any `.spec/rules` folder, or the `plans/` folder. There is no exception for flipping checkboxes or rewriting metrics: those mutations are performed programmatically by the `implement` command and are never described by a task.

### 4. Plan content rules (verbatim from [.spec/contracts/ai-skills/plan-skill.md](/.spec/contracts/ai-skills/plan-skill.md))

Verify that the plan satisfies EACH of the following obligations, independently. The host inlines this list verbatim in the validator's prompt; the validator audits each item as its own check and enumerates violations by name plus the offending file:line.

- **Free of placeholders.** No `<TBD>`, no `TODO`, no `XXX`, no template-style blanks, no parenthetical "(to be decided)".
- **Free of contradictions with existing contracts or rules.** No task pins behavior the canonical listings forbid.
- **Internally self-consistent — no contradiction between the plan's narrative and its tasks.** The plan's context, rationale, and explanatory prose do not contradict the obligations, verification approach, or any other statement in its task bodies, and no task contradicts that narrative. Where the prose describes how something is tested or built, it matches what the tasks prescribe. The validator reads the full file — narrative sections and every task body — and FAIL names the contradicting section/line on each side.
- **Free of ambiguous task wording.** Open-ended decisions deferred to the implementer are FAIL. This includes, non-exhaustively, hedge phrases such as: `(or class)`, `(or function)`, `(or refactor in place if preferred)`, `pick the lower-friction option`, `pick the X that minimizes Y`, `suggested location`, `or — alternatively —`, `or — equivalently —`, `or equivalent`, `at the time of implementation`, `if the X exists, do Y; otherwise Z`, `either A or B — pick one`, `A or B (or some hybrid)`, `or, more strongly`, `or X if Y`. An implementation choice that the request did not specify must be either (a) closed to a single concrete value in the task's description and acceptance criteria, or (b) escalated by the skill to the user before the plan was drafted — never left open for the worker to resolve.
- **Every leaf task carries an explicit acceptance-criteria section.** A leaf without acceptance criteria is FAIL.
- **Every leaf task carries the relevant contract link(s)** as markdown links per [.spec/contracts/shared/cross-file-reference-links.md](/.spec/contracts/shared/cross-file-reference-links.md). When the obligation lives in a specific section or line range, that section or range is referenced as well.
- **Every leaf task carries the relevant rule link(s)** as markdown links per [.spec/contracts/shared/cross-file-reference-links.md](/.spec/contracts/shared/cross-file-reference-links.md). When a rule's enforcement is bound to a specific scope, that scope is referenced alongside the file path.
- **The plan only references contracts and rules that exist in the canonical state captured at invocation.** Out of scope of the validator: verifying that the referenced paths physically resolve on disk; that is the skill's pre-validator responsibility.
- **Tasks are numbered hierarchically** per [.spec/contracts/shared/plan-file-format.md](/.spec/contracts/shared/plan-file-format.md).
- **Task granularity is sane.** A leaf task is not so broad that it would need to be split into separate AI invocations, and not so narrow that splitting further would create artificial fragmentation.
- **Each code-touching task's claims about the code it builds on are accurate.** Audit each task against its baseline — the current on-disk source, plus the changes any earlier task in the plan it depends on prescribes. A task that names a function, type, field, file, or behavior that neither the source nor any earlier task in the plan provides, or that removes or rewrites code on a mistaken account of what it does, is FAIL. Do NOT FAIL a task merely for describing code the current on-disk source lacks when an earlier task in the plan introduces it — confirm instead that the depended-on task is ordered first, per category 2. Changing the code's behavior is the task's purpose and is not itself a violation — only a false claim about the code the task builds on is. Per [src/prompts/.spec/rules/ai/skills/plan/tasks-consistent-with-the-code-they-build-on.md](/src/prompts/.spec/rules/ai/skills/plan/tasks-consistent-with-the-code-they-build-on.md).
- **Runtime-behavior premises are backed or escalated.** A task whose approach depends on a runtime- or observable-behavior claim not confirmable from the source — and that no contract, rule, existing test, or preceding task in the plan backs, and that was not escalated to the user — is FAIL. This explicitly includes a task that removes, weakens, or replaces existing code on the strength of such an unbacked claim. Per [src/prompts/.spec/rules/ai/skills/plan/runtime-premise-backed-or-escalated.md](/src/prompts/.spec/rules/ai/skills/plan/runtime-premise-backed-or-escalated.md).

### 5. Active application of referenced contracts and rules

For every contract and rule referenced by any task in the plan, verify that the task's description and acceptance criteria actually require or honor the obligations of that reference. A task that lists a contract or rule link without the description or acceptance criteria invoking the obligation is FAIL — this is the analogue of the adversarial reviewer's condition 3 in [.spec/contracts/cli-commands/implement/iteration-loop.md](/.spec/contracts/cli-commands/implement/iteration-loop.md).

Additionally, for every contract or rule in the canonical listings the validator judges should have been linked by a task whose scope makes it applicable, but was not linked, the missing link is FAIL — analogous to the reviewer's condition 4. Apply scope-driven selection per [src/prompts/.spec/rules/ai/skills/plan/scope-driven-rule-selection.md](/src/prompts/.spec/rules/ai/skills/plan/scope-driven-rule-selection.md): a task that touches tests must link the applicable testing rules; a task that touches async lifecycle must link the applicable disposables rules; a task that changes terminal UI must link the applicable UI rules; and so on across every rule namespace whose scope could plausibly apply.

## Failure signals

- The validator reports PASS on a plan whose tasks describe writing to any `.spec/contracts` folder, any `.spec/rules` folder, or the `plans/` folder (including checkbox flips or metrics rewrites).
- The validator reports PASS on a plan in which a task depends on work performed by a later task, on the grounds that the numbering looks correct.
- The validator reports PASS on a plan that contains hedge phrasing or unresolved implementation choices, on the grounds that "the worker will figure it out".
- The validator reports PASS on a plan with a leaf task missing its acceptance criteria, its contract link, or its rule link.
- The validator reports PASS on a plan that links a contract or rule without the task's description or acceptance criteria actually applying the obligation.
- The validator reports PASS on a plan whose narrative — its Context or rationale prose — states a verification approach or obligation that a task body contradicts; for example, prose stating an outcome can only be confirmed manually while a task adds an automated test that confirms it.
- The validator reports PASS on a task that references source structure or behavior the actual code does not have, or that removes or rewrites code on a mistaken account of what it does, because the plan text alone reads coherently — the validator audited the plan without reading the source.
- The validator reports PASS on a task that rests on an untested runtime-behavior premise with no backing contract, rule, existing test, or preceding task and no escalation to the user — including a task that deletes existing code on the strength of such a premise.
- The validator reports PASS on a plan whose detected task count differs from the expected count the host supplied — a generated task was silently lost to a recognition failure, or a non-task line was counted as a task.
- The validator aggregates the five categories into a single judgment instead of auditing each independently and enumerating violations exhaustively.
- The host packages the validator prompt without inlining the verbatim text of categories 4 and 5, forcing the validator to discover them by reading the contract — which defeats the explicit-categories obligation pinned in [src/prompts/.spec/rules/ai/skills/final-validator-host.md](/src/prompts/.spec/rules/ai/skills/final-validator-host.md).
