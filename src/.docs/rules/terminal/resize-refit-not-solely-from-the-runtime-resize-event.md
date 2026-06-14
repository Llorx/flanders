# Resize re-fit does not depend solely on the runtime resize event

The live bottom-fixed block re-fits to the new terminal width after a real terminal resize even when the language runtime emits no resize notification for that resize. The detection that the terminal changed size — the trigger that drives the block to redraw at the new width — does not rely solely on the runtime's resize event.

This is what makes the [.docs/contracts/cli-commands/implement/ui.md](/.docs/contracts/cli-commands/implement/ui.md) § Resizing obligation (the block recomputes and re-anchors on every terminal resize) hold on platforms whose runtime resize notification is unreliable.

## Who this applies to

- **Subject:** the production implementation of the terminal context's resize notification wired in the CLI entry point (`src/cli.ts`), together with the path that drives the live bottom-fixed block (`BottomBlock`) to redraw when the terminal changes size.
- **Scope:** detection of a terminal-width change while the live block is mounted.
- **Out of scope:** the test double and the headless terminal emulator, which drive resize through their own resize APIs; and the per-redraw recompute itself, which is governed by [src/ui/.docs/rules/state-driven-redraw.md](/src/ui/.docs/rules/state-driven-redraw.md). This rule pins what triggers the redraw, not how the redraw recomputes its lines.

## Why this matters

Node emits the `'resize'` event on `process.stdout` only when its platform mechanism detects a size change. Unix delivers this through the SIGWINCH signal. Windows has no native SIGWINCH: libuv emulates it and only detects size changes when the cursor is being moved, and even with stdin placed in raw mode and resumed, a manual drag-resize of a cmd.exe window does not deliver the event (it fires when the size is changed through the terminal's properties dialog, but not on a drag). A block whose re-fit happens only inside a `'resize'` listener therefore never re-fits on a drag-resize on a Windows console — the defect that motivates this rule.

How to satisfy it: drive re-fit from a source that observes the real terminal size independently of the `'resize'` event — for instance by periodically reading the real size (see [src/.docs/rules/terminal/current-terminal-width-reflects-the-real-terminal.md](/src/.docs/rules/terminal/current-terminal-width-reflects-the-real-terminal.md)) and redrawing when it changed. This rule does not mandate a specific mechanism; it requires only that a real resize re-fit the block whether or not the runtime delivered the event.

## Failure signals

- The only thing that re-fits the block on resize is a listener on the `process.stdout` `'resize'` event, and on a Windows console the block keeps the previous width after the window is dragged to a new size.
- Re-fit works when the size is changed via the terminal's properties dialog but not when the window border is dragged.

## References

- [Node.js TTY docs — the `'resize'` event and its Windows conditions](https://nodejs.org/api/tty.html)
- [nodejs/node#13197 — drag-resize ignored on cmd.exe even in raw mode; raw-mode workaround](https://github.com/nodejs/node/issues/13197)
- [nodejs/node#16194 — resize event is SIGWINCH-driven and platform-dependent](https://github.com/nodejs/node/issues/16194)
- [libuv signal docs — SIGWINCH on Windows detected only when the cursor moves](http://docs.libuv.org/en/v1.x/signal.html)
- [microsoft/terminal#3238 — Node resize event does not fire on window resize](https://github.com/microsoft/terminal/issues/3238)
