# `implement` Command Contract — Non-interactive AI sessions

## Purpose
Define what the user can rely on regarding interaction with the AI while the implement command runs.

## Autonomous AI sessions
Every AI session the implement command runs — the worker that implements each task and the reviewer that checks each result — runs to completion on its own. During a run, the AI never pauses to ask the user a question, never requests approval or permission to take an action, and never waits for the user to type a response. The user watches the AI's work stream into the live output region (see `cli-commands/implement/ui.md`) but is never asked to answer the AI.

This obligation covers the AI sessions only. A prompt the implement command itself shows the user before any AI work begins — the plan selection prompt that appears when more than one plan file exists (see `cli-commands/implement/overview.md`) — is an interaction with Flanders, not with the AI, and is unaffected by this contract.
