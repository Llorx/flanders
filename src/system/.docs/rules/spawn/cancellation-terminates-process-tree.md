# Killing a spawned process terminates its whole process tree

When a command is launched through a shell (per [src/system/.docs/rules/spawn/shell-launch-with-faithful-arguments.md](/src/system/.docs/rules/spawn/shell-launch-with-faithful-arguments.md)), the shell is the immediate child and the actual tool runs as a descendant of it. On every platform there is at least one intermediate process between the spawn handle and the program doing the work — the shell, and on Windows additionally the script shim that re-launches the real runtime. The production spawn implementation must therefore terminate the entire process tree when its kill operation is invoked, not just the immediate shell process.

This is what preserves the cancellation guarantee the AI runner depends on: that when an invocation is aborted, the underlying tool process does not outlive the call (see [src/ai/.docs/rules/runner/tool-interface.md](/src/ai/.docs/rules/runner/tool-interface.md) and [src/ai/.docs/rules/runner/codex-invocation.md](/src/ai/.docs/rules/runner/codex-invocation.md)). If killing the handle reached only the intermediate shell, the real tool could keep running, keep holding the working tree, and keep consuming resources after the runner believed the call was over.

## Who this applies to

- **Subject:** the single production implementation of the spawn context interface (`ScriptContext.spawn`) — specifically the part that creates the child and the part that handles a kill request on the returned handle. The implementation arranges, at spawn time, for the launched command to belong to a terminable group, and on a kill request it signals the whole group/tree.
- **Not subject:** the call sites that request cancellation (the AI tool adapters and any other consumer). They call the handle's kill with the termination signal they choose; they do not enumerate or signal descendant processes themselves. The obligation to reach the whole tree lives in the spawn implementation that owns the child.
- **Not subject:** test doubles of the spawn context, which simulate the kill rather than terminating real processes.

## Behavior

1. **The launched command is made terminable as a group.** At spawn time the implementation sets up the child so that the program and every descendant the shell starts can be terminated together — a detached process group on POSIX, and on Windows a mechanism that terminates the launched process together with all of its descendants.
2. **A kill targets the tree, not just the immediate child.** When the handle's kill is invoked, the implementation delivers the termination to the entire group/tree (the shell, the script shim, and the real tool), so no descendant survives the kill.
3. **The cancellation contract still holds.** After the kill, the launched tool process has terminated, satisfying the "child must not outlive the call" guarantee the adapters rely on through this handle.

## Why the whole tree

A shell launch always inserts an intermediate process, and a kill that stops only that intermediate can orphan the real tool, which keeps running detached. Terminating the group/tree is the only way to guarantee that aborting an invocation actually stops the work — the intermediate process is an implementation detail of how the command is launched, and the caller's intent ("stop this tool") must reach the tool regardless of how many processes sit in between.

## Failure signals

- The kill stops only the immediate shell process, leaving the real tool running as an orphan after cancellation.
- The spawn implementation does not set up a terminable group/tree at spawn time, so there is no way to reach descendants when the kill arrives.
- A call site is made responsible for discovering and signalling descendant processes, instead of the spawn implementation delivering a whole-tree termination through the handle's kill.
