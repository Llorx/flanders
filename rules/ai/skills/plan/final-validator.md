# The /flanders-plan validator audits the plan against five categories

The `/flanders-plan` skill gates its work behind a final validator hosted as `rules/ai/skills/final-validator-host.md` pins. This rule pins the five check categories the validator runs against the persisted plan file. Failure in ANY category is FAIL; the validator must run every check on every invocation and must not stop at the first violation.

## Who this applies to

- **Subject:** the `/flanders-plan` skill, as the host that packages the validator's prompt with the five categories enumerated below.
- **Subject (when running as a subagent):** the validator instance, in producing a verdict that audits all five categories independently.
- **Not subject:** the `/flanders-spec` validator — it has its own per-skill rule.

## What the validator receives

The host follows `rules/ai/skills/final-validator-host.md` for the shared inputs (artifact path, canonical listings, output spec, read-only discipline, FAIL loop). On top of those, the host MUST inline the verbatim text of each of the five check categories below in the validator's prompt.

The canonical listings the host passes are:

1. The contracts listing captured at the start of the run (every relative path under `contracts/`).
2. The rules listing captured at the start of the run (every relative path under `rules/`).

## What the validator must check

Five categories, all mandatory; failure in any one is a FAIL. Each category is audited independently and violations are enumerated exhaustively — encountering a violation in one category does not exempt the validator from completing the remaining four.

### 1. Format and shape

Every task line conforms to `contracts/shared/plan-file-format.md`:

- Valid `[ ]` or `[x]` checkbox (no malformed variants such as `[]`, `[ x]`, or `[X ]`).
- Immediately-following metrics object literally equal to `{"it":0,"ot":0,"t":0}` for freshly-generated tasks. The check is byte-exact: no extra spaces, no reordered keys, no trailing commas.
- A single space between the closing `}` and the task number, and a single space between the task number and the title.
- Hierarchical task number coherent with document position (`1` before `2`, `1.1` before `1.2`, no malformed numbering).
- Leaf-vs-parent distinction respected: leaves carry checkbox and metrics; parents carry neither.
- Each leaf task carries a description and an explicit acceptance-criteria section.

Additionally, the plan file lives inside `plans/`, is non-empty, and contains at least one task line.

### 2. Semantic dependency order

Tasks appear top-to-bottom in implementation order. The audit is semantic, not numeric: read each task's description and acceptance criteria and confirm that no task depends on work performed by a task that appears later in the document. A plan whose numbering is well-formed but whose dependencies flow upward is FAIL.

### 3. Spec-folder write boundary

No task — leaf or parent — describes work that creates, modifies, deletes, or renames any file inside `contracts/`, `rules/`, or `plans/`. There is no exception for flipping checkboxes or rewriting metrics: those mutations are performed programmatically by the `implement` command and are never described by a task.

### 4. Plan content rules (verbatim from `contracts/ai-skills/plan-skill.md`)

Verify that the plan satisfies EACH of the following obligations, independently. The host inlines this list verbatim in the validator's prompt; the validator audits each item as its own check and enumerates violations by name plus the offending file:line.

- **Free of placeholders.** No `<TBD>`, no `TODO`, no `XXX`, no template-style blanks, no parenthetical "(to be decided)".
- **Free of contradictions with existing contracts or rules.** No task pins behavior the canonical listings forbid.
- **Free of ambiguous task wording.** Open-ended decisions deferred to the implementer are FAIL. This includes, non-exhaustively, hedge phrases such as: `(or class)`, `(or function)`, `(or refactor in place if preferred)`, `pick the lower-friction option`, `pick the X that minimizes Y`, `suggested location`, `or — alternatively —`, `or — equivalently —`, `or equivalent`, `at the time of implementation`, `if the X exists, do Y; otherwise Z`, `either A or B — pick one`, `A or B (or some hybrid)`, `or, more strongly`, `or X if Y`. An implementation choice that the request did not specify must be either (a) closed to a single concrete value in the task's description and acceptance criteria, or (b) escalated by the skill to the user before the plan was drafted — never left open for the worker to resolve.
- **Every leaf task carries an explicit acceptance-criteria section.** A leaf without acceptance criteria is FAIL.
- **Every leaf task carries the relevant contract link(s)** by their listed relative path. When the obligation lives in a specific section or line range, that section or range is referenced as well.
- **Every leaf task carries the relevant rule link(s)** by their listed relative path. When a rule's enforcement is bound to a specific scope, that scope is referenced alongside the file path.
- **The plan only references contracts and rules that exist in the canonical state captured at invocation.** Out of scope of the validator: verifying that the referenced paths physically resolve on disk; that is the skill's pre-validator responsibility.
- **Tasks are numbered hierarchically** per `contracts/shared/plan-file-format.md`.
- **Task granularity is sane.** A leaf task is not so broad that it would need to be split into separate AI invocations, and not so narrow that splitting further would create artificial fragmentation.

### 5. Active application of referenced contracts and rules

For every contract and rule referenced by any task in the plan, verify that the task's description and acceptance criteria actually require or honor the obligations of that reference. A task that lists a contract or rule link without the description or acceptance criteria invoking the obligation is FAIL — this is the analogue of the adversarial reviewer's condition 3 in `contracts/cli-commands/implement/iteration-loop.md`.

Additionally, for every contract or rule in the canonical listings the validator judges should have been linked by a task whose scope makes it applicable, but was not linked, the missing link is FAIL — analogous to the reviewer's condition 4. Apply scope-driven selection per `rules/ai/skills/plan/scope-driven-rule-selection.md`: a task that touches tests must link applicable files under `rules/testing/*`; a task that touches async lifecycle must link applicable files under `rules/disposables/*`; a task that changes terminal UI must link applicable files under `rules/ui/*`; and so on across every namespace whose scope could plausibly apply.

## Failure signals

- The validator reports PASS on a plan whose tasks describe writing to `contracts/`, `rules/`, or `plans/` (including checkbox flips or metrics rewrites).
- The validator reports PASS on a plan in which a task depends on work performed by a later task, on the grounds that the numbering looks correct.
- The validator reports PASS on a plan that contains hedge phrasing or unresolved implementation choices, on the grounds that "the worker will figure it out".
- The validator reports PASS on a plan with a leaf task missing its acceptance criteria, its contract link, or its rule link.
- The validator reports PASS on a plan that links a contract or rule without the task's description or acceptance criteria actually applying the obligation.
- The validator aggregates the five categories into a single judgment instead of auditing each independently and enumerating violations exhaustively.
- The host packages the validator prompt without inlining the verbatim text of categories 4 and 5, forcing the validator to discover them by reading the contract — which defeats the explicit-categories obligation pinned in `rules/ai/skills/final-validator-host.md`.
