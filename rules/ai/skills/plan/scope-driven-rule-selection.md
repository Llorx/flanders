# `/flanders-plan` selects rule links by scope, not by topic

When `/flanders-plan` picks which rule files to link to each leaf task, the selection is driven by the scope of the work the task actually performs, not by surface-level topic matching against the user's request. The planner walks the rule namespaces captured at invocation and links every file whose obligation could be triggered by the task. Under-linking is a violation: the downstream adversarial reviewer FAILs the worker for any global rule that should have applied but was not applied, so when in doubt the planner links rather than omits.

## Who this applies to

- **Subject:** `/flanders-plan`, when filling in the rule-link section of every leaf task during the drafting phase. The obligation applies to every invocation of the skill, on every leaf task in the plan.
- **Not subject:** other skills and commands. Workers, reviewers, and validators consume the links the planner produced; they do not redo the selection.

## How the selection works

For each leaf task, the planner performs the following:

1. Identify the kinds of work the task performs — for example, "adds a test", "creates a timer", "changes terminal output", "adds a new module", "modifies a controller's lifecycle", "adds retry handling around an AI call".
2. For each kind of work, walk the rule namespaces in the canonical rule listing captured at invocation and ask: which namespaces are in scope for work of this kind? A namespace is in scope when any of its obligations could plausibly be triggered by the task — not only when the namespace name keyword-matches the request.
3. Inside every in-scope namespace, inspect every file and link every file whose obligation could be triggered by the task. The default is to link; omission requires the planner to have read the file and concluded that none of its obligations apply.

The selection is namespace-first, not keyword-first. A request that says "add a timer" without mentioning disposables still requires linking every applicable file under `rules/disposables/`, because the scope of the task — adding a timer — triggers that namespace regardless of the request's wording.

## Scope examples

The list below illustrates the pattern and is not exhaustive:

- A task that **modifies or adds tests** links every applicable file under `rules/testing/`.
- A task that **creates or modifies anything with timers, listeners, controllers, child processes, or other async lifecycle** links every applicable file under `rules/disposables/`.
- A task that **changes terminal UI or live-region output** links every applicable file under `rules/ui/`.
- A task that **adds or modifies retry, backoff, or rate-limit handling around AI or external calls** links every applicable file under `rules/ai/retry/`.
- A task that **adds or modifies session-id management for AI subagents** links every applicable file under `rules/ai/session-ids/`.
- A task that **spawns or modifies a subagent's behavior** links every applicable file under `rules/ai/agents/`.
- A task that **adds or modifies anything inside a Flanders skill's own pipeline** links every applicable file under `rules/ai/skills/`.

When a task spans multiple kinds of work — for example, "add a new test that exercises a controller with a timer" — the planner unions the in-scope namespaces from each kind and links every applicable file across all of them.

## Failure signals

- A leaf task touches tests but does not link the relevant files under `rules/testing/`.
- A leaf task introduces a timer, listener, controller, child process, or other async lifecycle but does not link the relevant files under `rules/disposables/`.
- A leaf task changes terminal UI or live-region output but does not link the relevant files under `rules/ui/`.
- The planner skips a namespace on the grounds that the request did not mention it by keyword, even though the task's scope plausibly triggers obligations in that namespace.
- The planner selects only the first or "most obvious" file in an in-scope namespace and omits other files in the same namespace whose obligations also apply.
- The planner links a single namespace for a task whose scope unions multiple kinds of work, instead of linking every applicable file across all in-scope namespaces.
