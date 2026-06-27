# Flanders Configuration Folder Contract

## Purpose
Define the persistent Flanders configuration surface — the `.flanders/` folder — that the `install` command writes (see [.spec/contracts/cli-commands/install.md](/.spec/contracts/cli-commands/install.md)), that other Flanders commands (currently `implement`) read to run, and that `install` itself reads at the chosen scope to pre-select its interactive defaults.

## Location per scope
Flanders persists its configuration at a fixed location per scope:
- **Project scope.** The folder is `.flanders/` at the project root (the current working directory at the time `install` was invoked with project scope).
- **Global scope.** The folder is `.flanders/` at the user's home directory (`~/.flanders/`).

The scope is chosen at install time and is the same scope under which the skill artifacts are written.

## Fields persisted
The folder persists the answers the user supplied to the `install` command that downstream Flanders commands need at run time:
- The AI tool the `implement` command's worker uses: one of `claude` or `codex`.
- The model identifier the worker tool invokes, or the explicit marker "default configured model" when none was supplied.
- The reasoning-effort identifier the worker tool invokes, or the explicit marker "default configured effort" when none was supplied.
- Whether the worker runs with Claude Code's fast mode enabled. Fast mode is a higher-speed, higher-cost configuration that is enabled only for a worker whose tool is `claude` and whose model supports fast mode; for every other worker it is off.
- The ordered list of adversarial reviewers the `implement` command runs. The list holds one or more reviewers, in the order the user configured them, and each reviewer carries its own four fields:
  - The AI tool that reviewer uses: one of `claude` or `codex`.
  - The model identifier that reviewer's tool invokes, or the explicit marker "default configured model" when none was supplied.
  - The reasoning-effort identifier that reviewer's tool invokes, or the explicit marker "default configured effort" when none was supplied.
  - Whether that reviewer runs with Claude Code's fast mode enabled, under the same condition as the worker: enabled only for a reviewer whose tool is `claude` and whose model supports fast mode, and off otherwise.
  - Whether the reviewer is optional: a reviewer marked optional may be cancelled before it finishes once its review round can complete without it, while a reviewer not marked optional (required) always runs to a verdict and is never cancelled. See [.spec/contracts/cli-commands/implement/iteration-loop.md](/.spec/contracts/cli-commands/implement/iteration-loop.md).
- The minimum number of reviewers that must run to a verdict in each review round. It is at least `1` and at most the number of configured reviewers, and it is `1` when the reviewer list holds a single reviewer. When it equals the number of configured reviewers, every reviewer is required and none is optional, because a minimum equal to the reviewer count leaves no reviewer that can be cancelled.

All these fields are persisted on every successful `install` run. The reviewer list always contains at least one reviewer. When the user does not customize the weighted-review configuration — or when the list holds a single reviewer — every reviewer is persisted as required and the minimum equals the number of reviewers, which reproduces a run where no reviewer is ever cancelled. Install-time-only answers (such as the skills-tool selection) are not persisted, because no downstream command consumes them.

## Precedence at read time
When a Flanders command reads the configuration, it resolves it as follows:
1. If a `.flanders/` folder exists at the project scope (project root), the command uses that configuration. The global-scope `.flanders/` is fully ignored for this run, even if it would have supplied missing fields.
2. Otherwise, if a `.flanders/` folder exists at the global scope (`~/.flanders/`), the command uses that configuration.
3. Otherwise, the command treats the configuration as missing. Commands that require configuration (such as `implement`) fail with a diagnostic pointing the user at `npx flanders install` — see the per-command contracts for the exact failure mode.

There is no field-by-field merge between scopes.

This precedence governs a command that reads the configuration to run (today, `implement`). The `install` command also reads a `.flanders/config.json` — the one at the scope it is about to write — to pre-select its interactive defaults (see [.spec/contracts/cli-commands/install.md#pre-selection-from-an-existing-configuration](/.spec/contracts/cli-commands/install.md#pre-selection-from-an-existing-configuration)); that read targets the chosen scope's file directly, does not apply this precedence, and treats an absent or malformed file leniently — falling back to fresh defaults — rather than as a hard error.

## Overwrite
The folder is overwritten silently by every successful `install` run at the same scope. Preserving prior contents is the user's responsibility, typically through version control.

## Out of scope
The exact file names, directory layout, and serialization format inside `.flanders/` are implementation choices and are not pinned by this contract. What is pinned is the location per scope, the set of fields persisted, and the read-time precedence.
