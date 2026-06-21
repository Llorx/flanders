# `update` command rules

## `update` emits skill artifacts through the same single code path as `install`

The Flanders skill artifacts that `update` rewrites are produced by the same code that `install` uses to produce them: a single function or module emits a tool's skill artifacts for a destination, and both commands invoke it. `update` carries no copy of the artifact-rendering logic. Which destinations `update` invokes it for — every existing installation it detects — and the user-facing outcome are pinned by [.spec/contracts/cli-commands/update.md](/.spec/contracts/cli-commands/update.md); this rule pins that the rendering itself has one source.

### Who this applies to

- **Subject:** the `update` command's production of skill artifacts.
- **Not subject:** the detection of which destinations to refresh and the error raised when none exists, which are the `update` contract's public behavior; and `install`, which owns the shared emission path.

### Failure signals

- `update` renders the skill artifacts through its own logic instead of the path `install` uses, so the two outputs could drift.
- A change to a skill's emitted content updates `install`'s output but not `update`'s, or the reverse.

## `update` runs without prompts: it never uses the shared prompt helper and never touches `.flanders/config.json`

`update` is non-interactive. It asks the user nothing, so it does not go through the shared prompt helper that `install` and `implement` use (see [src/commands/.spec/rules/install.md#interactive-prompts-go-through-the-shared-prompt-helper](/src/commands/.spec/rules/install.md#interactive-prompts-go-through-the-shared-prompt-helper)). It neither reads nor writes any `.flanders/config.json`: the persisted worker and reviewer configuration is left exactly as `install` last wrote it.

### Who this applies to

- **Subject:** the `update` command, on every run.
- **Not subject:** `install`, which is interactive and writes the configuration; and `implement`, which reads the configuration to run.

### Failure signals

- `update` opens an interactive prompt, through the shared helper or by any other mechanism.
- `update` reads or writes `.flanders/config.json`.
