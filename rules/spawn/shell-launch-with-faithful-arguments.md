# Child processes are launched through a shell, with every argument escaped so the child receives the argv verbatim

The production implementation of the spawn context launches every command through a platform shell, on every operating system. Going through a shell is what lets an arbitrary tool resolve and start regardless of how it is packaged on the host: a native executable, or a script shim such as a Windows `.cmd`, `.bat`, or `.ps1` wrapper (the form npm-installed CLIs like `codex`, `claude`, and `git` take on Windows). A bare process launch that bypasses the shell cannot start those shims and fails to find the command even though it is present on `PATH`.

Because a shell re-parses the command line it is given, the implementation escapes every element of the argument array and assembles the command and its escaped arguments into a single command-line string, which it hands to the shell as the one command to run — so the child process receives exactly the argument vector the caller supplied — no word-splitting on spaces, no glob expansion, no interpretation of shell metacharacters, and no command injection. It never hands the underlying spawn primitive a separate argument array while the shell option is enabled, because that path concatenates the arguments into the command line without escaping them.

## Who this applies to

- **Subject:** the single production implementation of the `spawn` method on the spawn context interface (`ScriptContext.spawn`) — the one place that wraps Node's `child_process.spawn`. This rule pins how that implementation launches the command and how it delivers the arguments.
- **Not subject:** every call site that spawns through the context (the AI tool adapters, the `install` availability and model-list probes, the git helper, and the generic script runner). Those pass a command, an argument array, and options to the context and are unchanged by this rule — they neither opt into nor out of the shell, and they never escape arguments themselves.
- **Not subject:** test doubles of the spawn context. A stub substituted in a test records or simulates the call; it does not launch a real process and is not bound by the shell or escaping obligations.

## Behavior

1. **Always through a shell.** The implementation spawns the command with the shell enabled, on every platform — Windows, macOS, and Linux alike. There is no platform branch that disables the shell on any operating system. This is `child_process.spawn` with `shell` enabled, never a shell-less launch and never `exec`/`execFile` (those buffer output and do not give the streaming stdout/stderr and writable stdin the callers depend on).
2. **Streaming and stdin are preserved.** Enabling the shell changes only how the command is resolved and launched, not how I/O flows. The spawned handle still exposes streaming `stdout`/`stderr` and a writable `stdin`; the implementation keeps the standard streams piped so callers can read output incrementally and write to stdin (for example, a prompt delivered over stdin).
3. **Arguments are escaped, and the command line is assembled and delivered as a single command.** Each element of the argument array is quoted/escaped so that, after the shell parses the assembled command line, the child receives that element as one argument with its literal content intact. Arguments containing spaces, quotes, or shell metacharacters (for example `&`, `|`, `^`, `<`, `>`, `"`, `%`, `$`, backticks) must not split into multiple arguments, expand, or execute anything. The implementation builds the command together with its escaped arguments into one command-line string and passes that string as the sole command to the underlying spawn primitive, with an empty argument array. It never passes a non-empty argument array to the spawn primitive while the shell option is enabled: in that mode the primitive concatenates the arguments into the command line itself without escaping them — Node surfaces this as deprecation `DEP0190` — which bypasses the escaping this rule requires. The command name is launched as the program at the head of that assembled line, never concatenated unescaped with its arguments.

## Why a shell rather than a shell-less launch

A shell-less launch resolves the command by an exact-name lookup and cannot execute a script shim: on Windows it never finds `codex.cmd`/`claude.cmd` and fails with `ENOENT` even though the tool is installed. Routing through the shell delegates resolution (including the platform's executable-extension search) to the shell, so any tool starts uniformly without the launcher needing to know whether the target is a native binary or a shim. Doing it on every platform keeps a single launch path with no per-OS divergence to drift.

## Why escaping is mandatory here

Once a shell parses the command line, an unescaped argument is at the mercy of the shell's own splitting and metacharacter rules. Without escaping, an argument with a space would split into two, a `*` could glob-expand against the working directory, and a metacharacter could inject an unintended command. Escaping every argument is the condition that makes the shell launch faithful: the child sees the same argv it would have seen from a shell-less launch.

## Failure signals

- The spawn implementation launches the command without a shell on any platform, so a Windows script shim (`codex.cmd`, `claude.cmd`, `git.cmd`) fails to start with `ENOENT` even when the tool is installed.
- The implementation branches on the operating system to enable the shell on one platform and disable it on another, producing two launch paths instead of one.
- The implementation switches to `exec` or `execFile` to get shell resolution, losing streaming stdout/stderr or the writable stdin the callers rely on, or capping output at a buffer limit.
- An argument is concatenated into the shell command line without escaping, so a value containing a space, a quote, or a shell metacharacter is split, glob-expanded, or interpreted by the shell instead of reaching the child verbatim.
- The implementation passes a non-empty argument array to the underlying spawn primitive while the shell option is enabled (the `DEP0190` path), letting the primitive concatenate the arguments into the command line unescaped, instead of assembling a single pre-escaped command-line string and passing it as the sole command with an empty argument array.
- A call site is made to escape its own arguments or to choose the shell mode, instead of the single context implementation owning both.
