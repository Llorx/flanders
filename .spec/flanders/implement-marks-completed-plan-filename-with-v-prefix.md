# `implement` marks a completed plan's filename with a `V-` prefix

## When `implement` accepts the last open task and the plan becomes complete, it prepends `V-` to the plan filename

When the `implement` command accepts the last open task of a plan — so that no unchecked task remains — it renames the plan file by prepending the literal marker `V-` to the left of the file's current name, so a plan file named `<name>` becomes `V-<name>`. The marker sits at the very start of the name, ahead of every other part of it, including the generation-timestamp prefix that `/flanders-plan` wrote (see [.spec/flanders/flanders-plan-filenames-carry-generation-timestamp-prefix.md](/.spec/flanders/flanders-plan-filenames-carry-generation-timestamp-prefix.md)). The completed plan's filename begins with exactly one `V-`.

The completion rename itself — that on finishing the plan the file is renamed to mark it complete, and that this happens as the run finalizes the task that completes the plan — is the public behavior pinned in [.spec/contracts/cli-commands/implement/iteration-loop.md](/.spec/contracts/cli-commands/implement/iteration-loop.md) and authorized in [.spec/contracts/shared/spec-folder-write-authority.md § Authority](/.spec/contracts/shared/spec-folder-write-authority.md#authority); this behavior rule pins the concrete marker the rename uses.

This is a behavior rule in the sense pinned by [.spec/contracts/shared/flanders-behavior-rules.md](/.spec/contracts/shared/flanders-behavior-rules.md): it constrains how the `implement` command (see [.spec/contracts/cli-commands/implement/overview.md](/.spec/contracts/cli-commands/implement/overview.md)) names the plan file it leaves behind, not the host project's own code.

### Who this applies to

- **Subject:** the `implement` command, on a run whose iteration loop accepts the last open task so that the plan becomes fully complete. That run prepends the `V-` marker to the plan file's name as it finalizes that task.
- **Not subject:** a run that ends without bringing the plan to completion — a hard stop, or any run that leaves at least one open task — leaves the plan filename unmarked; the `/flanders-plan` skill, which originates the plan filename without the marker; and a plan that `implement` finds already fully complete at startup, whose filename that run leaves unchanged.

### Why

Placing the marker at the far left of the name makes a completed plan visually and lexically distinct from plans still in progress, so a glance at the `plans/` folder separates the done from the pending. Putting it ahead of the timestamp prefix groups all completed plans together under the marker rather than interleaving them by date among the open ones.

### Failure signals

- A run that accepts the last open task of a plan yet leaves the plan filename without a leading `V-`.
- A completed plan filename that carries the marker more than once, or that places it anywhere other than the very start of the name.
- A run that prepends the marker to a plan it did not bring to completion, or to a plan that was already fully complete at startup.
