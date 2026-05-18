# Live terminal regions redraw from structured state

A region pinned to the terminal that the user perceives as a live UI element owns its visible state as **structured fields** — typed values that represent what each line of the region is supposed to show — and never as precomputed strings produced by its callers.

Each redraw of the region recomputes, from those structured fields and the current terminal geometry, every visual decision that depends on either of them. This applies to every redraw, regardless of what triggered it.

## When a redraw is triggered

- A change of any field the region owns (header content, metrics totals, footer label, waiting countdown, etc.).
- An animation tick — for example, the spinner glyph advancing.
- A transition between subordinate states of the region (for example, between the normal `Working` footer state and the waiting footer state, or between the live footer label and the terminal-state label at exit).
- A write above the region that requires the region to be re-anchored.
- A terminal resize.

## What must be recomputed on every redraw

- Truncation with ellipsis when a line does not fit at the current width.
- Compact-form / abbreviated fallback when a long form does not fit but a shorter form does.
- Line-fit decisions in general.
- Color, when color is a function of the current field values (for example, when the activity label maps to different colors depending on its value).
- Any other layout decision whose correctness depends on the current state or the current terminal width.

## What must not be cached

A string that has been precomputed at the moment a field changed must not be replayed on a later redraw whose state or geometry differ. In particular:

- Setters that take a finished string from the caller and store it as-is for future redraws are wrong; setters take the raw data fields and let the region compute the final string at render time.
- A resize handler that redraws by writing the previously cached strings is wrong; the redraw must run the full state-to-string computation against the current width.
- A state change that overwrites the cached string but leaves the truncation decision frozen until the next state change is wrong; truncation is part of the redraw, not part of state mutation.

## Failure signals

- A region exposes a setter typed as `(text:string) => void` for a field whose final rendering depends on the current terminal width.
- A resize listener calls the same draw primitive the setters call, but with the cached strings instead of recomputed ones.
- Compact-form fallback only runs inside the setter, so the region survives a resize at the wide layout even when the new width can no longer hold it.
- Color or ellipsis behaviour is observably stale immediately after a resize until the next state change repaints the region.
