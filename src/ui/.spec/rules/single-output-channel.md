# Single output channel per command with a live region

A command that owns a region pinned to the terminal during its run has exactly one output object responsible for that region, which is also the sole channel through which every stdout/stderr write the command produces flows. The command's own status messages, the streaming stdout and stderr of every subprocess it spawns, every error message, and the printed text of every interactive prompt all go through this single object.

This rule is complementary to [src/.spec/rules/external-access-through-contexts.md](/src/.spec/rules/external-access-through-contexts.md). That rule forbids reaching for ambient globals (`console.*`, `process.stdout.write`, `process.stderr.write`, raw `fs` writes used as output, etc.) from a class with no output context. This rule goes further: even with a properly injected output context, a command that owns a live region must consolidate all its output through one owner — not several context-injected output paths feeding the same stream.

Commands that produce only sequential, non-pinned output are not subject to this rule.

## Lifecycle

The single output owner is created as the **first action** of the command, before any argv parsing diagnostic, configuration loading, plan parsing, preflight check, or any other code path that could itself want to write to stdout/stderr. It is disposed as the **last action** of the command, immediately before the process exits.

Diagnostics that need to be emitted before "real work" begins — unknown CLI flags, missing input files, malformed configuration, preflight failures — still flow through the owner. The owner is responsible for keeping the live region present while those diagnostics scroll above it.

## What flows through the owner

- The command's own status writes (the equivalent of `console.log` from inside the command).
- The streaming stdout and stderr of every subprocess the command spawns.
- Every error message the command emits, including those produced during early validation, argv parsing, and any exception path that escapes to the top level.
- The printed text of every interactive prompt the command displays.

Reads from stdin are not covered by this rule — the rule pins the **output** channel, not input handling.

## What is exempt

- Output produced by code the command does not own (for example, output written by the runtime before `main()` is reached, or stderr from a child process that escapes the spawn handle the command does control). The rule covers what the command itself can route.
- Trace/log writes that go to files or external systems, not to stdout/stderr. They are out of scope of this rule.

## Failure signals

A change violates this rule whenever any of the following appears in command-level code:

- The command writes to stdout/stderr through more than one object — for example, a "buffered output for the block" object and a separate "early errors" object that both end up calling the same terminal context.
- A code path inside the command bypasses the owner to emit a diagnostic directly through a context method, an injected logger, or an ambient global.
- The owner is constructed lazily after the command has already produced output through some other path.
- The owner is disposed mid-run while the command still has work to do, and subsequent writes silently fall back to a direct context path.
