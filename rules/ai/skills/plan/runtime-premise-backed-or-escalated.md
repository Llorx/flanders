# `/flanders-plan` backs or escalates a runtime-behavior premise instead of asserting it as fact

When the correctness or justification of a task depends on a claim about runtime or observable behavior — how the terminal, the operating system, a library, or the execution environment behaves when the code runs — and that claim cannot be confirmed by reading the source, `/flanders-plan` does not state the claim as settled fact in the plan. Such a claim is load-bearing precisely because a task's approach — what it adds, changes, or removes — rests on it: if the claim is false, the task is wrong. The planner cannot run the code, so it must not present the claim as if it had been verified.

The planner resolves such a premise in one of two ways:

- **Back it.** The premise is admissible as fact only when one of the following already establishes it:
  1. an existing contract or rule that pins the behavior,
  2. an existing test that proves the behavior, or
  3. a preceding task in the same plan that establishes the behavior executably (for example, a test that demonstrates it), placed before the task that depends on it.
- **Escalate it.** When no such backing exists, the planner raises the premise to the user during the clarification phase rather than assuming it, per `rules/ai/skills/plan/clarification-scope.md`.

A task may not rest its approach — and in particular may not remove, weaken, or replace existing code — on a runtime-behavior premise that is neither backed nor escalated.

## Who this applies to

- **Subject:** `/flanders-plan` during its drafting phase, on every task whose approach depends on a runtime- or environment-behavior claim that is not confirmable from the source. The obligation also binds any re-entry of drafting triggered by the post-write fix loop.
- **Not subject:** `/flanders-spec`. Workers and reviewers run and test the code under their own rules; the plan validator's audit of this obligation is pinned in `rules/ai/skills/plan/final-validator.md`.

## What counts as a runtime-behavior premise

A claim is in scope when it asserts how something behaves at execution time and a reader cannot settle it by inspecting the source alone. Non-exhaustive examples: how a terminal renders, wraps, or reflows output; how the operating system schedules or signals a process; how a third-party library responds to a given input at run time; what a network or filesystem call returns under given conditions. A claim about the code's own structure or present behavior is not in scope here — that is governed by `rules/ai/skills/plan/tasks-consistent-with-the-code-they-build-on.md`.

## Failure signals

- A task asserts a terminal, OS, library, or environment behavior as established fact to justify its approach, with no backing contract, rule, existing test, or preceding task, and without the premise having been escalated to the user.
- A task removes or weakens existing code on the strength of "this situation no longer occurs" when nothing in the plan, the specs, or an existing test establishes that.
- The plan's narrative states a runtime-behavior claim as settled and a task depends on it, but the claim is the planner's own untested inference.
- A task that depends on a behavior another task in the same plan is meant to establish appears before that establishing task.
