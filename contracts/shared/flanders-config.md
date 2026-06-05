# Flanders Configuration Folder Contract

## Purpose
Define the persistent Flanders configuration surface — the `.flanders/` folder — that the `install` command writes (see `cli-commands/install.md`) and that other Flanders commands (currently `implement`) read.

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
- The ordered list of adversarial reviewers the `implement` command runs. The list holds one or more reviewers, in the order the user configured them, and each reviewer carries its own three fields:
  - The AI tool that reviewer uses: one of `claude` or `codex`.
  - The model identifier that reviewer's tool invokes, or the explicit marker "default configured model" when none was supplied.
  - The reasoning-effort identifier that reviewer's tool invokes, or the explicit marker "default configured effort" when none was supplied.

All these fields are persisted on every successful `install` run. The reviewer list always contains at least one reviewer. Install-time-only answers (such as the skills-tool selection) are not persisted, because no downstream command consumes them.

## Precedence at read time
When a Flanders command reads the configuration, it resolves it as follows:
1. If a `.flanders/` folder exists at the project scope (project root), the command uses that configuration. The global-scope `.flanders/` is fully ignored for this run, even if it would have supplied missing fields.
2. Otherwise, if a `.flanders/` folder exists at the global scope (`~/.flanders/`), the command uses that configuration.
3. Otherwise, the command treats the configuration as missing. Commands that require configuration (such as `implement`) fail with a diagnostic pointing the user at `npx flanders install` — see the per-command contracts for the exact failure mode.

There is no field-by-field merge between scopes.

## Overwrite
The folder is overwritten silently by every successful `install` run at the same scope. Preserving prior contents is the user's responsibility, typically through version control.

## Out of scope
The exact file names, directory layout, and serialization format inside `.flanders/` are implementation choices and are not pinned by this contract. What is pinned is the location per scope, the set of fields persisted, and the read-time precedence.
