# `install` Command Contract

## Purpose
Configure Flanders for the chosen scope and deliver the Flanders skills (`/flanders-spec`, `/flanders-plan`, and `/flanders-work`) to the user's AI-tool environment(s) so the user can invoke them from inside an AI-tool session. This subcommand is the only way the library publishes those skills to disk and the only way it writes the persistent `.flanders/` configuration consumed by other Flanders commands.

## Invocation
    npx flanders install [scope-flag] [tool-flag ...] [model-flag ...] [effort-flag ...]

### Scope flags
- `--project` — install scope is the current working directory. Skills are written to the project's AI-tool skill folders, and the `.flanders/` configuration is written at the project root.
- `--global` — install scope is the user's home directory. Skills are written to the user-level AI-tool skill folders, and the `.flanders/` configuration is written at the user's home directory.

The scope flags are mutually exclusive; supplying both is a usage error. When neither is passed, the command prompts the user interactively to pick one of the two scopes. The interactive scope prompt is asked after the skills-tool answer is known (see `Interactive prompts`) and offers exactly those two destinations, each labelled with the concrete destination path(s) implied by the selected skills tool.

### Tool, model, and effort flags
- `--skills-tool=<value>` — which AI tool(s) the skills are installed for. Value is one of `claude`, `codex`, or `both`.
- `--worker-tool=<value>` — which AI tool the `implement` command's worker uses. Value is one of `claude` or `codex`.
- `--worker-model=<value>` — model identifier the worker tool invokes. An empty value means "use the tool's default configured model".
- `--worker-effort=<value>` — reasoning-effort identifier the worker tool invokes. An empty value means "use the tool's default configured effort".

The adversarial reviewers form an ordered list of one or more reviewers, addressed by a 1-based index. Reviewer 1 uses the unindexed flag names; every later reviewer uses the index in the flag name:
- `--reviewer-tool=<value>` / `--reviewer-N-tool=<value>` — which AI tool reviewer 1 / reviewer N uses. Value is one of `claude` or `codex`.
- `--reviewer-model=<value>` / `--reviewer-N-model=<value>` — model identifier that reviewer's tool invokes. An empty value means "use the tool's default configured model".
- `--reviewer-effort=<value>` / `--reviewer-N-effort=<value>` — reasoning-effort identifier that reviewer's tool invokes. An empty value means "use the tool's default configured effort".

`N` is an integer of `2` or greater. The reviewer indices supplied via flags must form a contiguous run starting at reviewer 1 (1, then 2, then 3, …); a gap in the indices (for example supplying `--reviewer-2-tool` without `--reviewer-tool`) is a usage error. When at least one reviewer flag is present, the flag-supplied reviewers are the complete reviewer list and the interactive "configure another reviewer?" prompt is not shown.

Any tool, model, or effort question whose answer was not supplied via flags is prompted interactively (see `Interactive prompts`). Any question whose answer was supplied via a flag is not prompted again. The questions whose values form a closed set — every tool question and the `codex` effort question — reject a flag value outside that set as a usage error. The questions whose values are open — every model question and the `claude` effort question — accept any flag value verbatim and are never rejected on value-set grounds.

## Interactive prompts
When run interactively, the command asks the following questions, in order, skipping any question whose answer was provided via flags:

1. Skills tool — `claude`, `codex`, or `both`.
2. Scope — `--project` vs `--global`. The two options are labelled with the concrete destination path(s) implied by the skills tool chosen in question 1: a `claude` skills tool labels the options with `.claude/skills/` (project) and `~/.claude/skills/` (global); a `codex` skills tool labels them with `.codex/prompts/` (project) and `~/.codex/prompts/` (global); a `both` skills tool labels each option with both of its paths. When the skills tool was supplied via `--skills-tool`, the scope prompt uses that flag's value to derive the same labels.
3. Worker tool — `claude` or `codex`.
4. Worker model — see `Model selection`.
5. Worker effort — see `Effort selection`.
6. Reviewer configuration — see `Reviewer configuration`. This collects an ordered list of one or more reviewers.

### Reviewer configuration
The command configures the adversarial reviewers as an ordered list, asked after the worker questions:

1. Reviewer 1 tool — `claude` or `codex`.
2. Reviewer 1 model — see `Model selection`.
3. Reviewer 1 effort — see `Effort selection`.
4. `Configure another reviewer?` — a yes/no question. On `yes`, the command asks the tool, model, and effort questions for the next reviewer (in the same shape as reviewer 1), then asks `Configure another reviewer?` again. On `no`, reviewer configuration ends.

The loop always configures at least reviewer 1; the `Configure another reviewer?` question is what extends the list to two or more reviewers. The reviewers are persisted in the order they were configured.

When at least one reviewer flag is present (see `Tool, model, and effort flags`), the reviewer list's length is fixed by the contiguous reviewer indices those flags supply, so the `Configure another reviewer?` question is not shown. Within that fixed list, each reviewer field still follows the same flag-versus-prompt behavior as the worker fields: a field whose flag is present is taken from the flag, and a field whose flag is absent is prompted interactively. The `Configure another reviewer?` question is shown only when no reviewer flag is present at all.

### Model selection
For each tool selected as the worker or as any reviewer, the model question is rendered as a selectable list, sourced according to the tool:
- For `codex`, the list is the set of models the tool reports as available for the user's account, plus one entry, `default configured model`, that resolves to "do not pass an explicit model and let the tool use its default". When the tool reports no such set — or when `codex` cannot be contacted at all — the question falls back to a free-text input with the placeholder `leave empty for the default configured model`, whose empty answer resolves to the same "default configured model" semantics; when `codex` could not be contacted, `install` first reports why it could not be started.
- For `claude`, the model question is a hierarchical selection rather than a single flat list. The top level offers one entry per model family, a cross-family entry that auto-picks the most capable available model, the `default configured model` entry, and a final custom entry that opens a free-text input accepting any model identifier the user types. Selecting a family opens a submenu of that family's models: its latest auto-updating alias, that alias's 1M-context variant where the family offers one, and each concrete pinned version of the family — each also with its 1M-context variant where the model offers one. The offered models are a set of suggestions, not a closed set: through the custom entry the user reaches any model Claude Code accepts but the suggestions omit.

A model identifier is always an open value: whatever the user selects — from the top-level list or from a drill-down submenu — types into the `codex` free-text fallback, or types into the `claude` custom entry is persisted verbatim. The `--worker-model`, `--reviewer-model`, and `--reviewer-N-model` flag equivalents follow the same rule: any value is accepted verbatim, and an empty value or an omitted flag answered as empty resolves to "default configured model".

### Effort selection
For each tool selected as the worker or as any reviewer, the effort question is rendered as a selectable list, sourced according to the tool:
- For `codex`, the list is the closed set of reasoning-effort levels the tool documents, plus one entry, `default configured effort`, that resolves to "do not pass an explicit effort and let the tool use its default". This set is closed: the only valid effort values for `codex` are the documented levels and the empty "default configured effort".
- For `claude`, the list is a curated set of the reasoning-effort levels Claude Code is known to accept, plus `default configured effort`, plus a final custom entry that opens a free-text input accepting any effort identifier the user types. The curated set is a set of suggestions, not a closed set: through the custom entry the user reaches any effort level the curated set omits, so any effort value is valid for `claude`.

The `--worker-effort`, `--reviewer-effort`, and `--reviewer-N-effort` flag equivalents follow the same rule per tool: for `claude` any value is accepted verbatim; for `codex` only a documented level or an empty value is accepted, and a value outside that closed set is a usage error. An empty value or an omitted flag answered as empty resolves to "default configured effort".

## Skills produced
For each AI tool the user picked for skills, the command writes one skill artifact per Flanders skill (`/flanders-spec`, `/flanders-plan`, `/flanders-work`) into that tool's skill folder for the selected scope:
- Claude Code skills are written to `.claude/skills/` (project scope) or `~/.claude/skills/` (global scope), in the directory-plus-`SKILL.md` form Claude Code requires for user-installed skills.
- Codex CLI prompts are written to `.codex/prompts/` (project scope) or `~/.codex/prompts/` (global scope), in the form Codex CLI requires for user-installed prompts.

When `--skills-tool=both` is selected (or the interactive answer is `both`), the artifacts for both tools are written, each into its own tool-specific folder.

The textual obligations a user sees when invoking a skill are pinned by the contract files in `.docs/contracts/ai-skills/`. The internal form of each skill artifact (frontmatter fields, body shape) is an implementation detail; what is pinned is that after a successful `install` run the user is able to invoke `/flanders-spec`, `/flanders-plan`, and `/flanders-work` from inside an AI-tool session of each selected tool whose skills root is the chosen scope.

## Configuration written
The command writes the persistent Flanders configuration at the chosen scope, as defined in [.docs/contracts/shared/flanders-config.md](/.docs/contracts/shared/flanders-config.md). Only the answers downstream Flanders commands consume are persisted (worker tool, model, and effort; and, for each reviewer in the configured order, its tool, model, and effort). The skills-tool answer is consumed by `install` itself to decide which skill folders to write into and is not persisted to `.flanders/`.

## Overwrite behavior
Existing files at the destination paths — both skill artifacts and `.flanders/` configuration files — are overwritten silently. The command does not back up, version, or prompt about pre-existing files. Preserving prior versions is the user's responsibility, typically through version control.

## Output
On success, the command prints to standard output the list of files it wrote, one path per line. Each path identifies an installed skill artifact or a configuration file unambiguously. The list is exhaustive — every file the command created or overwrote, including the configuration files inside `.flanders/`, is included.

## Errors
- `--global` and `--project` supplied together: exits non-zero with a diagnostic naming the conflict.
- A flag for a closed-set question — any tool flag, or the `codex` effort flag — is supplied with a value outside that closed set: exits non-zero with a diagnostic that names the offending flag and value. Model flags and the `claude` effort flag are open and never trigger this error.
- Reviewer index flags do not form a contiguous run starting at reviewer 1 (for example a `--reviewer-2-*` flag is supplied without any reviewer-1 flag): exits non-zero with a diagnostic that names the gap.
- Destination folder cannot be created or written to (permissions, read-only filesystem, etc.): exits non-zero with a diagnostic that names the offending path.
- Unable to produce a skill artifact (e.g., the source content for a skill is missing): exits non-zero with a diagnostic that names the affected skill.

## Out of scope
- The exact internal contents of each skill artifact (frontmatter fields, body shape) are implementation choices and are not pinned by this contract. What is pinned is that after a successful `install` run, the user is able to invoke `/flanders-spec`, `/flanders-plan`, and `/flanders-work` from inside an AI-tool session of each selected tool whose skills root is the chosen scope.
- The exact file names, directory layout, and serialization format inside `.flanders/` are implementation choices. The location per scope, the set of fields persisted, and the read-time precedence are pinned in [.docs/contracts/shared/flanders-config.md](/.docs/contracts/shared/flanders-config.md).
- Uninstallation: this contract does not define a `flanders uninstall` subcommand. The user removes installed skills and the `.flanders/` folder manually if needed.
