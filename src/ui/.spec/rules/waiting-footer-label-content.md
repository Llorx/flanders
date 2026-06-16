# The waiting footer label shows a heading, an expected end, and a countdown

When the footer is in its waiting state (as defined by the UI contract), the label conveys three pieces of information so the user can both recognize what kind of wait this is and see when normal work will resume.

## Who this applies to

- **Subject:** the bottom-fixed UI block, specifically the footer line while it is in the waiting state.
- **Scope:** the visible content of the label during that state. Which retries trigger the state lives in [src/ui/.spec/rules/waiting-footer-applies-to-long-waits-only.md](/src/ui/.spec/rules/waiting-footer-applies-to-long-waits-only.md).

## What the label shows

- **A heading naming the kind of wait.** For a rate-limit wait, the heading is `Waiting rate limit`. Other long-running retry types that ever opt into the waiting state must define their own equivalent heading.
- **The absolute date and time at which the wait is expected to end.** Rendered using the same formatting conventions as the rest of the UI's time fields.
- **A live countdown of the remaining wait**, recomputed on every redraw, formatted as:
  - `<minutes> minutes` when the remaining wait is shorter than one hour.
  - `<hours> hours <minutes> minutes` when the remaining wait is at least one hour but shorter than one day.
  - `<days> days, <hours> hours, <minutes> minutes` when the remaining wait is at least one day.

The countdown is part of the redraw and recomputes from the current clock and the target end time. It is never stored as a precomputed string between redraws (see [src/ui/.spec/rules/state-driven-redraw.md](/src/ui/.spec/rules/state-driven-redraw.md)).

## Failure signals

- The footer in the waiting state shows a generic label without identifying the kind of wait.
- The expected end is missing or shown in a different format from the rest of the UI's time fields.
- The countdown crosses a unit boundary (one hour, one day) without switching to the matching wider format.
- The countdown is precomputed when the wait starts and replayed verbatim on later redraws.
