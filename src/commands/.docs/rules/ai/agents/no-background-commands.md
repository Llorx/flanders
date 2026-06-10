# Autonomous subagents never run commands in the background

Any AI instance (Claude Code, Codex CLI, or any other supported tool) that runs as an autonomous agent inside this project — workers, reviewers, adversarial reviewers, prep, validators, detect, and in general any subagent launched by a skill, by an orchestration, or by the `implement` command — must run every command it executes in the foreground and keep its turn active until that command finishes and its result is in hand. It is forbidden from starting any command in the background and from ending its turn while a command it spawned is still running.

This binds every command without exception: build scripts, test scripts, linters, and any other shell command. A long-running command is still run in the foreground; the subagent waits for it to complete rather than detaching it.

The only exempt instance is the interactive session with the user, which may background commands when the user explicitly asks for it in that same session.

## Who this applies to

- **Subject to the rule:** every subagent launched through the AI tool's subagent mechanism (in Claude Code, the `Agent` tool with any `subagent_type`; in Codex CLI, the equivalent when one exists), every AI-tool process launched by a skill or by the `implement` command as worker/reviewer/prep/validator/detect, and any instance that operates without a human answering turn by turn.
- **Exempt:** the interactive session in which the user is conversing with the AI tool. That session may background a command when the user asks for it explicitly. An order inferred or anticipated by the tool does not count as an explicit order.

A subagent does not inherit permission to background commands just because the session that launched it could. The prohibition is by role, not by invocation chain.

## Why the foreground is mandatory

A Flanders subagent runs as a single non-interactive turn that the orchestrator drives to completion and then awaits (see `src/ai/.docs/rules/runner/non-interactive-invocation.md`). When the subagent backgrounds a command, it yields its turn expecting a later notification that the command has finished — but a headless turn has no live channel through which that notification can arrive. The tool then holds the session open waiting for a notification that never comes, never emits its terminal result, and the orchestrator blocks indefinitely. Running every command in the foreground keeps the turn's completion tied to the command's completion, so the result is always reported back before the turn ends.

## What counts as backgrounding (forbidden)

Any mechanism that lets a command keep running after the call that started it returns, or that defers the command's result to a later notification. For example, and without the list being exhaustive:

- A `Bash` tool call (or equivalent) made with `run_in_background: true`.
- A foreground command that, on exceeding its tool timeout, is converted into a background task — the subagent must instead give the command a tool timeout large enough to let it finish in the foreground.
- Shell-level detachment: a trailing `&`, `nohup … &`, `setsid`, `disown`, `start`, PowerShell `Start-Process`/`Start-Job`, or piping a process so it survives the turn.
- Ending the turn with a message along the lines of "the command is running in the background, waiting for it to complete" while a spawned task is still pending.

## Failure signals

An execution violates this rule when, inside a subagent subject to the rule, any of the following appears:

- A `Bash` tool call (or equivalent) carrying a background flag such as `run_in_background: true`.
- A command launched with a shell detachment construct (`&`, `nohup`, `setsid`, `disown`, `start`, `Start-Process`, `Start-Job`).
- A tool result reporting that a command was moved to the background (for example, "Command running in background with ID: …").
- A final message from the subagent stating that work is still running in the background or that it is waiting for a completion notification.

If any of these signals appears, the behavior is incorrect even if the spawned command would eventually have succeeded.
