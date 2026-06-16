# `/flanders-plan` grounds every code-touching task in the code it builds on

A code-touching task states facts about the code it builds on — what exists, what that code does, and why — to justify what the task will create, change, or remove. `/flanders-plan` grounds those facts in the real state that code will be in when the task runs, never in assumption or memory. Changing what the code does is the task's purpose and is expected; what a task may not do is misstate the code it starts from — name a function, type, field, file, or behavior that code does not and will not have, claim it works differently than it does, or remove or rewrite code on a mistaken account of what it is for. A task built on a false account of its starting code is invalid, however internally coherent it reads.

## The state a task is grounded in

The code a task builds on is the code as the tasks before it leave it: the current source, plus the changes every earlier task it depends on prescribes. How the planner establishes that state depends on whether the code already exists:

- **Code that already exists and no earlier task changes** — the planner establishes its reality by reading the current on-disk source. Reading the canonical contracts and rules listings does not substitute for this: those state what the software must do, not what the code does today.
- **Code an earlier task in the plan creates or changes** — that code does not exist on disk yet, so the planner grounds the task in what the earlier task is specified to produce: its description and acceptance criteria. The earlier task must appear before this one in the plan.

Either way, the planner establishes the real starting state before writing the task — reading the source for code that exists, and consulting the producing task for code an earlier task will introduce — rather than drafting from assumption.

A claim that the starting code neither shows nor can show — a claim about how something behaves only at execution time — is out of this rule's scope and is governed by [src/prompts/.spec/rules/ai/skills/plan/runtime-premise-backed-or-escalated.md](/src/prompts/.spec/rules/ai/skills/plan/runtime-premise-backed-or-escalated.md).

## Who this applies to

- **Subject:** `/flanders-plan` during its drafting phase, for every leaf task that creates, modifies, or removes source code. The obligation also binds any re-entry of drafting triggered by the post-write fix loop.
- **Not subject:** `/flanders-spec`, which writes behavior specs rather than code-touching tasks. Workers and reviewers are governed by their own rules; the plan validator's audit of each task against the code it builds on is pinned in [src/prompts/.spec/rules/ai/skills/plan/final-validator.md](/src/prompts/.spec/rules/ai/skills/plan/final-validator.md).

## Failure signals

- A task names a function, type, field, file, or behavior that neither the code it builds on contains nor any earlier task in the plan produces.
- A task removes or rewrites code on an account of what that code does or is for that its starting state contradicts.
- The planner drafts a code-touching task without establishing the real state of the code it builds on — neither reading the existing source nor consulting the earlier task that produces it.
- A task that depends on an earlier task's change is written against the stale current source instead of what that earlier task is specified to produce.
- A task's acceptance criteria describe an end state that is impossible or incoherent given the surrounding code the task does not change.
