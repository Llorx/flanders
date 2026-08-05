# `plan` Command Contract

## Purpose
Report what a plan file contains, counted by the same detector the `implement` command applies, so that a caller checks a plan against a real count instead of against its own reading of the document. The answer is derived from the plan file alone: the command makes no AI invocation, reads no Flanders configuration, and writes nothing — in particular it neither creates nor modifies any plan.

## Invocation

    npx flanders plan <plan-file>

- `<plan-file>` is the path to a plan markdown file and is required. Invoked with no argument, the command exits non-zero with a usage message naming the missing argument.
- When the named file does not exist or cannot be read, the command exits non-zero with a diagnostic naming the path.

## Output
The output is written to standard output as four lines, in this order, each a fixed key, a colon, a space, and a non-negative integer:

    tasks: <n>
    open: <n>
    done: <n>
    malformed: <n>

- `tasks` — the number of leaf task lines the plan carries, detected exactly as [.spec/contracts/shared/plan-file-format.md](/.spec/contracts/shared/plan-file-format.md) pins task-line detection.
- `open` and `done` — how many of those task lines carry an open checkbox and how many carry a done checkbox. The two sum to `tasks`.
- `malformed` — the number of lines that attempt the task-line shape without conforming to it, as [.spec/contracts/shared/plan-file-format.md#malformed-task-lines](/.spec/contracts/shared/plan-file-format.md#malformed-task-lines) pins that attempt. This is what surfaces a task that was written in a shape the detector skips: such a line is absent from `tasks` and present here.

The command reports these counts rather than judging them: a plan with malformed lines, or with no task line at all, is reported through the counts and the command exits successfully. The only non-zero exits are the usage and unreadable-file errors above.
