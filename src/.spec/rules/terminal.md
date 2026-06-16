# Terminal width and resize rules

## The current terminal width reflects the real terminal on every read

The column count the live UI fits its lines to — the value supplied by the production implementation of the terminal context that the live bottom-fixed block reads its width from — equals the terminal's actual current width at the moment it is read. The production implementation determines that width by interrogating the terminal on each read. It does not surface a width that the language runtime cached at an earlier point and that can lag behind the real terminal or revert to a stale value.

This applies to every read of the width that feeds a rendering decision, so that the per-redraw recompute required by [src/ui/.spec/rules/ui-behavior.md#live-terminal-regions-redraw-from-structured-state](/src/ui/.spec/rules/ui-behavior.md#live-terminal-regions-redraw-from-structured-state) and the resize re-fit required by [.spec/contracts/cli-commands/implement/ui.md](/.spec/contracts/cli-commands/implement/ui.md) § Resizing operate on the true current width rather than a stale one.

### Who this applies to

- **Subject:** the production implementation of the terminal-output/size context that supplies the current column count to the live UI — the implementation wired to the real terminal in the CLI entry point (`src/cli.ts`).
- **Scope:** every read of the current terminal width that the live bottom-fixed block uses to fit, truncate, or span any of its four lines.
- **Out of scope:** the test double (the string-concatenating fake) and the headless terminal emulator, which are handed a width directly and do not read a real terminal; and the pure width-fitting helpers that receive a column count as an argument — they fit to the value their caller passes and do not source it.

### Why this matters

Node's `process.stdout.columns` is a cached value, refreshed only when the runtime processes a resize notification; `process.stdout.getWindowSize()` returns the same cached pair, not a fresh read. On Windows that cache is unreliable: it can stay at the startup width after the window is resized, and even immediately after a resize notification fires it can revert to the pre-resize value. A production column-count source that returns the cached value therefore fits the block to the wrong width on a Windows console after the user resizes the window — the defect that motivates this rule.

How to satisfy it: the terminal reports its own size in response to a Cursor Position Report query (`ESC [ 6 n`) issued after the cursor is moved to the far bottom-right corner; reading the reported position yields the real current width independently of the runtime's cache. This rule does not mandate that specific technique — it requires only that the value read reflect the real terminal — but the Cursor Position Report is the known technique that satisfies it across Windows consoles, Git Bash, and ConPTY alike.

This rule constrains the production behavior of the terminal context; it does not relax [src/.spec/rules/external-access-through-contexts.md](/src/.spec/rules/external-access-through-contexts.md) — the width is still reached only through the injected context, never through a direct global from inside a UI class.

### Failure signals

- The production column-count source returns `process.stdout.columns` or `process.stdout.getWindowSize()`, so on a Windows console the live block keeps fitting to the startup width after the user resizes the window.
- After a real terminal resize the separator, header, or metrics are drawn at a width that does not match the visible terminal.

### References

- [Node.js TTY docs — `writeStream.columns`, `getWindowSize()`, and the `'resize'` event](https://nodejs.org/api/tty.html)
- [nodejs/node@9599faae18 — documents the Windows `'resize'` conditions (raw mode + resumed stdin)](https://github.com/nodejs/node/commit/9599faae18)
- [nodejs/node#13197 — `'resize'` / size stale on Windows; cache reverts](https://github.com/nodejs/node/issues/13197)
- [libuv signal docs — SIGWINCH on Windows is detected only when the cursor moves](http://docs.libuv.org/en/v1.x/signal.html)

## The native resize event triggers an immediate redraw

When the runtime delivers its native terminal resize notification, the production resize-detection triggers an **immediate** re-fit and redraw of the live bottom-fixed block at the new width — it does not defer the redraw to the next size-poll tick. The native resize event is subscribed for exactly this purpose.

### Who this applies to

- **Subject:** the production implementation of the terminal context's resize notification wired in the CLI entry point (`src/cli.ts`), together with the path that drives the live bottom-fixed block (`BottomBlock`) to redraw when the terminal changes size.
- **Scope:** handling of a delivered native resize notification while the live block is mounted.
- **Out of scope:** the test double and the headless terminal emulator, which drive resize through their own APIs; the per-redraw recompute itself, governed by [src/ui/.spec/rules/ui-behavior.md#live-terminal-regions-redraw-from-structured-state](/src/ui/.spec/rules/ui-behavior.md#live-terminal-regions-redraw-from-structured-state); and the missing-event fallback, governed by [src/.spec/rules/terminal.md#resize-re-fit-does-not-depend-solely-on-the-runtime-resize-event](/src/.spec/rules/terminal.md#resize-re-fit-does-not-depend-solely-on-the-runtime-resize-event). This rule pins what happens when the native event **is** delivered, not the recompute and not the no-event case.

### Why this matters

The size poll observes a resize only within at most one poll interval, so a re-fit driven by the poll alone leaves a brief window in which the block is still drawn at the stale width before the next tick corrects it — a visible flicker. Subscribing to the runtime's native resize event and redrawing the moment it fires removes that lag for every resize the runtime reports an event for (for example under ConPTY, and in any other case where the event is delivered). The poll remains the fallback that catches the resizes the runtime never reports (see [src/.spec/rules/terminal.md#resize-re-fit-does-not-depend-solely-on-the-runtime-resize-event](/src/.spec/rules/terminal.md#resize-re-fit-does-not-depend-solely-on-the-runtime-resize-event)); this rule ensures the delivered-event case is acted on immediately rather than waiting for it.

The redraw triggered here re-fits all four lines at the current width — read freshly per [src/.spec/rules/terminal.md#the-current-terminal-width-reflects-the-real-terminal-on-every-read](/src/.spec/rules/terminal.md#the-current-terminal-width-reflects-the-real-terminal-on-every-read) and recomputed per [src/ui/.spec/rules/ui-behavior.md#live-terminal-regions-redraw-from-structured-state](/src/ui/.spec/rules/ui-behavior.md#live-terminal-regions-redraw-from-structured-state) — consistent with [.spec/contracts/cli-commands/implement/ui.md](/.spec/contracts/cli-commands/implement/ui.md) § Resizing, which lists a terminal resize among the redraw triggers.

### Failure signals

- A delivered native resize event is ignored, so the block re-fits only on the next poll tick — showing the old width for up to one poll interval (a flicker) before correcting.
- The native resize event is never subscribed, leaving the size poll as the only re-fit trigger and making every resize lag by up to one poll interval.

### References

- [Node.js TTY docs — the `'resize'` event on a terminal write stream](https://nodejs.org/api/tty.html)

## Resize re-fit does not depend solely on the runtime resize event

The live bottom-fixed block re-fits to the new terminal width after a real terminal resize even when the language runtime emits no resize notification for that resize. The detection that the terminal changed size — the trigger that drives the block to redraw at the new width — does not rely solely on the runtime's resize event.

This is what makes the [.spec/contracts/cli-commands/implement/ui.md](/.spec/contracts/cli-commands/implement/ui.md) § Resizing obligation (the block recomputes and re-anchors on every terminal resize) hold on platforms whose runtime resize notification is unreliable.

### Who this applies to

- **Subject:** the production implementation of the terminal context's resize notification wired in the CLI entry point (`src/cli.ts`), together with the path that drives the live bottom-fixed block (`BottomBlock`) to redraw when the terminal changes size.
- **Scope:** detection of a terminal-width change while the live block is mounted.
- **Out of scope:** the test double and the headless terminal emulator, which drive resize through their own resize APIs; and the per-redraw recompute itself, which is governed by [src/ui/.spec/rules/ui-behavior.md#live-terminal-regions-redraw-from-structured-state](/src/ui/.spec/rules/ui-behavior.md#live-terminal-regions-redraw-from-structured-state). This rule pins what triggers the redraw, not how the redraw recomputes its lines.

### Why this matters

Node emits the `'resize'` event on `process.stdout` only when its platform mechanism detects a size change. Unix delivers this through the SIGWINCH signal. Windows has no native SIGWINCH: libuv emulates it and only detects size changes when the cursor is being moved, and even with stdin placed in raw mode and resumed, a manual drag-resize of a cmd.exe window does not deliver the event (it fires when the size is changed through the terminal's properties dialog, but not on a drag). A block whose re-fit happens only inside a `'resize'` listener therefore never re-fits on a drag-resize on a Windows console — the defect that motivates this rule.

How to satisfy it: drive re-fit from a source that observes the real terminal size independently of the `'resize'` event — for instance by periodically reading the real size (see [src/.spec/rules/terminal.md#the-current-terminal-width-reflects-the-real-terminal-on-every-read](/src/.spec/rules/terminal.md#the-current-terminal-width-reflects-the-real-terminal-on-every-read)) and redrawing when it changed. This rule does not mandate a specific mechanism; it requires only that a real resize re-fit the block whether or not the runtime delivered the event.

### Failure signals

- The only thing that re-fits the block on resize is a listener on the `process.stdout` `'resize'` event, and on a Windows console the block keeps the previous width after the window is dragged to a new size.
- Re-fit works when the size is changed via the terminal's properties dialog but not when the window border is dragged.

### References

- [Node.js TTY docs — the `'resize'` event and its Windows conditions](https://nodejs.org/api/tty.html)
- [nodejs/node#13197 — drag-resize ignored on cmd.exe even in raw mode; raw-mode workaround](https://github.com/nodejs/node/issues/13197)
- [nodejs/node#16194 — resize event is SIGWINCH-driven and platform-dependent](https://github.com/nodejs/node/issues/16194)
- [libuv signal docs — SIGWINCH on Windows detected only when the cursor moves](http://docs.libuv.org/en/v1.x/signal.html)
- [microsoft/terminal#3238 — Node resize event does not fire on window resize](https://github.com/microsoft/terminal/issues/3238)
