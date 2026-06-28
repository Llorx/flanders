# /flanders-plan skill rules

## `/flanders-plan` clarification questions are limited to genuinely unsettled implementation choices, scope ambiguities, and unbacked runtime premises

`/flanders-plan` asks the user a clarification question only when the question targets one of three things: an implementation choice in the code the tasks will produce that the request does not specify; a task-scope ambiguity the planner cannot reasonably infer from the request or from the canonical contracts and rules; or a load-bearing runtime-behavior premise the plan would otherwise have to assert without backing, per [src/prompts/.spec/rules/ai/skills/plan.md#flanders-plan-backs-or-escalates-a-runtime-behavior-premise-instead-of-asserting-it-as-fact](/src/prompts/.spec/rules/ai/skills/plan.md#flanders-plan-backs-or-escalates-a-runtime-behavior-premise-instead-of-asserting-it-as-fact). Any other question is forbidden, even when it would technically reduce ambiguity. The default posture is silence: when in doubt about anything outside those three categories, the planner picks the most reasonable default and proceeds.

### Who this applies to

- **Subject:** `/flanders-plan` during its clarification phase, on every invocation. The same scope binds any re-entry of the clarification phase triggered by the post-write fix loop per [src/prompts/.spec/rules/ai/skills/skills-common.md#every-flanders-content-skill-hosts-its-final-validator-the-same-way](/src/prompts/.spec/rules/ai/skills/skills-common.md#every-flanders-content-skill-hosts-its-final-validator-the-same-way) — a validator FAIL never broadens what `/flanders-plan` is allowed to ask about.
- **Not subject:** `/flanders-spec` — it runs its own clarification phase governed by its own contract.

### Forbidden topics

The planner does not ask the user about any of the following, regardless of how much ambiguity the planner perceives in them:

- The plan file's format, structure, location, filename, or any other property pinned by [.spec/contracts/ai-skills/plan-skill.md](/.spec/contracts/ai-skills/plan-skill.md) or [.spec/contracts/shared/plan-file-format.md](/.spec/contracts/shared/plan-file-format.md).
- The skill's own output, chat messages, summary shape, or any other aspect of its UX.
- Obligations already pinned by any file in the canonical contracts or rules listings captured at invocation. The planner reads those files (per [src/prompts/.spec/rules/ai/skills/skills-common.md#skills-read-relevant-references-before-drafting](/src/prompts/.spec/rules/ai/skills/skills-common.md#skills-read-relevant-references-before-drafting)) and follows them silently.
- Scope choices the planner can reasonably infer from the request and the canonical references — for example, which existing module a feature naturally extends, which rule namespace a new task naturally falls under, or which obvious default applies when the request is silent on a non-load-bearing detail.
- A choice that affects only how a task's work is carried out internally, with no effect on any observable outcome its acceptance criteria pin — the planner leaves it for the implementer to resolve against the real code rather than asking the user or fixing it in the task.

When the planner has a doubt of any of these kinds, it picks the most reasonable default. If the choice is plan-local and load-bearing for a task, the planner documents the choice in the relevant task's description; if the choice is a pure formatting, output, or UX decision, the planner just proceeds without mentioning it.

### Permitted topics

The planner asks the user only when both of the following are true:

1. The decision is genuinely unsettled — nothing the planner is bound to follow fixes or backs the answer: not the request, not any file in the canonical contracts or rules listings, and (for a runtime-behavior premise) no existing test or earlier task in the plan.
2. The decision is one of:
   - **An implementation choice that shapes a task's observable outcome** — which approach among several that would produce observably different results, or a trade-off the request leaves genuinely unsettled that the acceptance criteria must commit to. A choice that affects only how the work is carried out internally, with no effect on any observable outcome, is not escalated: it is left for the implementer to resolve against the real code; or
   - **A task-scope ambiguity** the planner cannot reasonably infer — for example, "add tests" without naming the module, "refactor the controller" when there are several candidate controllers and the request gives no signal which one; or
   - **A load-bearing runtime-behavior premise without backing** — a claim about how the terminal, the OS, a library, or the execution environment behaves at run time, which a task's approach depends on, which cannot be confirmed by reading the source, and which no existing contract, rule, existing test, or preceding task in the plan backs (per [src/prompts/.spec/rules/ai/skills/plan.md#flanders-plan-backs-or-escalates-a-runtime-behavior-premise-instead-of-asserting-it-as-fact](/src/prompts/.spec/rules/ai/skills/plan.md#flanders-plan-backs-or-escalates-a-runtime-behavior-premise-instead-of-asserting-it-as-fact)). The planner escalates the premise rather than asserting it as fact.

When this test passes, the question mechanics already pinned in [.spec/contracts/ai-skills/plan-skill.md](/.spec/contracts/ai-skills/plan-skill.md) apply (one question per turn, multiple-choice preferred when the answer space is bounded).

### Failure signals

- The planner asks about the plan file's format, filename, location, output mechanism, or any other property pinned by an existing contract.
- The planner asks about the skill's own chat messages, summary shape, or UX.
- The planner asks the user to confirm an obligation already pinned by the canonical contracts or rules.
- The planner asks a scope question the request and the canonical references already answer (directly or by reasonable inference).
- The planner asks a question whose answer would not change any task's code-level implementation or any task's scope.
- The planner asks the user to choose a "default" for a non-load-bearing detail instead of picking it and moving on.
- The planner escalates, or pins in a task, a purely internal mechanism choice that changes no observable outcome, instead of leaving it for the implementer to resolve against the real code.

## `/flanders-plan` selects rule links by scope, not by topic

When `/flanders-plan` picks which rule files to link to each leaf task, the selection is driven by the scope of the work the task actually performs, not by surface-level topic matching against the user's request. The planner walks the rule namespaces captured at invocation and links every file whose obligation could be triggered by the task. Under-linking is a violation: the downstream adversarial reviewer FAILs the worker for any global rule that should have applied but was not applied, so when in doubt the planner links rather than omits.

### Who this applies to

- **Subject:** `/flanders-plan`, when filling in the rule-link section of every leaf task during the drafting phase. The obligation applies to every invocation of the skill, on every leaf task in the plan.
- **Not subject:** other skills and commands. Workers, reviewers, and validators consume the links the planner produced; they do not redo the selection.

### How the selection works

For each leaf task, the planner performs the following:

1. Identify the kinds of work the task performs — for example, "adds a test", "creates a timer", "changes terminal output", "adds a new module", "modifies a controller's lifecycle", "adds retry handling around an AI call".
2. For each kind of work, walk the rule namespaces in the canonical rule listing captured at invocation and ask: which namespaces are in scope for work of this kind? The listing spans every `.spec/rules` folder in the project tree per [src/workspace/.spec/rules/spec-discovery.md#the-spec-corpus-is-enumerated-by-recursive-discovery-of-spec-folders](/src/workspace/.spec/rules/spec-discovery.md#the-spec-corpus-is-enumerated-by-recursive-discovery-of-spec-folders), and a namespace is a rule's project-root-relative path. A namespace is in scope when any of its obligations could plausibly be triggered by the task — not only when the namespace name keyword-matches the request.
3. Inside every in-scope namespace, inspect every file and link every file whose obligation could be triggered by the task. The default is to link; omission requires the planner to have read the file and concluded that none of its obligations apply.

The selection is namespace-first, not keyword-first. A request that says "add a timer" without mentioning disposables still requires linking every applicable file under `src/.spec/rules/disposables/`, because the scope of the task — adding a timer — triggers that namespace regardless of the request's wording.

### Scope examples

The list below illustrates the pattern and is not exhaustive:

- A task that **modifies or adds tests** links every applicable file under `src/.spec/rules/testing/`.
- A task that **creates or modifies anything with timers, listeners, controllers, child processes, or other async lifecycle** links every applicable file under `src/.spec/rules/disposables/`.
- A task that **changes terminal UI or live-region output** links every applicable file under `src/ui/.spec/rules/`.
- A task that **adds or modifies retry, backoff, or rate-limit handling around AI or external calls** links every applicable file under `src/ai/.spec/rules/retry/`.
- A task that **adds or modifies how task context reaches the worker or reviewer** (in-prompt injection, session resume) links every applicable file under `src/commands/.spec/rules/ai/task-context/`.
- A task that **adds or modifies how the AI runner invokes a CLI tool** (binary, flags, stdin, JSON event consumption) links every applicable file under `src/ai/.spec/rules/runner/`.
- A task that **spawns or modifies a subagent's behavior** links every applicable file under `src/commands/.spec/rules/ai/agents/`.
- A task that **adds or modifies anything inside a Flanders skill's own pipeline** links every applicable file under `src/prompts/.spec/rules/ai/skills/`.

When a task spans multiple kinds of work — for example, "add a new test that exercises a controller with a timer" — the planner unions the in-scope namespaces from each kind and links every applicable file across all of them.

### Failure signals

- A leaf task touches tests but does not link the relevant files under `src/.spec/rules/testing/`.
- A leaf task introduces a timer, listener, controller, child process, or other async lifecycle but does not link the relevant files under `src/.spec/rules/disposables/`.
- A leaf task changes terminal UI or live-region output but does not link the relevant files under `src/ui/.spec/rules/`.
- The planner skips a namespace on the grounds that the request did not mention it by keyword, even though the task's scope plausibly triggers obligations in that namespace.
- The planner selects only the first or "most obvious" file in an in-scope namespace and omits other files in the same namespace whose obligations also apply.
- The planner links a single namespace for a task whose scope unions multiple kinds of work, instead of linking every applicable file across all in-scope namespaces.

## `/flanders-plan` grounds every code-touching task in the code it builds on

A code-touching task states facts about the code it builds on — what exists, what that code does, and why — to justify what the task will create, change, or remove. `/flanders-plan` grounds those facts in the real state that code will be in when the task runs, never in assumption or memory. Changing what the code does is the task's purpose and is expected; what a task may not do is misstate the code it starts from — name a function, type, field, file, or behavior that code does not and will not have, claim it works differently than it does, or remove or rewrite code on a mistaken account of what it is for. A task built on a false account of its starting code is invalid, however internally coherent it reads.

### The state a task is grounded in

The code a task builds on is the code as the tasks before it leave it: the current source, plus the changes every earlier task it depends on prescribes. How the planner establishes that state depends on whether the code already exists:

- **Code that already exists and no earlier task changes** — the planner establishes its reality by reading the current on-disk source. Reading the canonical contracts and rules listings does not substitute for this: those state what the software must do, not what the code does today.
- **Code an earlier task in the plan creates or changes** — that code does not exist on disk yet, so the planner grounds the task in what the earlier task is specified to produce: its description and acceptance criteria. The earlier task must appear before this one in the plan.

Either way, the planner establishes the real starting state before writing the task — reading the source for code that exists, and consulting the producing task for code an earlier task will introduce — rather than drafting from assumption.

A claim that the starting code neither shows nor can show — a claim about how something behaves only at execution time — is out of this rule's scope and is governed by [src/prompts/.spec/rules/ai/skills/plan.md#flanders-plan-backs-or-escalates-a-runtime-behavior-premise-instead-of-asserting-it-as-fact](/src/prompts/.spec/rules/ai/skills/plan.md#flanders-plan-backs-or-escalates-a-runtime-behavior-premise-instead-of-asserting-it-as-fact).

### Who this applies to

- **Subject:** `/flanders-plan` during its drafting phase, for every leaf task that creates, modifies, or removes source code. The obligation also binds any re-entry of drafting triggered by the post-write fix loop.
- **Not subject:** `/flanders-spec`, which writes behavior specs rather than code-touching tasks. Workers and reviewers are governed by their own rules; the plan validator's audit of each task against the code it builds on is pinned in [src/prompts/.spec/rules/ai/skills/plan.md#the-flanders-plan-validator-audits-the-plan-against-five-categories](/src/prompts/.spec/rules/ai/skills/plan.md#the-flanders-plan-validator-audits-the-plan-against-five-categories).

### Failure signals

- A task names a function, type, field, file, or behavior that neither the code it builds on contains nor any earlier task in the plan produces.
- A task removes or rewrites code on an account of what that code does or is for that its starting state contradicts.
- The planner drafts a code-touching task without establishing the real state of the code it builds on — neither reading the existing source nor consulting the earlier task that produces it.
- A task that depends on an earlier task's change is written against the stale current source instead of what that earlier task is specified to produce.
- A task's acceptance criteria describe an end state that is impossible or incoherent given the surrounding code the task does not change.

## `/flanders-plan` pins each task's observable outcome and leaves the internal mechanism to the implementer

A leaf task's acceptance criteria pin its observable outcome — the behavior the result must exhibit through the surface a reader or a test can inspect — precisely enough that any two implementations satisfying them are observably equivalent. An outcome the request leaves open is closed to a single observable commitment in the acceptance criteria, or escalated to the user during the clarification phase per [src/prompts/.spec/rules/ai/skills/plan.md#flanders-plan-clarification-questions-are-limited-to-genuinely-unsettled-implementation-choices-scope-ambiguities-and-unbacked-runtime-premises](/src/prompts/.spec/rules/ai/skills/plan.md#flanders-plan-clarification-questions-are-limited-to-genuinely-unsettled-implementation-choices-scope-ambiguities-and-unbacked-runtime-premises) when it is genuinely unsettled; it is never left for the worker to resolve. `/flanders-plan` does not dictate a task's internal mechanism beyond what an observable acceptance criterion or an explicitly required architectural property demands. A choice that affects only how the work is carried out — which existing helper to reuse, which internal structure to adopt, how the code and its tests are organized across files and modules, which implementation approach to take — and that changes no observable outcome the acceptance criteria pin, is left for the implementer to resolve against the real code at implementation time: the planner neither fixes it in the task nor escalates it to the user.

Leaving such a choice open serves the plan better than freezing it, because the worker reads the actual code as it implements while the planner reasons about that code from a distance. A frozen internal mechanism encodes the planner's assumptions about the code — assumptions a task's observable acceptance criteria do not need, and which, when mistaken, can make those acceptance criteria impossible to satisfy without breaking the frozen mechanism. When the planner genuinely needs a structural property — a single source for some logic, the absence of duplication, a module boundary — it states that property as a required outcome the acceptance criteria assert ("the shape check has a single source"), rather than freezing a specific internal mechanism — a code element to reuse or leave untouched ("reuse the X helper unchanged"), or the file or module its code or tests are placed in ("put the tests in X"). Stated as an outcome, the property is verifiable and leaves the worker free to realize it against the real code.

### Who this applies to

- **Subject:** `/flanders-plan` during its drafting phase, on every leaf task. The obligation also binds any re-entry of drafting triggered by the post-write fix loop. It binds both halves at once: the acceptance criteria pin the observable outcome, and the task body refrains from dictating an internal mechanism that no observable outcome and no explicitly required architectural property needs.
- **Not subject:** `/flanders-spec`. Workers and reviewers consume the plan under their own rules; the plan validator's audit of this obligation is pinned in [src/prompts/.spec/rules/ai/skills/plan.md#the-flanders-plan-validator-audits-the-plan-against-five-categories](/src/prompts/.spec/rules/ai/skills/plan.md#the-flanders-plan-validator-audits-the-plan-against-five-categories).

### Failure signals

- A leaf task's acceptance criteria leave its observable outcome ambiguous — satisfiable by implementations that differ in observable behavior — or defer the outcome to the worker with hedge wording, instead of pinning a single observable commitment or escalating the genuinely unsettled choice.
- A task fixes an internal mechanism — names a specific helper to reuse, a function, type, or file to leave untouched, code to treat as out of scope, or the files and modules its code and tests are organized into — that no observable acceptance criterion and no explicitly required architectural property needs.
- The planner escalates to the user, or pins in the task, a purely internal mechanism choice that changes no observable outcome, instead of leaving it for the implementer to resolve against the real code.
- The planner needs a structural property — a single source, the absence of duplication, a module boundary — and freezes a specific code element to achieve it instead of stating the property as a required outcome the acceptance criteria assert.

## `/flanders-plan` backs or escalates a runtime-behavior premise instead of asserting it as fact

When the correctness or justification of a task depends on a claim about runtime or observable behavior — how the terminal, the operating system, a library, or the execution environment behaves when the code runs — and that claim cannot be confirmed by reading the source, `/flanders-plan` does not state the claim as settled fact in the plan. Such a claim is load-bearing precisely because a task's approach — what it adds, changes, or removes — rests on it: if the claim is false, the task is wrong. The planner cannot run the code, so it must not present the claim as if it had been verified.

The planner resolves such a premise in one of two ways:

- **Back it.** The premise is admissible as fact only when one of the following already establishes it:
  1. an existing contract or rule that pins the behavior,
  2. an existing test that proves the behavior, or
  3. a preceding task in the same plan that establishes the behavior executably (for example, a test that demonstrates it), placed before the task that depends on it.
- **Escalate it.** When no such backing exists, the planner raises the premise to the user during the clarification phase rather than assuming it, per [src/prompts/.spec/rules/ai/skills/plan.md#flanders-plan-clarification-questions-are-limited-to-genuinely-unsettled-implementation-choices-scope-ambiguities-and-unbacked-runtime-premises](/src/prompts/.spec/rules/ai/skills/plan.md#flanders-plan-clarification-questions-are-limited-to-genuinely-unsettled-implementation-choices-scope-ambiguities-and-unbacked-runtime-premises).

A task may not rest its approach — and in particular may not remove, weaken, or replace existing code — on a runtime-behavior premise that is neither backed nor escalated.

### Who this applies to

- **Subject:** `/flanders-plan` during its drafting phase, on every task whose approach depends on a runtime- or environment-behavior claim that is not confirmable from the source. The obligation also binds any re-entry of drafting triggered by the post-write fix loop.
- **Not subject:** `/flanders-spec`. Workers and reviewers run and test the code under their own rules; the plan validator's audit of this obligation is pinned in [src/prompts/.spec/rules/ai/skills/plan.md#the-flanders-plan-validator-audits-the-plan-against-five-categories](/src/prompts/.spec/rules/ai/skills/plan.md#the-flanders-plan-validator-audits-the-plan-against-five-categories).

### What counts as a runtime-behavior premise

A claim is in scope when it asserts how something behaves at execution time and a reader cannot settle it by inspecting the source alone. Non-exhaustive examples: how a terminal renders, wraps, or reflows output; how the operating system schedules or signals a process; how a third-party library responds to a given input at run time; what a network or filesystem call returns under given conditions. A claim about the code's own structure or present behavior is not in scope here — that is governed by [src/prompts/.spec/rules/ai/skills/plan.md#flanders-plan-grounds-every-code-touching-task-in-the-code-it-builds-on](/src/prompts/.spec/rules/ai/skills/plan.md#flanders-plan-grounds-every-code-touching-task-in-the-code-it-builds-on).

### Failure signals

- A task asserts a terminal, OS, library, or environment behavior as established fact to justify its approach, with no backing contract, rule, existing test, or preceding task, and without the premise having been escalated to the user.
- A task removes or weakens existing code on the strength of "this situation no longer occurs" when nothing in the plan, the specs, or an existing test establishes that.
- The plan's narrative states a runtime-behavior claim as settled and a task depends on it, but the claim is the planner's own untested inference.
- A task that depends on a behavior another task in the same plan is meant to establish appears before that establishing task.

## The /flanders-plan validator audits the plan against five categories

The `/flanders-plan` skill gates its work behind a final validator hosted as [src/prompts/.spec/rules/ai/skills/skills-common.md#every-flanders-content-skill-hosts-its-final-validator-the-same-way](/src/prompts/.spec/rules/ai/skills/skills-common.md#every-flanders-content-skill-hosts-its-final-validator-the-same-way) pins. This rule pins the five check categories the validator runs against the persisted plan file. Failure in ANY category is FAIL; the validator must run every check on every invocation and must not stop at the first violation.

### Who this applies to

- **Subject:** the `/flanders-plan` skill, as the host that packages the validator's prompt with the five categories enumerated below.
- **Subject (when running as a subagent):** the validator instance, in producing a verdict that audits all five categories independently.
- **Not subject:** the `/flanders-spec` validator — it has its own per-skill rule.

### What the validator receives

The host follows [src/prompts/.spec/rules/ai/skills/skills-common.md#every-flanders-content-skill-hosts-its-final-validator-the-same-way](/src/prompts/.spec/rules/ai/skills/skills-common.md#every-flanders-content-skill-hosts-its-final-validator-the-same-way) for the shared inputs (artifact path, canonical listings, output spec, read-only discipline, FAIL loop). On top of those, the host MUST inline the verbatim text of each of the five check categories below in the validator's prompt, and MUST pass the number of leaf task lines it generated, per [src/prompts/.spec/rules/ai/skills/plan.md#the-flanders-plan-validator-confirms-the-detected-task-count-equals-the-count-the-host-generated](/src/prompts/.spec/rules/ai/skills/plan.md#the-flanders-plan-validator-confirms-the-detected-task-count-equals-the-count-the-host-generated).

The canonical listings the host passes are:

1. The contracts listing captured at the start of the run (every contract's namespace — its project-root-relative path — across every `.spec/contracts` folder in the tree).
2. The rules listing captured at the start of the run (every rule's namespace across every `.spec/rules` folder in the tree).

Additionally, under the per-skill-inputs provision of [src/prompts/.spec/rules/ai/skills/skills-common.md#every-flanders-content-skill-hosts-its-final-validator-the-same-way](/src/prompts/.spec/rules/ai/skills/skills-common.md#every-flanders-content-skill-hosts-its-final-validator-the-same-way), the validator reads the on-disk source files the plan's tasks build on — not only the plan text and the specs — so it can audit each code-touching task against its baseline: the current source, plus the changes earlier tasks in the plan prescribe (per category 4 below). This is what lets categories 4 and 5 catch a task that misdescribes the code it builds on. Reading source is read-only and does not relax the validator's read-only discipline.

### What the validator must check

Five categories, all mandatory; failure in any one is a FAIL. Each category is audited independently and violations are enumerated exhaustively — encountering a violation in one category does not exempt the validator from completing the remaining four.

#### 1. Format and shape

Every task line conforms to [.spec/contracts/shared/plan-file-format.md](/.spec/contracts/shared/plan-file-format.md):

- The task line matches the canonical task-line recognizer regex per [src/prompts/.spec/rules/ai/skills/plan.md#the-flanders-plan-validator-confirms-task-line-format-by-exact-matching-the-canonical-recognizer-regex](/src/prompts/.spec/rules/ai/skills/plan.md#the-flanders-plan-validator-confirms-task-line-format-by-exact-matching-the-canonical-recognizer-regex). The host inlines that exact regex verbatim in the validator's prompt, and the validator confirms every line the plan presents as a task matches it. In particular the line carries the mandatory leading markdown list marker (`-`, `*`, or `+` followed by a space) before the checkbox; a line that begins with `[ ]{...}` without the leading marker is FAIL, because the `implement` command's detector would skip it and treat the plan as having no tasks.
- Valid `[ ]` or `[x]` checkbox (no malformed variants such as `[]`, `[ x]`, or `[X ]`).
- Immediately-following metrics object literally equal to `{"it":0,"ot":0,"t":0}` for freshly-generated tasks. The check is byte-exact: no extra spaces, no reordered keys, no trailing commas.
- A single space between the closing `}` and the task number, and a single space between the task number and the title.
- Hierarchical task number coherent with document position (`1` before `2`, `1.1` before `1.2`, no malformed numbering).
- Leaf-vs-parent distinction respected: leaves carry checkbox and metrics; parents carry neither.
- Each leaf task carries a description and an explicit acceptance-criteria section.
- The number of task lines the validator detects via the canonical recognizer equals the expected leaf-task count the host passes, per [src/prompts/.spec/rules/ai/skills/plan.md#the-flanders-plan-validator-confirms-the-detected-task-count-equals-the-count-the-host-generated](/src/prompts/.spec/rules/ai/skills/plan.md#the-flanders-plan-validator-confirms-the-detected-task-count-equals-the-count-the-host-generated). A detected count that differs from the expected count in either direction is FAIL.

Additionally, the plan file lives inside `plans/`, is non-empty, and contains at least one task line.

#### 2. Semantic dependency order

Tasks appear top-to-bottom in implementation order. The audit is semantic, not numeric: read each task's description and acceptance criteria and confirm that no task depends on work performed by a task that appears later in the document. A plan whose numbering is well-formed but whose dependencies flow upward is FAIL.

#### 3. Spec-folder write boundary

No task — leaf or parent — describes work that creates, modifies, deletes, or renames any file inside any `.spec/contracts` folder, any `.spec/rules` folder, any `.spec/flanders` folder, or the `plans/` folder. There is no exception for flipping checkboxes or rewriting metrics: those mutations are performed programmatically by the `implement` command and are never described by a task.

#### 4. Plan content rules (verbatim from [.spec/contracts/ai-skills/plan-skill.md](/.spec/contracts/ai-skills/plan-skill.md))

Verify that the plan satisfies EACH of the following obligations, independently. The host inlines this list verbatim in the validator's prompt; the validator audits each item as its own check and enumerates violations by name plus the offending file:line.

- **Free of placeholders.** No `<TBD>`, no `TODO`, no `XXX`, no template-style blanks, no parenthetical "(to be decided)".
- **Free of contradictions with existing contracts or rules.** No task pins behavior the canonical listings forbid.
- **Internally self-consistent — no contradiction between the plan's narrative and its tasks.** The plan's context, rationale, and explanatory prose do not contradict the obligations, verification approach, or any other statement in its task bodies, and no task contradicts that narrative. Where the prose describes how something is tested or built, it matches what the tasks prescribe. The validator reads the full file — narrative sections and every task body — and FAIL names the contradicting section/line on each side.
- **Acceptance criteria pin the observable outcome; the internal mechanism may be left to the implementer.** Each leaf task's acceptance criteria pin the task's observable outcome precisely — the behavior the result must exhibit through the surface a reader or test can inspect, such that two implementations satisfying them are observably equivalent. Acceptance criteria that leave the observable outcome open — satisfiable by implementations that differ in observable behavior — or hedge wording that defers the outcome (non-exhaustively: `or equivalent`, `pick the lower-friction option`, `pick the X that minimizes Y`, `at the time of implementation`, `either A or B — pick one`, `A or B (or some hybrid)`, `if the X exists, do Y; otherwise Z`, `or, more strongly`, `or X if Y`) are FAIL: an outcome-affecting choice the request did not specify must be closed to a single observable commitment in the acceptance criteria, or escalated to the user before the plan was drafted. A choice that affects only the task's internal mechanism — which helper to reuse, which internal structure, which implementation approach — and that changes no observable outcome the acceptance criteria pin is NOT a violation when left for the implementer to resolve; do not FAIL a task for leaving such a mechanism choice open. Conversely, a task that freezes an internal mechanism — a specific helper to reuse, a function, type, or file to leave untouched, code declared out of scope, or how the code and its tests are organized across files and modules (the file or module a task's code or tests are placed in) — that no observable acceptance criterion and no explicitly required architectural property needs is FAIL, per [src/prompts/.spec/rules/ai/skills/plan.md#flanders-plan-pins-each-tasks-observable-outcome-and-leaves-the-internal-mechanism-to-the-implementer](/src/prompts/.spec/rules/ai/skills/plan.md#flanders-plan-pins-each-tasks-observable-outcome-and-leaves-the-internal-mechanism-to-the-implementer).
- **Every leaf task carries an explicit acceptance-criteria section.** A leaf without acceptance criteria is FAIL.
- **Every leaf task carries the relevant contract link(s)** as markdown links per [.spec/contracts/shared/cross-file-reference-links.md](/.spec/contracts/shared/cross-file-reference-links.md). When the obligation lives in a specific section or line range, that section or range is referenced as well.
- **Every leaf task carries the relevant rule link(s)** as markdown links per [.spec/contracts/shared/cross-file-reference-links.md](/.spec/contracts/shared/cross-file-reference-links.md). When a rule's enforcement is bound to a specific scope, that scope is referenced alongside the file path.
- **The plan only references contracts and rules that exist in the canonical state captured at invocation.** Out of scope of the validator: verifying that the referenced paths physically resolve on disk; that is the skill's pre-validator responsibility.
- **Tasks are numbered hierarchically** per [.spec/contracts/shared/plan-file-format.md](/.spec/contracts/shared/plan-file-format.md).
- **Task granularity is sane.** A leaf task is not so broad that it would need to be split into separate AI invocations, and not so narrow that splitting further would create artificial fragmentation.
- **Each code-touching task's claims about the code it builds on are accurate.** Audit each task against its baseline — the current on-disk source, plus the changes any earlier task in the plan it depends on prescribes. A task that names a function, type, field, file, or behavior that neither the source nor any earlier task in the plan provides, or that removes or rewrites code on a mistaken account of what it does, is FAIL. Do NOT FAIL a task merely for describing code the current on-disk source lacks when an earlier task in the plan introduces it — confirm instead that the depended-on task is ordered first, per category 2. Changing the code's behavior is the task's purpose and is not itself a violation — only a false claim about the code the task builds on is. Per [src/prompts/.spec/rules/ai/skills/plan.md#flanders-plan-grounds-every-code-touching-task-in-the-code-it-builds-on](/src/prompts/.spec/rules/ai/skills/plan.md#flanders-plan-grounds-every-code-touching-task-in-the-code-it-builds-on).
- **Runtime-behavior premises are backed or escalated.** A task whose approach depends on a runtime- or observable-behavior claim not confirmable from the source — and that no contract, rule, existing test, or preceding task in the plan backs, and that was not escalated to the user — is FAIL. This explicitly includes a task that removes, weakens, or replaces existing code on the strength of such an unbacked claim. Per [src/prompts/.spec/rules/ai/skills/plan.md#flanders-plan-backs-or-escalates-a-runtime-behavior-premise-instead-of-asserting-it-as-fact](/src/prompts/.spec/rules/ai/skills/plan.md#flanders-plan-backs-or-escalates-a-runtime-behavior-premise-instead-of-asserting-it-as-fact).

#### 5. Active application of referenced contracts and rules

For every contract and rule referenced by any task in the plan, verify that the task's description and acceptance criteria actually require or honor the obligations of that reference. A task that lists a contract or rule link without the description or acceptance criteria invoking the obligation is FAIL — this is the analogue of the adversarial reviewer's condition 3 in [.spec/contracts/cli-commands/implement/iteration-loop.md](/.spec/contracts/cli-commands/implement/iteration-loop.md).

Additionally, for every contract or rule in the canonical listings the validator judges should have been linked by a task whose scope makes it applicable, but was not linked, the missing link is FAIL — analogous to the reviewer's condition 4. Apply scope-driven selection per [src/prompts/.spec/rules/ai/skills/plan.md#flanders-plan-selects-rule-links-by-scope-not-by-topic](/src/prompts/.spec/rules/ai/skills/plan.md#flanders-plan-selects-rule-links-by-scope-not-by-topic): a task that touches tests must link the applicable testing rules; a task that touches async lifecycle must link the applicable disposables rules; a task that changes terminal UI must link the applicable UI rules; and so on across every rule namespace whose scope could plausibly apply.

### Failure signals

- The validator reports PASS on a plan whose tasks describe writing to any `.spec/contracts` folder, any `.spec/rules` folder, any `.spec/flanders` folder, or the `plans/` folder (including checkbox flips or metrics rewrites).
- The validator reports PASS on a plan in which a task depends on work performed by a later task, on the grounds that the numbering looks correct.
- The validator reports PASS on a plan whose leaf task leaves its observable outcome ambiguous, or defers an outcome-affecting choice to the worker with hedge phrasing, on the grounds that "the worker will figure it out".
- The validator reports PASS on a plan with a leaf task missing its acceptance criteria, its contract link, or its rule link.
- The validator reports PASS on a plan that links a contract or rule without the task's description or acceptance criteria actually applying the obligation.
- The validator reports PASS on a plan whose narrative — its Context or rationale prose — states a verification approach or obligation that a task body contradicts; for example, prose stating an outcome can only be confirmed manually while a task adds an automated test that confirms it.
- The validator reports PASS on a task that references source structure or behavior the actual code does not have, or that removes or rewrites code on a mistaken account of what it does, because the plan text alone reads coherently — the validator audited the plan without reading the source.
- The validator reports PASS on a task that freezes an internal mechanism — a specific helper to reuse, a function, type, or file to leave untouched, code declared out of scope, or the files and modules its code and tests are organized into — that no observable acceptance criterion and no explicitly required architectural property needs, on the grounds that the task otherwise reads coherently.
- The validator reports PASS on a task that rests on an untested runtime-behavior premise with no backing contract, rule, existing test, or preceding task and no escalation to the user — including a task that deletes existing code on the strength of such a premise.
- The validator reports PASS on a plan whose detected task count differs from the expected count the host supplied — a generated task was silently lost to a recognition failure, or a non-task line was counted as a task.
- The validator aggregates the five categories into a single judgment instead of auditing each independently and enumerating violations exhaustively.
- The host packages the validator prompt without inlining the verbatim text of categories 4 and 5, forcing the validator to discover them by reading the contract — which defeats the explicit-categories obligation pinned in [src/prompts/.spec/rules/ai/skills/skills-common.md#every-flanders-content-skill-hosts-its-final-validator-the-same-way](/src/prompts/.spec/rules/ai/skills/skills-common.md#every-flanders-content-skill-hosts-its-final-validator-the-same-way).

## The /flanders-plan validator confirms the detected task count equals the count the host generated

The `/flanders-plan` validator does not only check that each line presented as a task is well-formed; it also confirms that no task the host generated was silently lost to a recognition failure. The host passes the validator the number of leaf task lines it generated, and the validator counts the lines that match the canonical task-line recognizer regex and confirms that count equals the host-supplied count exactly. Any inequality is a FAIL.

This closes a gap a per-line format check cannot: a line the host intended as a task but wrote in a shape the recognizer does not match — for example a line whose bracket is followed by `(` rather than the metrics object, so it reads as a link bullet — is invisible to a per-line check, because the validator cannot tell from the line alone that it was meant to be a task. The host-supplied count is the only ground truth that surfaces such a loss.

### Who this applies to

- **Subject:** the `/flanders-plan` skill, as the host that packages the validator's prompt — it MUST pass the number of leaf task lines it generated as an explicit input to the validator, alongside the inputs enumerated in [src/prompts/.spec/rules/ai/skills/plan.md#the-flanders-plan-validator-audits-the-plan-against-five-categories](/src/prompts/.spec/rules/ai/skills/plan.md#the-flanders-plan-validator-audits-the-plan-against-five-categories).
- **Subject (when running as a subagent):** the validator instance, in counting recognized task lines and comparing that count to the host-supplied count.
- **Not subject:** the `/flanders-spec` validator, which audits a different artifact and has no task concept.

### The count check

- The host supplies a single non-negative integer: the number of leaf task lines it wrote into the plan.
- The validator counts every line in the plan that matches the canonical task-line recognizer regex pinned in [src/prompts/.spec/rules/ai/skills/plan.md#the-flanders-plan-validator-confirms-task-line-format-by-exact-matching-the-canonical-recognizer-regex](/src/prompts/.spec/rules/ai/skills/plan.md#the-flanders-plan-validator-confirms-task-line-format-by-exact-matching-the-canonical-recognizer-regex).
- This check is PASS only when the counted number equals the host-supplied number exactly. A counted number lower than supplied (a generated task was not recognized — most often because it is malformed) and a counted number higher than supplied (a non-task line was recognized as a task) are both FAIL.

### How to apply this rule

- The host computes the expected count from the leaf tasks it generated and inlines that integer into the validator's prompt.
- The validator enumerates the recognized task lines, reports the count, and on inequality FAILs, naming the discrepancy as the expected count versus the detected count.

### Failure signals

- The host launches the validator without passing the expected leaf-task count.
- The validator reports PASS when the number of lines matching the canonical recognizer differs from the host-supplied count.
- The validator compares the counts approximately or tolerates an off-by-one instead of requiring exact equality.

## The /flanders-plan validator confirms task-line format by exact-matching the canonical recognizer regex

The format-and-shape check of the `/flanders-plan` validator does not re-derive what a task line looks like from prose. It validates every task line by exact-matching it against the canonical task-line recognizer regex — the same pattern the `implement` command's detector applies — so that a plan the validator passes is guaranteed to be a plan the `implement` command will recognize. The host inlines this exact regex verbatim into the validator's prompt; the validator must not be left to reconstruct the pattern from the shape description in [.spec/contracts/shared/plan-file-format.md](/.spec/contracts/shared/plan-file-format.md).

### Who this applies to

- **Subject:** the `/flanders-plan` skill, as the host that packages the validator's prompt — it MUST inline the canonical regex below verbatim alongside the format-and-shape category enumerated in [src/prompts/.spec/rules/ai/skills/plan.md#the-flanders-plan-validator-audits-the-plan-against-five-categories](/src/prompts/.spec/rules/ai/skills/plan.md#the-flanders-plan-validator-audits-the-plan-against-five-categories).
- **Subject (when running as a subagent):** the validator instance, in performing the format-and-shape check by matching each candidate task line against the inlined regex.
- **Not subject:** the `/flanders-spec` validator, which audits a different artifact and has no task-line concept.

### The canonical task-line recognizer regex

A task line is recognized by, and only by, this pattern:

    /^(\s*[-*+]\s+)\[([ xX])\](\{[^}]*\})(\s.*)?$/

The capture groups, in order:

1. `(\s*[-*+]\s+)` — optional leading indentation, then the mandatory markdown list marker (`-`, `*`, or `+`), then at least one space. A line that reaches the checkbox without this leading marker does not match and is therefore not a task line.
2. `([ xX])` — the single checkbox character: a space for an open task or `x`/`X` for a done task.
3. `(\{[^}]*\})` — the metrics object, present immediately after the closing `]` with no whitespace between `]` and `{`.
4. `(\s.*)?` — the remainder of the line (the task number and title), which begins with whitespace.

This is the same pattern the `implement` command applies to detect and rewrite task lines; it is the single authoritative encoding of the task-line shape described in prose in [.spec/contracts/shared/plan-file-format.md](/.spec/contracts/shared/plan-file-format.md). The regex is the structural recognizer only: the byte-exact metrics value for freshly-generated tasks, the single-space spacing between the metrics object, the task number and the title, hierarchical numbering, and the leaf-vs-parent distinction remain the finer-grained obligations enumerated by the format-and-shape category in [src/prompts/.spec/rules/ai/skills/plan.md#the-flanders-plan-validator-audits-the-plan-against-five-categories](/src/prompts/.spec/rules/ai/skills/plan.md#the-flanders-plan-validator-audits-the-plan-against-five-categories).

### How to apply this rule

- The host inlines the regex above verbatim into the validator's prompt — the literal pattern, not a paraphrase and not a pointer to the contract or to this rule by path.
- For every line the plan presents as a task (any line carrying a checkbox-and-metrics identifier), the validator confirms the line matches the regex. A line that the plan treats as a task but that fails to match — most commonly because it omits the leading list marker — is a format-and-shape FAIL, enumerated with the offending file:line.
- A plan whose task lines all read correctly to a human but none of which match the regex (so the `implement` command would report "no task lines") is FAIL, never PASS.

### Failure signals

- The host packages the validator prompt with the format-and-shape category but without the verbatim regex, leaving the validator to reconstruct the task-line pattern from prose.
- The validator reports PASS on a plan whose task lines omit the leading list marker — lines that begin with `[ ]{...}` instead of `- [ ]{...}` — on the grounds that the checkbox, metrics, and title all look correct.
- The validator treats the regex as advisory and accepts a task line that does not match it.
- The regex inlined into the validator's prompt diverges from the pattern the `implement` command's detector applies, so the validator passes lines the detector would skip.
