# The native resize event triggers an immediate redraw

When the runtime delivers its native terminal resize notification, the production resize-detection triggers an **immediate** re-fit and redraw of the live bottom-fixed block at the new width — it does not defer the redraw to the next size-poll tick. The native resize event is subscribed for exactly this purpose.

## Who this applies to

- **Subject:** the production implementation of the terminal context's resize notification wired in the CLI entry point (`src/cli.ts`), together with the path that drives the live bottom-fixed block (`BottomBlock`) to redraw when the terminal changes size.
- **Scope:** handling of a delivered native resize notification while the live block is mounted.
- **Out of scope:** the test double and the headless terminal emulator, which drive resize through their own APIs; the per-redraw recompute itself, governed by [src/ui/.docs/rules/state-driven-redraw.md](/src/ui/.docs/rules/state-driven-redraw.md); and the missing-event fallback, governed by [src/.docs/rules/terminal/resize-refit-not-solely-from-the-runtime-resize-event.md](/src/.docs/rules/terminal/resize-refit-not-solely-from-the-runtime-resize-event.md). This rule pins what happens when the native event **is** delivered, not the recompute and not the no-event case.

## Why this matters

The size poll observes a resize only within at most one poll interval, so a re-fit driven by the poll alone leaves a brief window in which the block is still drawn at the stale width before the next tick corrects it — a visible flicker. Subscribing to the runtime's native resize event and redrawing the moment it fires removes that lag for every resize the runtime reports an event for (for example under ConPTY, and in any other case where the event is delivered). The poll remains the fallback that catches the resizes the runtime never reports (see [src/.docs/rules/terminal/resize-refit-not-solely-from-the-runtime-resize-event.md](/src/.docs/rules/terminal/resize-refit-not-solely-from-the-runtime-resize-event.md)); this rule ensures the delivered-event case is acted on immediately rather than waiting for it.

The redraw triggered here re-fits all four lines at the current width — read freshly per [src/.docs/rules/terminal/current-terminal-width-reflects-the-real-terminal.md](/src/.docs/rules/terminal/current-terminal-width-reflects-the-real-terminal.md) and recomputed per [src/ui/.docs/rules/state-driven-redraw.md](/src/ui/.docs/rules/state-driven-redraw.md) — consistent with [.docs/contracts/cli-commands/implement/ui.md](/.docs/contracts/cli-commands/implement/ui.md) § Resizing, which lists a terminal resize among the redraw triggers.

## Failure signals

- A delivered native resize event is ignored, so the block re-fits only on the next poll tick — showing the old width for up to one poll interval (a flicker) before correcting.
- The native resize event is never subscribed, leaving the size poll as the only re-fit trigger and making every resize lag by up to one poll interval.

## References

- [Node.js TTY docs — the `'resize'` event on a terminal write stream](https://nodejs.org/api/tty.html)
