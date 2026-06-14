# `implement` Command Contract — Non-interactive operation

## Purpose
Define what the user can rely on regarding interaction while the implement command runs.

## No interaction
The implement command is non-interactive from start to finish. It never prompts the user, never waits for the user to type a response, and never asks the user to make a choice. Once invoked, it runs to completion — or to a diagnostic exit — entirely on its own. Everything the user needs to act on is delivered as output (see [.docs/contracts/cli-commands/implement/ui.md](/.docs/contracts/cli-commands/implement/ui.md)); the user observes the run but is never asked to respond to it.

## AI sessions
The same applies to the AI sessions the command runs: the worker that implements each task and the reviewer that checks each result run to completion on their own. During a run, the AI never pauses to ask the user a question, never requests approval or permission to take an action, and never waits for the user to type a response. The user watches the AI's work stream into the live output region (see [.docs/contracts/cli-commands/implement/ui.md](/.docs/contracts/cli-commands/implement/ui.md)) but is never asked to answer the AI.
