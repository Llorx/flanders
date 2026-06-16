# The current terminal width reflects the real terminal on every read

The column count the live UI fits its lines to — the value supplied by the production implementation of the terminal context that the live bottom-fixed block reads its width from — equals the terminal's actual current width at the moment it is read. The production implementation determines that width by interrogating the terminal on each read. It does not surface a width that the language runtime cached at an earlier point and that can lag behind the real terminal or revert to a stale value.

This applies to every read of the width that feeds a rendering decision, so that the per-redraw recompute required by [src/ui/.spec/rules/state-driven-redraw.md](/src/ui/.spec/rules/state-driven-redraw.md) and the resize re-fit required by [.spec/contracts/cli-commands/implement/ui.md](/.spec/contracts/cli-commands/implement/ui.md) § Resizing operate on the true current width rather than a stale one.

## Who this applies to

- **Subject:** the production implementation of the terminal-output/size context that supplies the current column count to the live UI — the implementation wired to the real terminal in the CLI entry point (`src/cli.ts`).
- **Scope:** every read of the current terminal width that the live bottom-fixed block uses to fit, truncate, or span any of its four lines.
- **Out of scope:** the test double (the string-concatenating fake) and the headless terminal emulator, which are handed a width directly and do not read a real terminal; and the pure width-fitting helpers that receive a column count as an argument — they fit to the value their caller passes and do not source it.

## Why this matters

Node's `process.stdout.columns` is a cached value, refreshed only when the runtime processes a resize notification; `process.stdout.getWindowSize()` returns the same cached pair, not a fresh read. On Windows that cache is unreliable: it can stay at the startup width after the window is resized, and even immediately after a resize notification fires it can revert to the pre-resize value. A production column-count source that returns the cached value therefore fits the block to the wrong width on a Windows console after the user resizes the window — the defect that motivates this rule.

How to satisfy it: the terminal reports its own size in response to a Cursor Position Report query (`ESC [ 6 n`) issued after the cursor is moved to the far bottom-right corner; reading the reported position yields the real current width independently of the runtime's cache. This rule does not mandate that specific technique — it requires only that the value read reflect the real terminal — but the Cursor Position Report is the known technique that satisfies it across Windows consoles, Git Bash, and ConPTY alike.

This rule constrains the production behavior of the terminal context; it does not relax [src/.spec/rules/external-access-through-contexts.md](/src/.spec/rules/external-access-through-contexts.md) — the width is still reached only through the injected context, never through a direct global from inside a UI class.

## Failure signals

- The production column-count source returns `process.stdout.columns` or `process.stdout.getWindowSize()`, so on a Windows console the live block keeps fitting to the startup width after the user resizes the window.
- After a real terminal resize the separator, header, or metrics are drawn at a width that does not match the visible terminal.

## References

- [Node.js TTY docs — `writeStream.columns`, `getWindowSize()`, and the `'resize'` event](https://nodejs.org/api/tty.html)
- [nodejs/node@9599faae18 — documents the Windows `'resize'` conditions (raw mode + resumed stdin)](https://github.com/nodejs/node/commit/9599faae18)
- [nodejs/node#13197 — `'resize'` / size stale on Windows; cache reverts](https://github.com/nodejs/node/issues/13197)
- [libuv signal docs — SIGWINCH on Windows is detected only when the cursor moves](http://docs.libuv.org/en/v1.x/signal.html)
