# Plan File Format Contract

## Purpose
Define the shape of a plan markdown file in a way that both the `plan` command (which writes plans) and the `implement` command (which reads and updates plans) follow exactly. The detection rule and the generation rule are the same rule, applied in two directions.

## Task lines
A task is a markdown list item that carries, at the start of its content, a checkbox and a metrics object. The shape of a task line is:

    - [ ]{"it":0,"ot":0,"t":0} 1.1 TITLE

with the following pieces, in this exact order and spacing:

- A markdown list marker — one of `-`, `*`, or `+` — followed by at least one space. The line may be indented by leading whitespace before the marker. This marker is mandatory: a line that begins with the checkbox but no preceding list marker is NOT a task line and is not detected as one.
- A checkbox, in one of two states:
  - `[ ]` — open (not yet implemented).
  - `[x]` — done (already implemented).
- Immediately after the closing `]`, with no whitespace between them, the metrics object — see `Task metrics`.
- A single space.
- The task number (see `Numbering`).
- A single space.
- The task title.

A task line is detected by matching this shape on a non-blank line in the document. The same shape is used when generating tasks: any task line written by the `plan` command must be a line that the `implement` command's detector would recognize as a task — in particular it must carry the leading list marker, otherwise the detector skips it and the plan is treated as having no tasks.

## Task metrics
Every leaf task line carries a metrics object that tracks what the tool has consumed while working on that task. The object is a strict JSON literal of the form:

    {"it":<integer>,"ot":<integer>,"t":<integer>}

- `it` — total input tokens consumed by AI invocations attributed to this task.
- `ot` — total output tokens consumed by AI invocations attributed to this task.
- `t` — total seconds the tool spent actively working on this task.

All three values are non-negative integers and the object is parseable by a strict JSON parser.

The counters reflect real consumption: if the tool had to retry an AI invocation internally, the tokens spent on the discarded attempts still count toward `it`/`ot`. The time counter `t`, in contrast, only reflects time during which the tool was actively progressing on the task — time spent waiting between retries does not count toward `t`.

A newly generated task — one that has not yet been worked on — has `{"it":0,"ot":0,"t":0}`.

Only leaf tasks carry a metrics object. Parent groupings carry neither a checkbox nor a metrics object (see `Hierarchy and sub-tasks`).

## Hierarchy and sub-tasks
Tasks may be organized hierarchically:
- A leaf task — one that has no sub-tasks — carries a checkbox and a metrics object.
- A parent task — one that has sub-tasks with their own checkboxes — does NOT carry its own checkbox or metrics object. It appears as a heading or list item with a title and a description.

Equivalently: a checkbox and metrics object are present on the smallest atomic units of work and never on a unit that aggregates other checkboxed units. The implementation flow walks only leaf tasks; parent groupings exist purely to organize the document.

## Numbering
Tasks are numbered hierarchically. The numbering reflects the document structure:
- Top-level tasks: `1`, `2`, `3`, ...
- Sub-tasks of task `2`: `2.1`, `2.2`, `2.3`, ...
- Deeper levels follow the same dotted convention.

The numbering is part of the visible task identifier. The implement command uses these numbers in its UI header (see `cli-commands/implement/ui.md`).

## Ordering
Tasks are written in the order they must be implemented. A task that depends on another must appear after the task it depends on. The implement command processes tasks strictly top-to-bottom in document order.

## Acceptance criteria
Each leaf task carries a description and an explicit acceptance criteria section. The acceptance criteria define what must be true after the task is implemented for the task to be considered complete by the adversarial reviewer.

## Contract and rule references
Each leaf task lists the contract file or files that govern it, by relative path from the project root, and lists the rule file or files that apply to it, also by relative path from the project root. When a specific section or line range of a contract or rule is the relevant obligation, the task points at that section or line range in addition to the file.

## Updating tasks
While the implement command works on a task, it rewrites the task line in place to keep the metrics object up to date with the latest accumulated values. When the task is accepted, the same rewrite flips the checkbox from `[ ]` to `[x]`. Every rewrite is confined to the matched task line; surrounding content is preserved verbatim.
