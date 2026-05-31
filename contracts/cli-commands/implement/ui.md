# `implement` Command Contract — UI

## Purpose
Define the live terminal UI presented to the user while the implement command runs.

## Layout
The UI is composed of two regions stacked vertically inside the terminal:
- A scrolling **output region** that occupies every row above the bottom-fixed block. New text is appended at the bottom of the visible area, pushing earlier text upward as new lines arrive. Output that scrolls past the top of the visible area remains accessible via the terminal's standard scrollback, just as if Flanders had printed those lines as a normal CLI program.
- A four-line **bottom-fixed block** anchored to the very bottom of the terminal. From top to bottom, the four lines are:
  1. A horizontal separator that visually divides the scrolling output from the status lines beneath it.
  2. The header line — see `Header line content`.
  3. The metrics line — see `Metrics line content`.
  4. The footer line — see `Footer line — normal state` and `Footer line — waiting state`.

The bottom-fixed block stays pinned in place at the bottom of the terminal while output appears above it. The UI does not draw vertical borders, surrounding boxes, or any other persistent decoration outside this fixed block. Flanders does not take over the full screen, does not switch to an alternate-screen buffer, and does not lay out content using its own row/column geometry beyond the four pinned lines.

The bottom-fixed block is present from the very first moment the command starts running. It appears before any other output is produced — including argv error messages, plan validation diagnostics, git preflight diagnostics, the `tasks completed` noop message, and the streaming output of the very first task — and stays anchored at the bottom for the entire run. The block is never removed from the screen: it remains visible after the command process has exited, and the user's shell prompt resumes on the line immediately below the block, not in place of it. The only state change at exit is on the footer line, as defined in `Cleanup on exit`. Every other rule in this contract — output always above the block, the block always present, the block redrawn on every state change and on resize — applies from the first moment of the command and is never suspended.

## Output region content
The output region receives:
- Flanders's own status writes (the equivalent of `console.log` from within Flanders).
- The streaming stdout and stderr of every subprocess Flanders spawns:
  - During `implementing` and `reviewing`: the streaming output of the AI agent.
  - During `building` and `testing`: the streaming output of the corresponding script.

Output is line-buffered: only complete lines are written into the region. Each completed line is appended below the previous one and prior lines scroll upward. Long lines wrap at the terminal's natural wrap boundary. ANSI color and styling escape sequences emitted by the source program are passed through to the terminal unchanged.

## Header line content
The header line shows the following fields on a single line, in this order:
- Current task index out of total tasks (for example, `5/12`).
- The current run iteration for the task (for example, `iter 2`).
- The current activity, one of: `implementing`, `reviewing`, `building`, `testing`. In the per-task completion snapshot defined below, this field instead shows the literal `done`.
- The plan task number as it appears in the plan file (for example, `7.3`).
- The task title as it appears in the plan file.

If the header content does not fit on the available terminal width, the entire line is truncated with an ellipsis at the end.

Each field is colored according to the scheme defined in `Colors`.

Until the plan file has been parsed and validated, the header line's individual fields all render as blank — the row still occupies its line of the block. From the moment the plan is parsed onward, the `Current task index out of total tasks` field shows the total as the denominator: `0/12` before the first task starts, `N/N` when the noop `tasks completed` case applies because every task was already complete on startup. The other header fields remain blank until the first task is selected for work.

## Metrics line content
The metrics line shows, on a single line, two paired figures separated by a vertical bar:

    task <tokens> <time>  │  plan <tokens> <time>

- `task` — accumulated consumption of the task currently being worked on. Tokens is the sum `it + ot` of the in-progress task; time is `t` of the in-progress task.
- `plan` — accumulated consumption of every task in the plan file, including tasks already completed in previous runs and the task currently in progress. Tokens is the sum of `it + ot` across all tasks; time is the sum of `t` across all tasks.

Tokens are rendered with a thousands suffix and one decimal: values below 1000 are shown as a plain integer (for example, `999`); values at or above 1000 are shown with a `k` suffix (for example, `16.4k`); values at or above 1,000,000 are shown with an `M` suffix (for example, `1.2M`).

Time is rendered in a human-readable form derived from the integer second count:
- Less than one minute: `<seconds>s` (for example, `45s`).
- At least one minute but less than one hour: `<minutes>m<seconds>s` (for example, `2m22s`).
- One hour or more: `<hours>h<minutes>m<seconds>s` (for example, `1h03m12s`).

If the full line does not fit on the terminal width, Flanders falls back to a compact form that abbreviates the labels (for example, `t:` for task and `p:` for plan, with the separator and inter-field spaces tightened). Only if the compact form also does not fit is the line truncated with an ellipsis at the end.

Each field is colored according to the scheme defined in `Colors`.

Until the plan file has been parsed and validated, both the `task` and `plan` pairs render as blank — the row still occupies its line of the block. From the moment the plan is parsed onward, the `plan` pair shows the accumulated tokens and time of the plan and keeps doing so during the git preflight and the `tasks completed` noop case. The `task` pair stays blank until the first task starts running.

While the waiting footer state is active, the tokens and time values on this line freeze at their last reported value and only resume advancing when normal work resumes.

## Footer line — normal state
The footer line shows a single label, `Working`, accompanied by a smooth animated indicator. The animation is a continuous motion that gives the user a clear visual cue that the program is alive and progressing — for example, a spinner cycling through a sequence of glyphs, or a wave that moves a single highlighted character across the label. The animation runs at 5 frames per second. The label and the animated indicator are both rendered in orange.

The `Working` label and its animation are present from the very first instant the command starts and persist across every phase — argv parsing, plan validation, git preflight, the `tasks completed` noop case, and the iteration loop — until the command is about to exit, at which point the footer line transitions to the terminal label defined in `Cleanup on exit`.

## Footer line — waiting state
While the runner is waiting for a retry, the footer line transitions to a label that conveys wait status to the user. The exact label content, wait information shown, and which retries trigger this state are defined by rules.

While the waiting state is active, the working animation is suspended.

When the wait ends and normal AI work resumes, the footer line transitions back to the `Working` state and the animation restarts.

## Per-task completion snapshot
Whenever a task is accepted at the commit/check stage (see `cli-commands/implement/iteration-loop.md`) and its checkbox is flipped to `[x]`, Flanders emits a snapshot of that task into the output region before work on the next task begins. The snapshot is emitted for every accepted task, including the last task in the plan; the run's final `all tasks completed` (or `tasks completed`) message is printed after the last snapshot.

The snapshot consists of, in order:
1. A horizontal separator line that spans the terminal width, using the same glyph as the separator inside the bottom-fixed block.
2. A header line identical in shape and coloring to the live header line, except that the `activity` field shows the literal `done` rather than one of the four live values. The task index, iteration count, plan task number, and task title reflect the task that was just completed.
3. A metrics line identical in shape and coloring to the live metrics line. The `task` figures show the total consumption accumulated over the completed task across all iterations (including ones that failed before the one that passed adversarial review). The `plan` figures show the running totals across the entire plan after that task was marked complete.
4. A second horizontal separator line, identical to the one above.

The snapshot lines are never truncated and never fall back to the compact metrics form. The header and metrics are rendered at their full length even when they exceed the terminal width; in that case they wrap at the terminal's natural wrap boundary, in line with the general output-region rule that long lines wrap rather than getting cut. The truncation and compact-form rules defined in `Header line content` and `Metrics line content` therefore apply only to the live bottom-fixed block, not to the snapshot.

The snapshot is treated as ordinary output: it scrolls upward with the rest of the output region as further output arrives, remains accessible through terminal scrollback, and does not interact with or replace the bottom-fixed block. While the run continues, the bottom-fixed block keeps reflecting the next task's live state.

## Colors
The header line and the metrics line are rendered with field-by-field coloring. The same scheme applies both to the live bottom-fixed block and to the corresponding lines inside the per-task completion snapshot.

Header line fields:
- The current task index (for example, `5/12`) — cyan.
- The current run iteration (for example, `iter 2`) — yellow.
- The current activity — magenta when it shows one of the four live values (`implementing`, `reviewing`, `building`, `testing`); green when it shows `done` in the per-task completion snapshot.
- The plan task number (for example, `7.3`) — green.
- The task title — terminal default color.

Metrics line fields:
- The `task` and `plan` labels (including their compact-form variants `t:` and `p:`) — dim.
- The tokens figure of each pair — green.
- The time figure of each pair — blue.
- The `│` separator between the two pairs — dim.

The footer line keeps the orange rendering defined in `Footer line — normal state`; the horizontal separators (both the one inside the bottom-fixed block and the ones framing each per-task completion snapshot) use the terminal default color.

## Resizing
On any redraw of the bottom-fixed block — whether triggered by a change in any of its fields, by an animation tick, by a transition into or out of the waiting state, or by a terminal resize — the block recomputes the truncation and compact-form decisions of its header and metrics lines against the current state and the current terminal width. Truncation and compact-form choices are never frozen with the width the terminal had at the time of the last field change. On terminal resize, the block additionally redraws at the new geometry so it remains anchored to the bottom of the terminal and spans the new terminal width. Output already written into the output region above is not retroactively reflowed; subsequent output flows according to the new width.

## Cleanup on exit
The bottom-fixed block is never removed when the command exits. It stays on screen as the last thing the user sees, and the user's shell prompt resumes on the line immediately below the block. All prior output remains accessible through the terminal's standard scrollback exactly as during the run.

The only state change at exit is on the footer line. Just before the process exits, the footer's animation is stopped and its label is replaced with a terminal label that names how the command ended:
- `Done` — every termination path that is not an error, including the successful completion of all remaining tasks (`all tasks completed`) and the noop case where every task was already complete at startup (`tasks completed`).
- `Hard stop` — the per-task iteration cap was exceeded for some task.
- `Interrupted` — the command received an interruption signal (for example, Ctrl+C).
- `Failed` — any other failure, including unknown CLI flag, plan validation failure, missing or empty `plans/` folder, and git preflight failure.

The terminal label is rendered in the same orange as the live `Working` state. The header and metrics lines are not modified at exit; they keep whatever value they were showing at the moment the command terminated.
