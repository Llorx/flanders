# Terminal key-input rules

## The terminal context delivers the retry key while preserving interruption and the live region

The key press the live UI acts on — the retry key the `implement` command exposes as F5 (see [.spec/contracts/cli-commands/implement/non-interactive.md](/.spec/contracts/cli-commands/implement/non-interactive.md), `Key input`) — reaches the command through the injected terminal context, decoded from the input channel's raw byte stream, and the reader is responsible for keeping the interruption path and the live bottom-fixed block intact while it holds that channel.

### Who this applies to

- **Subject:** the production implementation of the terminal context that reads the input channel, wired in the CLI entry point (`src/cli.ts`), together with the key-decoding path that turns its bytes into the retry-key notification the command consumes.
- **Scope:** reading the input channel while the live bottom-fixed block is mounted.
- **Out of scope:** the test double and the headless terminal emulator, which are driven through their own APIs and read no real input channel; the interactive prompting helper the `install` and `update` commands use (see [src/commands/.spec/rules/install.md](/src/commands/.spec/rules/install.md)), which reads answers, not keys; and what the retry key triggers, which is [src/commands/.spec/rules/ai/retry-key-fan-out.md](/src/commands/.spec/rules/ai/retry-key-fan-out.md).

### Behavior

1. **Reached only through the context.** A UI or command class learns about a key press by subscribing through the injected terminal context, the same way it reads the terminal width and the resize notification (see [src/.spec/rules/external-access-through-contexts.md](/src/.spec/rules/external-access-through-contexts.md)).

2. **The subscription is a disposable.** Subscribing puts the input channel in raw mode and starts consuming its bytes; disposing the subscription stops consuming and restores the channel to the mode it had before. The creator of the subscription owns it and disposes it as part of its own disposal, before the process exits (see [src/.spec/rules/disposables.md#async-resources-have-a-disposable-owner](/src/.spec/rules/disposables.md#async-resources-have-a-disposable-owner)).

3. **Recognized retry-key sequences.** A terminal reports F5 as an escape sequence, so the decoder recognizes it as one: `ESC [ 1 5 ~` (`\x1b[15~`), the modifier-carrying form `ESC [ 1 5 ; <n> ~` for any numeric `<n>`, and `ESC [ [ E` (`\x1b[[E`) as sent by the Linux console. Any of them notifies one retry-key press. Every other byte read from the channel is consumed and discarded, so stray input neither reaches the output region nor is mistaken for the retry key.

4. **Interruption keeps working.** While the input channel is in raw mode the runtime no longer delivers the interrupt signal for Ctrl+C, so the reader recognizes the interrupt byte `ETX` (`\x03`) and ends the run through the same interruption path the signal drives, reaching the interruption terminal label the UI contract defines (see [.spec/contracts/cli-commands/implement/ui.md](/.spec/contracts/cli-commands/implement/ui.md), `Cleanup on exit`).

5. **The live region stays clean.** Raw mode is entered with echo off, so a key press leaves no characters on screen and the bottom-fixed block keeps its exact four rows (see [.spec/contracts/cli-commands/implement/ui.md](/.spec/contracts/cli-commands/implement/ui.md), `Resizing`).

6. **A non-terminal input channel yields no key input.** When the input channel is not a terminal, the context reports that no key input is available: no raw mode is entered and no byte is consumed, and the command runs its course on that basis.

### Why this matters

F5 arrives as a multi-byte escape sequence rather than a line, so it is readable only from a channel in raw mode — the same mode that suppresses the runtime's interrupt signal and its line echo. A reader that takes the channel without taking over those two responsibilities silently costs the run its Ctrl+C and paints stray characters through the pinned block, so both belong to whoever holds the channel.

### Failure signals

- A UI or command class reads the input channel through an ambient global instead of the injected terminal context.
- The subscription leaves the input channel in raw mode after it is disposed, so the shell that resumes below the block receives no echo and no interrupt.
- The decoder matches a bare `\x1b` or a single printable character as the retry key, firing on unrelated input.
- The decoder recognizes only one of the retry-key sequences, so the key works on one terminal and is silently inert on another.
- Ctrl+C stops ending the run once the input channel is in raw mode, leaving the user unable to interrupt.
- A key press echoes into the terminal, pushing the bottom-fixed block or leaving characters inside it.
- The reader attempts raw mode on an input channel that is not a terminal, failing the run instead of proceeding without key input.

### References

- [Node.js TTY docs — `readStream.setRawMode()` and its effect on `SIGINT` and echo](https://nodejs.org/api/tty.html)
- [XTerm Control Sequences — PC-style function keys and their modifier parameters](https://invisible-island.net/xterm/ctlseqs/ctlseqs.html)
