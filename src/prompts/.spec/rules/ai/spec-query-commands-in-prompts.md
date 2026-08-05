# Spec-query commands are offered to the agents whose work depends on them

## Every Flanders prompt whose agent must establish which specs apply names the spec-query commands

Every prompt Flanders authors for an agent whose work depends on establishing which specs govern a path names the read-only Flanders commands that answer that question, states what each takes and what it returns, and presents them as the way to reach that answer. The agent is otherwise left to infer applicability from the namespaces of a global listing, which names files without stating what any of them governs; the commands turn that inference into a lookup the agent can run.

### Who this applies to

- **Subject:** the construction of the single-task cycle's worker prompt and reviewer prompt (see [.spec/contracts/shared/task-cycle.md](/.spec/contracts/shared/task-cycle.md)), on both surfaces that run the cycle.
- **Subject:** the construction of the `/flanders-plan` skill body, and of the validator prompt that skill packages (see [src/prompts/.spec/rules/ai/skills/plan.md](/src/prompts/.spec/rules/ai/skills/plan.md)).
- **Not subject:** the build-and-test detection agent's prompt, whose work is deciding how the project builds and tests rather than establishing which specs a change triggers.

### Behavior

1. Every prompt in scope names the path-query command pinned in [.spec/contracts/cli-commands/specs.md](/.spec/contracts/cli-commands/specs.md), states that it takes one or more paths and returns the spec files governing them — with each file's section titles when asked for them — and states that the answer covers scopes above the project root that a project-wide listing does not reach.
2. A prompt in scope whose agent works against a plan file also names the plan-query command pinned in [.spec/contracts/cli-commands/plan.md](/.spec/contracts/cli-commands/plan.md) and states that it returns the plan's task counts.
3. Every prompt in scope states that both commands only read, so running one is compatible with the entry-point boundary the same prompt carries (see [src/prompts/.spec/rules/ai/no-flanders-entry-point-invocation.md](/src/prompts/.spec/rules/ai/no-flanders-entry-point-invocation.md)).
4. Every prompt in scope names the work its own agent uses the answer for: the worker, to establish the obligations the files it is about to touch carry; each reviewer, to establish the obligations the change set under review carries; `/flanders-plan`, to select each leaf task's links; and its validator, to establish the links a task should have carried.

### Failure signals

- A prompt in scope carries the global spec listing and no mention of the path-query command, leaving the agent to infer applicability from namespaces alone.
- A prompt in scope names a command without stating what it takes or what it returns, so the agent cannot call it without guessing its interface.
- A prompt in scope names the commands but not the work its own agent would use the answer for.
- A prompt in scope names the commands while its entry-point boundary still reads as barring them, leaving the agent with two instructions it cannot satisfy at once.
