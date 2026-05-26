# `install` Command Contract

## Purpose
Configure Flanders for the chosen scope and deliver the Flanders skills (`/flanders-spec` and `/flanders-plan`) to the user's AI-tool environment(s) so the user can invoke them from inside an AI-tool session. This subcommand is the only way the library publishes those skills to disk and the only way it writes the persistent `.flanders/` configuration consumed by other Flanders commands.

## Invocation
    npx flanders install [scope-flag] [tool-flag ...] [model-flag ...]

### Scope flags
- `--project` — install scope is the current working directory. Skills are written to the project's AI-tool skill folders, and the `.flanders/` configuration is written at the project root.
- `--global` — install scope is the user's home directory. Skills are written to the user-level AI-tool skill folders, and the `.flanders/` configuration is written at the user's home directory.

The scope flags are mutually exclusive; supplying both is a usage error. When neither is passed, the command prompts the user interactively to pick one of the two scopes. The interactive prompt offers exactly those two destinations.

### Tool and model flags
- `--skills-tool=<value>` — which AI tool(s) the skills are installed for. Value is one of `claude`, `codex`, or `both`.
- `--worker-tool=<value>` — which AI tool the `implement` command's worker uses. Value is one of `claude` or `codex`.
- `--worker-model=<value>` — model identifier the worker tool invokes. An empty value means "use the tool's default configured model".
- `--reviewer-tool=<value>` — which AI tool the `implement` command's adversarial reviewer uses. Value is one of `claude` or `codex`.
- `--reviewer-model=<value>` — model identifier the reviewer tool invokes. An empty value means "use the tool's default configured model".

Any tool or model question whose answer was not supplied via flags is prompted interactively (see `Interactive prompts`). Any question whose answer was supplied via a flag is not prompted again. A flag value that does not match one of the allowed values for its question is a usage error.

## Interactive prompts
When run interactively, the command asks the following questions, in order, skipping any question whose answer was provided via flags:

1. Scope — `--project` vs `--global`.
2. Skills tool — `claude`, `codex`, or `both`.
3. Worker tool — `claude` or `codex`.
4. Worker model — see `Model selection`.
5. Reviewer tool — `claude` or `codex`.
6. Reviewer model — see `Model selection`.

### Model selection
For each tool selected as the worker or as the reviewer, the model question is rendered according to the tool's CLI capabilities:
- When the tool's CLI exposes a list of available models, the question is rendered as a selectable list of those models with one additional entry, `default configured model`, that resolves to "do not pass an explicit model and let the tool use its default".
- When the tool's CLI does not expose a list of available models, the question is rendered as a free-text input with the placeholder `leave empty for the default configured model`. An empty answer resolves to the same "default configured model" semantics.

The `--worker-model` and `--reviewer-model` flag equivalents follow the same rule: an empty value or an omitted flag answered as empty resolves to "default configured model".

## Tool availability check
Before writing any file, the command verifies that each AI tool selected by the user's answers (for skills, worker, or reviewer) has its CLI available on `PATH`. If any selected tool's CLI is missing, the command exits non-zero with a diagnostic that names every missing tool. Nothing is written to disk in that case — no skill files, no `.flanders/` configuration.

## Skills produced
For each AI tool the user picked for skills, the command writes one skill artifact per Flanders skill (`/flanders-spec`, `/flanders-plan`) into that tool's skill folder for the selected scope:
- Claude Code skills are written to `.claude/skills/` (project scope) or `~/.claude/skills/` (global scope), in the directory-plus-`SKILL.md` form Claude Code requires for user-installed skills.
- Codex CLI prompts are written to `.codex/prompts/` (project scope) or `~/.codex/prompts/` (global scope), in the form Codex CLI requires for user-installed prompts.

When `--skills-tool=both` is selected (or the interactive answer is `both`), the artifacts for both tools are written, each into its own tool-specific folder.

The textual obligations a user sees when invoking a skill are pinned by the contract files in `contracts/ai-skills/`. The internal form of each skill artifact (frontmatter fields, body shape) is an implementation detail; what is pinned is that after a successful `install` run the user is able to invoke `/flanders-spec` and `/flanders-plan` from inside an AI-tool session of each selected tool whose skills root is the chosen scope.

## Configuration written
The command writes the persistent Flanders configuration at the chosen scope, as defined in `shared/flanders-config.md`. Only the answers downstream Flanders commands consume are persisted (worker tool and model, reviewer tool and model). The skills-tool answer is consumed by `install` itself to decide which skill folders to write into and is not persisted to `.flanders/`.

## Overwrite behavior
Existing files at the destination paths — both skill artifacts and `.flanders/` configuration files — are overwritten silently. The command does not back up, version, or prompt about pre-existing files. Preserving prior versions is the user's responsibility, typically through version control.

## Output
On success, the command prints to standard output the list of files it wrote, one path per line. Each path identifies an installed skill artifact or a configuration file unambiguously. The list is exhaustive — every file the command created or overwrote, including the configuration files inside `.flanders/`, is included.

## Errors
- `--global` and `--project` supplied together: exits non-zero with a diagnostic naming the conflict.
- A tool or model flag is supplied with a value that does not match one of the allowed values for its question: exits non-zero with a diagnostic that names the offending flag and value.
- A selected AI tool's CLI is not available on `PATH`: exits non-zero with a diagnostic that names every missing tool. No file is written.
- Destination folder cannot be created or written to (permissions, read-only filesystem, etc.): exits non-zero with a diagnostic that names the offending path.
- Unable to produce a skill artifact (e.g., the source content for a skill is missing): exits non-zero with a diagnostic that names the affected skill.

## Out of scope
- The exact internal contents of each skill artifact (frontmatter fields, body shape) are implementation choices and are not pinned by this contract. What is pinned is that after a successful `install` run, the user is able to invoke `/flanders-spec` and `/flanders-plan` from inside an AI-tool session of each selected tool whose skills root is the chosen scope.
- The exact file names, directory layout, and serialization format inside `.flanders/` are implementation choices. The location per scope, the set of fields persisted, and the read-time precedence are pinned in `shared/flanders-config.md`.
- Uninstallation: this contract does not define a `flanders uninstall` subcommand. The user removes installed skills and the `.flanders/` folder manually if needed.
