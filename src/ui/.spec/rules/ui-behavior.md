# Live terminal UI rules

## Single output channel per command with a live region

A command that owns a region pinned to the terminal during its run has exactly one output object responsible for that region, which is also the sole channel through which every stdout/stderr write the command produces flows. The command's own status messages, the streaming stdout and stderr of every subprocess it spawns, every error message, and the printed text of every interactive prompt all go through this single object.

This rule is complementary to [src/.spec/rules/external-access-through-contexts.md](/src/.spec/rules/external-access-through-contexts.md). That rule forbids reaching for ambient globals (`console.*`, `process.stdout.write`, `process.stderr.write`, raw `fs` writes used as output, etc.) from a class with no output context. This rule goes further: even with a properly injected output context, a command that owns a live region must consolidate all its output through one owner — not several context-injected output paths feeding the same stream.

Commands that produce only sequential, non-pinned output are not subject to this rule.

### Lifecycle

The single output owner is created as the **first action** of the command, before any argv parsing diagnostic, configuration loading, plan parsing, preflight check, or any other code path that could itself want to write to stdout/stderr. It is disposed as the **last action** of the command, immediately before the process exits.

Diagnostics that need to be emitted before "real work" begins — unknown CLI flags, missing input files, malformed configuration, preflight failures — still flow through the owner. The owner is responsible for keeping the live region present while those diagnostics scroll above it.

### What flows through the owner

- The command's own status writes (the equivalent of `console.log` from inside the command).
- The streaming stdout and stderr of every subprocess the command spawns.
- Every error message the command emits, including those produced during early validation, argv parsing, and any exception path that escapes to the top level.
- The printed text of every interactive prompt the command displays.

Reads from stdin are not covered by this rule — the rule pins the **output** channel, not input handling.

### What is exempt

- Output produced by code the command does not own (for example, output written by the runtime before `main()` is reached, or stderr from a child process that escapes the spawn handle the command does control). The rule covers what the command itself can route.
- Trace/log writes that go to files or external systems, not to stdout/stderr. They are out of scope of this rule.

### Failure signals

A change violates this rule whenever any of the following appears in command-level code:

- The command writes to stdout/stderr through more than one object — for example, a "buffered output for the block" object and a separate "early errors" object that both end up calling the same terminal context.
- A code path inside the command bypasses the owner to emit a diagnostic directly through a context method, an injected logger, or an ambient global.
- The owner is constructed lazily after the command has already produced output through some other path.
- The owner is disposed mid-run while the command still has work to do, and subsequent writes silently fall back to a direct context path.

## Live terminal regions redraw from structured state

A region pinned to the terminal that the user perceives as a live UI element owns its visible state as **structured fields** — typed values that represent what each line of the region is supposed to show — and never as precomputed strings produced by its callers.

Each redraw of the region recomputes, from those structured fields and the current terminal geometry, every visual decision that depends on either of them. This applies to every redraw, regardless of what triggered it.

### When a redraw is triggered

- A change of any field the region owns (header content, metrics totals, footer label, waiting countdown, etc.).
- An animation tick — for example, the spinner glyph advancing.
- A transition between subordinate states of the region (for example, between the normal `Working` footer state and the waiting footer state, or between the live footer label and the terminal-state label at exit).
- A write above the region that requires the region to be re-anchored.
- A terminal resize.

### What must be recomputed on every redraw

- Truncation with ellipsis when a line does not fit at the current width.
- Compact-form / abbreviated fallback when a long form does not fit but a shorter form does.
- Line-fit decisions in general.
- Color, when color is a function of the current field values (for example, when the activity label maps to different colors depending on its value).
- Any other layout decision whose correctness depends on the current state or the current terminal width.

### What must not be cached

A string that has been precomputed at the moment a field changed must not be replayed on a later redraw whose state or geometry differ. In particular:

- Setters that take a finished string from the caller and store it as-is for future redraws are wrong; setters take the raw data fields and let the region compute the final string at render time.
- A resize handler that redraws by writing the previously cached strings is wrong; the redraw must run the full state-to-string computation against the current width.
- A state change that overwrites the cached string but leaves the truncation decision frozen until the next state change is wrong; truncation is part of the redraw, not part of state mutation.

### Failure signals

- A region exposes a setter typed as `(text:string) => void` for a field whose final rendering depends on the current terminal width.
- A resize listener calls the same draw primitive the setters call, but with the cached strings instead of recomputed ones.
- Compact-form fallback only runs inside the setter, so the region survives a resize at the wide layout even when the new width can no longer hold it.
- Color or ellipsis behaviour is observably stale immediately after a resize until the next state change repaints the region.

## The waiting footer state appears only for long retry waits

The footer's waiting state is reserved for retry waits long enough to be worth surfacing to the user. Short retry waits — those used by the transient-error backoff — do not transition the footer out of its normal footer state.

### Who this applies to

- **Subject:** the bottom-fixed UI block, specifically its footer line.
- **Scope:** the transition between the normal footer state and the waiting footer state defined by the UI contract, for the prep and worker AI waits. The normal footer state is the `Preparing` state during the prep stage and the `Working` state during the worker stage (see [.spec/contracts/cli-commands/implement/ui.md](/.spec/contracts/cli-commands/implement/ui.md)). The adversarial review stage is out of this scope: it does not use the global waiting footer state. A reviewer's rate-limit wait during the review stage is surfaced as that reviewer's `waiting` status inside the reviewing footer line (see [.spec/contracts/cli-commands/implement/ui.md](/.spec/contracts/cli-commands/implement/ui.md), `Footer line — reviewing state`), not by switching the whole footer into the global waiting state.

### When the waiting state is shown

- A rate-limit wait. Rate-limit waits can last minutes to hours and the user benefits from seeing the expected end and a countdown.
- Any future retry wait that is similarly long-running and has a knowable expected end.

### When the waiting state is not shown

- A transient-error backoff (see [src/ai/.spec/rules/retry.md#transient-retries-use-exponential-backoff-capped-at-one-minute](/src/ai/.spec/rules/retry.md#transient-retries-use-exponential-backoff-capped-at-one-minute)). These waits are capped at one minute and the user does not benefit from a dedicated footer state for them; the footer stays in its normal footer state — `Preparing` during the prep stage, `Working` during the worker stage — and the animation continues.
- Any retry whose duration cannot be reliably surfaced upfront, unless the contract explicitly extends the waiting state to cover it.

### Failure signals

- A short transient backoff (capped at one minute) toggles the footer into the waiting state, only to toggle back almost immediately.
- The waiting state activates without an expected end or countdown to show, because the wait's duration is not knowable upfront.
- A future long-running retry type is introduced without explicitly opting into or out of the waiting footer state.

## The waiting footer label shows a heading, an expected end, and a countdown

When the footer is in its waiting state (as defined by the UI contract), the label conveys three pieces of information so the user can both recognize what kind of wait this is and see when normal work will resume.

### Who this applies to

- **Subject:** the bottom-fixed UI block, specifically the footer line while it is in the waiting state.
- **Scope:** the visible content of the label during that state. Which retries trigger the state lives in [src/ui/.spec/rules/ui-behavior.md#the-waiting-footer-state-appears-only-for-long-retry-waits](/src/ui/.spec/rules/ui-behavior.md#the-waiting-footer-state-appears-only-for-long-retry-waits).

### What the label shows

- **A heading naming the kind of wait.** For a rate-limit wait, the heading is `Waiting rate limit`. Other long-running retry types that ever opt into the waiting state must define their own equivalent heading.
- **The absolute date and time at which the wait is expected to end.** Rendered using the same formatting conventions as the rest of the UI's time fields.
- **A live countdown of the remaining wait**, recomputed on every redraw, formatted as:
  - `<minutes> minutes` when the remaining wait is shorter than one hour.
  - `<hours> hours <minutes> minutes` when the remaining wait is at least one hour but shorter than one day.
  - `<days> days, <hours> hours, <minutes> minutes` when the remaining wait is at least one day.

The countdown is part of the redraw and recomputes from the current clock and the target end time. It is never stored as a precomputed string between redraws (see [src/ui/.spec/rules/ui-behavior.md#live-terminal-regions-redraw-from-structured-state](/src/ui/.spec/rules/ui-behavior.md#live-terminal-regions-redraw-from-structured-state)).

### Failure signals

- The footer in the waiting state shows a generic label without identifying the kind of wait.
- The expected end is missing or shown in a different format from the rest of the UI's time fields.
- The countdown crosses a unit boundary (one hour, one day) without switching to the matching wider format.
- The countdown is precomputed when the wait starts and replayed verbatim on later redraws.
