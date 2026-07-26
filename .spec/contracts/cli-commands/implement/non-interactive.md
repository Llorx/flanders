# `implement` Command Contract — Non-interactive operation

## Purpose
Define what the user can rely on regarding interaction while the implement command runs.

## No interaction
The implement run is non-interactive from start to finish. Once a plan is selected and the run begins, the command never prompts the user, never waits for the user to type a response, and never asks the user to make a choice: it runs to completion — or to a diagnostic exit — entirely on its own. Everything the user needs to act on during the run is delivered as output (see [.spec/contracts/cli-commands/implement/ui.md](/.spec/contracts/cli-commands/implement/ui.md)); the user observes the run but is never asked to respond to it. The command does read one key press while it runs, defined in `Key input` below: it accelerates work the command had already scheduled, and the run reaches the same outcome whether or not that key is ever pressed.

The single exception is the startup plan-selection prompt: when `[plan]` is omitted and `plans/` holds more than one file, the command asks the user to choose which plan to implement before the run begins and before the live UI block is drawn (see [.spec/contracts/cli-commands/implement/overview.md#invocation](/.spec/contracts/cli-commands/implement/overview.md#invocation) and [.spec/contracts/cli-commands/implement/ui.md](/.spec/contracts/cli-commands/implement/ui.md)). This is the only choice the command puts to the user; once the plan is chosen, no further choice is put to the user for the rest of the run.

## Key input
The command reads key presses from its input channel for the whole run without ever blocking on them, and acts on one key: F5.

Pressing F5 makes every AI session that is currently in a wait retry immediately, all of them at once — a run can have several sessions waiting at the same time, one per concurrently running reviewer. The retry F5 forces is the same retry the waiting session would have performed on its own later (see [.spec/contracts/cli-commands/implement/ui.md](/.spec/contracts/cli-commands/implement/ui.md), `Footer line — waiting state`), brought forward to the instant of the press. A session that recovers from a forced retry resumes work; one that is still limited keeps waiting, with its next retry moved to a fresh interval measured from that press.

Ctrl+C interrupts the run, which ends with the interruption outcome (see [.spec/contracts/cli-commands/implement/ui.md](/.spec/contracts/cli-commands/implement/ui.md), `Cleanup on exit`).

When the input channel is not a terminal — the command's input is piped, redirected, or closed — the run proceeds exactly as it otherwise would and F5 is unavailable.

## AI sessions
The same applies to the AI sessions the command runs: the worker that implements each task and the reviewer that checks each result run to completion on their own. During a run, the AI never pauses to ask the user a question, never requests approval or permission to take an action, and never waits for the user to type a response. The user watches the AI's work stream into the live output region (see [.spec/contracts/cli-commands/implement/ui.md](/.spec/contracts/cli-commands/implement/ui.md)) but is never asked to answer the AI.
