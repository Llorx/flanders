# Retry-key fan-out rules

## The retry key forces every in-flight AI invocation at once

When the retry key reaches the `implement` orchestrator (the F5 press the terminal context decodes, see [src/.spec/rules/terminal-key-input.md](/src/.spec/rules/terminal-key-input.md)), the orchestrator forwards the runner's forced-retry trigger (see [src/ai/.spec/contracts/ai-runner.md](/src/ai/.spec/contracts/ai-runner.md), `Forcing an immediate retry`) to every AI invocation it currently has in flight, in a single pass, without awaiting one before triggering the next. The runner then acts on the invocations that are in a wait and leaves the rest running.

### Who this applies to

- **Subject:** the orchestrator of the `implement` command, in every stage where it holds AI invocations — the worker stage, the startup build and test command detection stage (see [.spec/contracts/cli-commands/implement/workspace.md](/.spec/contracts/cli-commands/implement/workspace.md)), and the adversarial review stage, where several invocations run at once (see [src/commands/.spec/rules/ai/agents.md#reviewers-run-concurrently-one-independent-invocation-each](/src/commands/.spec/rules/ai/agents.md#reviewers-run-concurrently-one-independent-invocation-each)).
- **Not subject:** the AI runner, which receives the trigger per invocation and decides what it means for that invocation's wait; and the terminal context, which decodes the key and takes no part in what it triggers.

### Behavior

A press acts on the set of invocations in flight at the instant it arrives: the orchestrator triggers each of them and returns to its ordinary work, and the effect of each trigger is whatever the runner makes of it for that invocation. A press that arrives while nothing is in flight has nothing to trigger, and the run continues unchanged.

### Why every invocation, together

Several invocations can be waiting at the same time — the review stage runs its reviewers concurrently and each holds its own rate-limit wait — and a user pressing the retry key is asking the run as a whole to try again now, not one of its sessions. Triggering the whole in-flight set in one pass also keeps the presentation honest: the single `(F5)` hint the UI shows covers every pending retry on screen (see [.spec/contracts/cli-commands/implement/ui.md](/.spec/contracts/cli-commands/implement/ui.md), `Footer line — reviewing state`).

### Failure signals

- The orchestrator triggers only the invocation of the current stage, or only the first waiting reviewer, leaving the other waiting invocations on their original schedule.
- The orchestrator awaits each triggered invocation before triggering the next, so the presses reach later invocations only after earlier ones have finished.
- The orchestrator queues a press to apply to invocations started after it arrived.
- The orchestrator decides on its own whether an invocation's wait should be shortened, duplicating the runner's forced-retry semantics instead of forwarding the trigger.
- The orchestrator treats a press arriving with nothing in flight as an error, or as a reason to restart a stage.
