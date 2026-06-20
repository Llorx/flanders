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

The bottom-fixed block is present from the very first moment the command starts running. It appears before any other output is produced — including argv error messages, plan validation diagnostics, git preflight diagnostics, the tasks-completed noop message, and the streaming output of the very first task — and stays anchored at the bottom for the entire run. The block is never removed from the screen: it remains visible after the command process has exited, and the user's shell prompt resumes on the line immediately below the block, not in place of it. The only state change at exit is on the footer line, as defined in `Cleanup on exit`. Every other rule in this contract — output always above the block, the block always present, the block redrawn on every state change and on resize — applies from the first moment of the command and is never suspended.

## Output region content
The output region receives:
- Flanders's own status writes (the equivalent of `console.log` from within Flanders).
- The streaming stdout and stderr of every subprocess Flanders spawns:
  - During `implementing` and `reviewing`: the streaming output of the AI agent.
  - During `building` and `testing`: the streaming output of the corresponding script.

Output is line-buffered: only complete lines are written into the region. Each completed line is appended below the previous one and prior lines scroll upward. Long lines wrap at the terminal's natural wrap boundary. ANSI color and styling escape sequences emitted by the source program are passed through to the terminal unchanged.

The streaming output of the AI agent — produced during the `implementing` and `reviewing` stages — is surfaced as a sequence of labeled messages: the agent's assistant replies, its reasoning, the tools or commands it runs, and the results of those. Each message is shown with a leading label colored according to its kind, as defined in `Colors`. The streaming output of the `building` and `testing` scripts is not an AI agent message: it is shown as-is, with its own ANSI passed through unchanged and no coloring added by Flanders.

## Header line content
The header line shows the following fields on a single line, in this order:
- Current task index out of total tasks (for example, `5/12`).
- The current run iteration for the task (for example, `iter 2`).
- The current activity, one of: `implementing`, `reviewing`, `building`, `testing`. In the per-task completion snapshot defined below, this field instead shows the literal `done`.
- The plan task number as it appears in the plan file (for example, `7.3`).
- The task title as it appears in the plan file.

If the header content does not fit on the available terminal width, the entire line is truncated with an ellipsis at the end.

Each field is colored according to the scheme defined in `Colors`.

Until the plan file has been parsed and validated, the header line's individual fields all render as blank — the row still occupies its line of the block. From the moment the plan is parsed onward, the `Current task index out of total tasks` field shows the total as the denominator: `0/12` before the first task starts, `N/N` when the noop tasks-completed case applies because every task was already complete on startup. The other header fields remain blank until the first task is selected for work. They populate at the start of that task's worker stage — the task index, plan task number, and task title switch to that task, the activity field shows `implementing`, and the `current run iteration` field shows `iter 1`.

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

Until the plan file has been parsed and validated, both the `task` and `plan` pairs render as blank — the row still occupies its line of the block. From the moment the plan is parsed onward, the `plan` pair shows the accumulated tokens and time of the plan and keeps doing so during the git preflight and the tasks-completed noop case. The `task` pair stays blank until work on the first task begins, at the start of that task's worker stage.

When work moves to a new task, the `task` pair resets to that task at the start of its worker stage and advances with that task's consumption as the task progresses; the `plan` pair keeps accumulating across every task.

While the waiting footer state is active, the tokens and time values on this line freeze at their last reported value and only resume advancing when normal work resumes.

## Footer line — normal state
The footer line shows a working label accompanied by a smooth animated indicator. The working label is drawn from a pool of short Ned-Flanders-flavored variants whose membership is pinned by [src/.spec/rules/flanders-voice-cli-variants.md](/src/.spec/rules/flanders-voice-cli-variants.md), and it rotates to a different variant than the one currently shown every 5 seconds, so the label keeps changing while work continues. The animated indicator is a continuous motion that gives the user a clear visual cue that the program is alive and progressing — for example, a spinner cycling through a sequence of glyphs, or a wave that moves a single highlighted character across the label. The indicator animation runs at 5 frames per second, a cadence independent of the 5-second label rotation. The working label and the animated indicator are both rendered in orange. The voice these variants carry is defined in [.spec/contracts/shared/flanders-voice.md](/.spec/contracts/shared/flanders-voice.md).

The working label and its animation are present from the very first instant the command starts and persist across every phase — argv parsing, plan validation, git preflight, the build and test command detection that runs at startup (see [.spec/contracts/cli-commands/implement/workspace.md](/.spec/contracts/cli-commands/implement/workspace.md)), the tasks-completed noop case, and the iteration loop — until the command is about to exit, at which point the footer line transitions to the terminal label defined in `Cleanup on exit`. One phase interrupts the working label: the adversarial review stage, when it shows the reviewing state defined in `Footer line — reviewing state`.

## Footer line — waiting state
While the runner is waiting for a retry, the footer line transitions to a label that conveys wait status to the user. The exact label content, wait information shown, and which retries trigger this state are defined by rules.

While the waiting state is active, the working animation is suspended.

When the wait ends and normal AI work resumes, the footer line transitions back to its pre-wait normal working state, and the animation and the label rotation restart.

The waiting state described here covers every stage in which a single AI agent runs at a time: the worker stage and the build and test command detection that runs at startup before the iteration loop (see [.spec/contracts/cli-commands/implement/workspace.md](/.spec/contracts/cli-commands/implement/workspace.md)). In each of these stages a rate-limit wait transitions the footer into this waiting state with the same label content. It does not apply during the adversarial review stage, where several reviewers run at once; a reviewer's rate-limit wait is surfaced instead as that reviewer's `waiting` status with its own countdown inside the reviewing footer line (see `Footer line — reviewing state`).

## Footer line — reviewing state
While the adversarial review stage is running — the same phase during which the header activity field shows `reviewing` — the footer line replaces the working label and its animation with a per-reviewer status line that reports every configured reviewer and its current state on a single line. The working animation is suspended for the duration of the review stage.

The line begins with the literal prefix `review: ` followed by one entry per configured reviewer, in the order the reviewers were configured, separated by `, `. Each entry has the shape:

    <tool> (<model> <effort>): <state>

- **`<tool>`** — the reviewer's configured tool name, `claude` or `codex`.
- **`(<model> <effort>)`** — the reviewer's model/effort descriptor. The model token is the reviewer's configured model, or the literal `default` when the configured model is the default configured model. The effort token is the reviewer's configured effort, or the literal `default` when the configured effort is the default configured effort. The effort token is appended after a single space only when the configured effort string differs from the configured model string; when the two configured strings are equal — including the common case where both are the default — only the model token is shown, so a reviewer left fully on defaults renders as `(default)` rather than `(default default)`.
- **`<state>`** — one of:
  - `running` — the reviewer's invocation is in progress.
  - `waiting <countdown>` — the reviewer's invocation is in a rate-limit wait, followed by a compact live countdown of that reviewer's own remaining wait. Each rate-limited reviewer shows its own countdown, recomputed independently of the others. A short transient-error backoff does not move a reviewer into `waiting`; it stays `running` (consistent with [src/ui/.spec/rules/ui-behavior.md#the-waiting-footer-state-appears-only-for-long-retry-waits](/src/ui/.spec/rules/ui-behavior.md#the-waiting-footer-state-appears-only-for-long-retry-waits)).
  - `ok` — the reviewer finished and recorded no violations.
  - `fail` — the reviewer finished and recorded one or more violations.

The `<countdown>` shown after `waiting` is that reviewer's remaining wait in a compact duration form, with no zero-padding of the numeric components, switching format at the same boundaries as the worker waiting countdown (see [src/ui/.spec/rules/ui-behavior.md#the-waiting-footer-label-shows-a-heading-an-expected-end-and-a-countdown](/src/ui/.spec/rules/ui-behavior.md#the-waiting-footer-label-shows-a-heading-an-expected-end-and-a-countdown)):
- `<minutes>m` when the remaining wait is shorter than one hour (for example, `14m`).
- `<hours>h<minutes>m` when the remaining wait is at least one hour but shorter than one day (for example, `2h14m`).
- `<days>d<hours>h<minutes>m` when the remaining wait is at least one day (for example, `1d2h14m`).

The countdown recomputes on every redraw from the current clock and that reviewer's target end time, and is never stored as a precomputed string between redraws (see [src/ui/.spec/rules/ui-behavior.md#live-terminal-regions-redraw-from-structured-state](/src/ui/.spec/rules/ui-behavior.md#live-terminal-regions-redraw-from-structured-state)).

The line is rendered in the same orange as the rest of the footer line.

### Compaction
The reviewing footer line is compacted to fit the terminal width. The compaction decision is recomputed on every redraw against the current state and the current terminal width, never frozen at the width of the last state change (see [src/ui/.spec/rules/ui-behavior.md#live-terminal-regions-redraw-from-structured-state](/src/ui/.spec/rules/ui-behavior.md#live-terminal-regions-redraw-from-structured-state)). The tiers, applied in order, are:
1. **Full form** — every entry shown as `<tool> (<model> <effort>): <state>`.
2. **Compact form** — when the full form does not fit, the `(<model> <effort>)` descriptor is dropped from every entry, leaving `review: <tool>: <state>, …`.
3. **Truncation** — when the compact form also does not fit, the line is truncated with an ellipsis at the end.

A reviewer's `waiting <countdown>` keeps its countdown in both the full and the compact form: the compact tier drops only the `(<model> <effort>)` descriptor, never the `<state>` or the countdown that follows it. The countdown is cut only when the line reaches the truncation tier.

## Per-task completion snapshot
Whenever a task is accepted at the commit/check stage (see [.spec/contracts/cli-commands/implement/iteration-loop.md](/.spec/contracts/cli-commands/implement/iteration-loop.md)) and its checkbox is flipped to `[x]`, Flanders emits a snapshot of that task into the output region before work on the next task begins. The snapshot is emitted for every accepted task, including the last task in the plan; the run's final all-tasks-completed (or tasks-completed) message is printed after the last snapshot.

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

The footer line keeps the orange rendering defined in `Footer line — normal state`, including while it shows the reviewing-state line defined in `Footer line — reviewing state`; the horizontal separators (both the one inside the bottom-fixed block and the ones framing each per-task completion snapshot) use the terminal default color.

### AI agent message colors (output region)
Each AI agent message surfaced in the output region (defined in `Output region content`) is shown with a leading label that names the message kind, colored by kind:
- An assistant reply — green label.
- Reasoning — dim label.
- A tool or command action — its label, the name of the tool or command, in cyan; the one-line target qualifier the action operates on (for example the file it reads or edits, the command it runs, or the pattern it searches) in yellow.
- A tool or command result — magenta label.

The body of a message — the assistant's reply text, a result's content — is rendered in the terminal default color, with any ANSI color and styling escape sequences it already carries passed through unchanged. This coloring applies to AI agent messages only; the streaming output of the `building` and `testing` scripts is never recolored and keeps the pass-through behavior defined in `Output region content`.

## Resizing
The bottom-fixed block always occupies exactly four terminal rows — the separator, the header, the metrics, and the footer, one row each. No line ever wraps onto a second row, and a redraw never leaves rows from a previous draw on screen: the block is, at every moment, exactly these four rows.

Each line is fitted to the current terminal width before it is drawn, by applying its fallback ladder in order until it fits:
1. The line's full form.
2. Any compact form the line defines — for example, the metrics line's abbreviated `t:`/`p:` labels, or the reviewing footer's dropped per-reviewer `(<model> <effort>)` descriptors. A line that defines no compact form skips this step.
3. Truncation with an ellipsis at the end when no form fits.

The separator spans the full terminal width; the header, the metrics, and the footer are fitted as above. This fit is recomputed on every redraw — a change in any field, an animation tick, a working-label rotation tick, a countdown tick (the waiting footer's countdown or any reviewer's `waiting` countdown), a transition into or out of the waiting or reviewing state, a write above the block, and a terminal resize — against the current state and the current terminal width, and is never frozen at the width of an earlier draw.

On a terminal resize the block recomputes and redraws all four lines at the new width and re-anchors to the bottom of the terminal, leaving no rows from the previous size on screen and remaining exactly four rows. Output already written into the scrolling region above the block is not retroactively reflowed; subsequent output flows according to the new width.

## Cleanup on exit
The bottom-fixed block is never removed when the command exits. It stays on screen as the last thing the user sees, and the user's shell prompt resumes on the line immediately below the block. All prior output remains accessible through the terminal's standard scrollback exactly as during the run.

The only state change at exit is on the footer line. Just before the process exits, the footer's animation and label rotation are stopped, and the label is replaced with a terminal label that names how the command ended. The terminal label is one variant chosen at random from the pool for that outcome, whose membership is pinned by [src/.spec/rules/flanders-voice-cli-variants.md](/src/.spec/rules/flanders-voice-cli-variants.md). The outcomes and their pools are:
- Success — every termination path that is not an error, including the successful completion of all remaining tasks (the all-tasks-completed message) and the noop case where every task was already complete at startup (the tasks-completed message). The label is one variant from the success pool.
- Hard stop — a hard stop occurred: the per-task iteration cap was exceeded for some task. The label is one variant from the hard-stop pool.
- Interruption — the command received an interruption signal (for example, Ctrl+C). The label is one variant from the interruption pool.
- Failure — any other failure, including unknown CLI flag, plan validation failure, missing or empty `plans/` folder, and git preflight failure. The label is one variant from the failure pool.

The terminal label is rendered in the same orange as the live working state. The header and metrics lines are not modified at exit; they keep whatever value they were showing at the moment the command terminated.
