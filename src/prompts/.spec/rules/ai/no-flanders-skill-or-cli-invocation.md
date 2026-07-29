# No Flanders skill or CLI invocation from a spawned agent

## Every Flanders agent prompt bars the agent from invoking a Flanders skill or running the Flanders CLI

Every prompt Flanders authors for an agent it spawns tells that agent that Flanders' own entry points are outside its reach: it invokes no `/flanders-…` skill of its AI tool and runs no Flanders CLI command. The agent already executes inside a Flanders run, so either call re-enters that run, and the prompt states that reason where it states the boundary. When the agent concludes that work one of those entry points owns is needed, it reports that need through the channel its role already reports through.

### Who this applies to

- **Subject:** the construction of every prompt Flanders authors for an agent it spawns — the source content that produces the prompt text, and the skill that builds such a prompt at runtime:
  - the single-task cycle's worker, each reviewer, and the build-and-test detection agent (see [.spec/contracts/shared/task-cycle.md](/.spec/contracts/shared/task-cycle.md)), on both surfaces that run the cycle: the `implement` command (see [.spec/contracts/cli-commands/implement/iteration-loop.md](/.spec/contracts/cli-commands/implement/iteration-loop.md)) and the `/flanders-implement` skill (see [src/prompts/.spec/rules/ai/skills/implement.md#the-flanders-implement-skill-orchestrates-the-cycle-and-implements-nothing-itself](/src/prompts/.spec/rules/ai/skills/implement.md#the-flanders-implement-skill-orchestrates-the-cycle-and-implements-nothing-itself));
  - the final-validator subagent of `/flanders-spec` and of `/flanders-plan` (see [src/prompts/.spec/rules/ai/skills/skills-common.md#every-flanders-content-skill-hosts-its-final-validator-the-same-way](/src/prompts/.spec/rules/ai/skills/skills-common.md#every-flanders-content-skill-hosts-its-final-validator-the-same-way)).
- **Not subject:** the session the user invoked a Flanders skill in, which is not an agent Flanders spawned — including `/flanders-spec` launching `/flanders-plan` or `/flanders-implement` in that same session at the user's choice (see [.spec/contracts/ai-skills/spec-skill.md#recommending-and-launching-the-next-step](/.spec/contracts/ai-skills/spec-skill.md#recommending-and-launching-the-next-step)).

### Behavior

The prompt carries the boundary alongside the other boundaries it states:

1. **No Flanders skill invocation.** The agent invokes no skill named for Flanders in its AI tool — not as a slash command, not through a skill-invocation tool, and not by asking another agent or process to invoke one on its behalf.

2. **No Flanders CLI command.** The agent runs no Flanders CLI command — not directly, not through a package runner, and not through a wrapper or script that reaches one.

3. **The reason travels with the boundary.** The prompt states why both are barred: the agent already runs inside a Flanders run, so invoking the implementation skill or the implementation command nests a fresh cycle inside the one the agent serves, and an install or update run mid-flight rewrites the skill artifacts that run is executing from.

4. **The need is reported, not acted on.** When the agent concludes that work one of those entry points owns is needed — a spec change, a plan, a further implementation run — it reports that need through the channel its role already reports through and continues with what its role can do, leaving the invocation to the user.

### Why

Flanders installs its skills into the very AI tool its agents run in, and its CLI is reachable from the same shell, so both entry points sit one call away from every agent in the run. Taking either does not extend the run; it nests one inside it. A worker that invokes the implementation skill starts a fresh cycle whose own worker faces the same request and the same reachable skill, and nothing in either run bounds the depth — the iteration cap does not help, because every nested run gets its own. The run then spends the user's tokens and never reaches a verdict on the work that started it.

The pull toward that call is created by the prompts themselves. The agent is told that the spec folders it may not write are governed by dedicated skills (see [.spec/contracts/shared/spec-folder-write-authority.md](/.spec/contracts/shared/spec-folder-write-authority.md)), so an agent that concludes a spec change is what its work needs finds exactly one remedy visible in its own instructions: invoke the dedicated skill. A boundary that only forbids leaves that agent holding a need with no outlet, and an instruction with no outlet is the one that gets reasoned around. Naming its own report as the outlet is what makes the boundary hold.

### Failure signals

- A prompt in scope carries no boundary barring the agent from invoking a Flanders skill and from running the Flanders CLI.
- A prompt in scope bars one of the two entry points and leaves the other reachable.
- A prompt in scope confines the boundary to a direct call, so the agent may still reach an entry point through a package runner, a wrapper script, or another agent it asks.
- A prompt in scope states the boundary but names no channel for the need it displaces, leaving the invocation as the agent's only visible remedy.
- A prompt in scope states the boundary without the reason it exists.
- A boundary in scope reaches the session the user invoked a Flanders skill in, so `/flanders-spec` can no longer launch the next skill at the user's choice.
