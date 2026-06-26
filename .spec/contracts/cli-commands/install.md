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
- `--skills-tool=<value>` — which AI tool(s) the skills are installed for. The value is a comma-separated list of one or more distinct names drawn from `claude`, `codex`, and `antigravity` (for example `claude`, `codex,antigravity`, or `claude,codex,antigravity`). The skills are installed for every tool the list names.
- `--worker-tool=<value>` — which AI tool the `implement` command's worker uses. Value is one of `claude`, `codex`, or `antigravity`.
- `--worker-model=<value>` — model identifier the worker tool invokes. An empty value means "use the tool's default configured model".
- `--worker-effort=<value>` — reasoning-effort identifier the worker tool invokes. An empty value means "use the tool's default configured effort".

The adversarial reviewers form an ordered list of one or more reviewers, addressed by a 1-based index. Reviewer 1 uses the unindexed flag names; every later reviewer uses the index in the flag name:
- `--reviewer-tool=<value>` / `--reviewer-N-tool=<value>` — which AI tool reviewer 1 / reviewer N uses. Value is one of `claude`, `codex`, or `antigravity`.
- `--reviewer-model=<value>` / `--reviewer-N-model=<value>` — model identifier that reviewer's tool invokes. An empty value means "use the tool's default configured model".
- `--reviewer-effort=<value>` / `--reviewer-N-effort=<value>` — reasoning-effort identifier that reviewer's tool invokes. An empty value means "use the tool's default configured effort".

`N` is an integer of `2` or greater. The reviewer indices supplied via the tool, model, and effort flags must form a contiguous run starting at reviewer 1 (1, then 2, then 3, …); a gap in the indices (for example supplying `--reviewer-2-tool` without `--reviewer-tool`) is a usage error. For the purpose of fixing the reviewer-list length and skipping the interactive "configure another reviewer?" prompt, a reviewer flag means a `--reviewer[-N]-tool`, `--reviewer[-N]-model`, or `--reviewer[-N]-effort` flag; when at least one of these is present, the flag-supplied reviewers are the complete reviewer list and the "configure another reviewer?" prompt is not shown.

The reviewers also carry a weighted-review configuration, addressed by the same 1-based index, that is only meaningful for a list of two or more reviewers:
- `--reviewer-optional` / `--reviewer-N-optional` — marks reviewer 1 / reviewer N as an optional reviewer. These are presence flags: supplying one marks that reviewer optional, and a reviewer with no such flag is required. They annotate reviewers within the list established by the tool, model, and effort flags above; they do not themselves establish or extend the list. A `--reviewer-N-optional` whose index exceeds the established reviewer-list length is a usage error.
- `--reviewer-minimum=<value>` — the minimum number of reviewers that must run to a verdict in each review round (see [.spec/contracts/cli-commands/implement/iteration-loop.md](/.spec/contracts/cli-commands/implement/iteration-loop.md)). The value must be an integer between `1` and the number of configured reviewers, inclusive.

Supplying any weighted-review flag (`--reviewer-minimum` or any `--reviewer[-N]-optional`) with a single-reviewer configuration is a usage error. Supplying `--reviewer-minimum` with a value equal to the number of configured reviewers together with any `--reviewer[-N]-optional` flag is also a usage error: a minimum equal to the reviewer count forces every reviewer to run to a verdict, so no reviewer can be optional.

Any tool, model, or effort question whose answer was not supplied via flags is prompted interactively (see `Interactive prompts`). Any question whose answer was supplied via a flag is not prompted again. The questions whose values form a closed set — every tool question, the `codex` effort question, and the `antigravity` effort question — reject a flag value outside that set as a usage error; for an `antigravity` tool the only valid effort value is the empty default, so any non-empty effort flag is a usage error, and `--skills-tool` accepts only a comma-separated list of distinct names drawn from the closed tool set. The questions whose values are open — every model question and the `claude` effort question — accept any flag value verbatim and are never rejected on value-set grounds.

## Interactive prompts
When run interactively, the command asks the following questions, in order, skipping any question whose answer was provided via flags:

1. Skills tool — a selection of one or more of `claude`, `codex`, and `antigravity` (any non-empty subset).
2. Scope — `--project` vs `--global`. The two options are labelled with the concrete destination path(s) implied by the skills tools chosen in question 1: `claude` contributes `.claude/skills/` (project) and `~/.claude/skills/` (global); `codex` contributes `.codex/prompts/` (project) and `~/.codex/prompts/` (global); `antigravity` contributes `.agents/skills/` (project) and `~/.gemini/antigravity-cli/skills/` (global). Each option is labelled with the destination path of every tool the skills-tool selection names. When the skills tools were supplied via `--skills-tool`, the scope prompt uses that flag's value to derive the same labels.
3. Worker tool — `claude`, `codex`, or `antigravity`.
4. Worker model — see `Model selection`.
5. Worker effort — see `Effort selection`.
6. Reviewer configuration — see `Reviewer configuration`. This collects an ordered list of one or more reviewers, and, when two or more reviewers are configured, the weighted-review configuration (see `Weighted-review configuration`).

### Reviewer configuration
The command configures the adversarial reviewers as an ordered list, asked after the worker questions:

1. Reviewer 1 tool — `claude`, `codex`, or `antigravity`.
2. Reviewer 1 model — see `Model selection`.
3. Reviewer 1 effort — see `Effort selection`.
4. `Configure another reviewer?` — a yes/no question. On `yes`, the command asks the tool, model, and effort questions for the next reviewer (in the same shape as reviewer 1), then asks `Configure another reviewer?` again. On `no`, reviewer configuration ends.

The loop always configures at least reviewer 1; the `Configure another reviewer?` question is what extends the list to two or more reviewers. The reviewers are persisted in the order they were configured.

When at least one reviewer flag is present (see `Tool, model, and effort flags`), the reviewer list's length is fixed by the contiguous reviewer indices those flags supply, so the `Configure another reviewer?` question is not shown. Within that fixed list, each reviewer field still follows the same flag-versus-prompt behavior as the worker fields: a field whose flag is present is taken from the flag, and a field whose flag is absent is prompted interactively. The `Configure another reviewer?` question is shown only when no reviewer flag is present at all.

#### Weighted-review configuration
Once the reviewer list is established, and only when it holds two or more reviewers, the command collects the weighted-review configuration directly — there is no gate question that asks whether to configure it. It collects, in this order:

1. The minimum number of reviewers that must run to a verdict in each review round, as a free-text numeric entry whose default — an empty entry — is the reviewer-list length `T`. A non-empty entry is accepted only when it is an integer between `1` and `T` inclusive; an entry that is non-numeric, below `1`, or above `T` is re-prompted, showing the valid range, until a valid integer or an empty entry is given.
2. For each reviewer, in configured order, whether that reviewer is optional, as a yes/no question with `no` (required) as the default — but only when the chosen minimum is below `T`. A minimum equal to `T` forces every reviewer to run to a verdict, so no reviewer can be optional: the per-reviewer optional questions are not asked and every reviewer is required. Each per-reviewer optional question identifies the reviewer it concerns by that reviewer's 1-based position in the list together with that reviewer's tool, model, and effort — for example, `reviewer 2 (claude · opus-4.8 · high)`. When that reviewer's model resolves to the tool's default (an empty model value), the question shows the `default configured model` wording in place of the model; likewise, when that reviewer's effort resolves to the tool's default (an empty effort value), the question shows the `default configured effort` wording in place of the effort. The question explains what marking the reviewer optional means, so the user understands the single consequence of the choice: an optional reviewer reviews exactly like a required one, and the only effect of optionality is that the round abandons the reviewer while it is waiting out a usage limit (rate limit) — once every required reviewer has produced a verdict and the configured minimum is met — instead of waiting that usage-limit wait out (see [.spec/contracts/cli-commands/implement/iteration-loop.md](/.spec/contracts/cli-commands/implement/iteration-loop.md)). A required reviewer's usage-limit wait is always waited out.

The defaults reproduce a run where no reviewer is ever cancelled: the minimum equal to the number of reviewers and every reviewer required. Because the default minimum equals `T`, accepting it (an empty entry) skips the per-reviewer optional questions altogether and persists every reviewer as required; the optional questions appear only when the user lowers the minimum below `T`. The minimum and the per-reviewer optional flags follow the same flag-versus-prompt behavior as every other answer, pinned in [src/commands/.spec/rules/install.md#the-weighted-review-configuration-is-collected-only-when-the-reviewer-list-has-two-or-more-reviewers](/src/commands/.spec/rules/install.md#the-weighted-review-configuration-is-collected-only-when-the-reviewer-list-has-two-or-more-reviewers). When the reviewer list holds a single reviewer, this section is not shown: that reviewer is required and the minimum is `1`.

### Model selection
For each tool selected as the worker or as any reviewer, the model question is rendered according to the tool:
- For `codex`, the list is the set of models the tool reports as available for the user's account, plus one entry, `default configured model`, that resolves to "do not pass an explicit model and let the tool use its default". When the tool reports no such set — or when `codex` cannot be contacted at all — the question falls back to a free-text input with the placeholder `leave empty for the default configured model`, whose empty answer resolves to the same "default configured model" semantics; when `codex` could not be contacted, `install` first reports why it could not be started.
- For `claude`, the model question is a hierarchical selection rather than a single flat list. The top level offers one entry per model family, a cross-family entry that auto-picks the most capable available model, the `default configured model` entry, and a final custom entry that opens a free-text input accepting any model identifier the user types. Selecting a family opens a submenu of that family's models: its latest auto-updating alias, that alias's 1M-context variant where the family offers one, and each concrete pinned version of the family — each also with its 1M-context variant where the model offers one. The offered models are a set of suggestions, not a closed set: through the custom entry the user reaches any model Claude Code accepts but the suggestions omit.
- For `antigravity`, the model question is a hierarchical selection like the `claude` one, grouped by model provider rather than by model family. The top level offers one entry per provider, the `default configured model` entry, and a final custom entry that opens a free-text input accepting any model identifier the user types. Selecting a provider opens a submenu of that provider's models. The offered models are a set of suggestions, not a closed set: through the custom entry the user reaches any model the Antigravity CLI accepts but the suggestions omit.

A model identifier is always an open value: whatever the user selects — from a top-level list or from a drill-down submenu — types into the `codex` free-text fallback, or types into the `claude` or `antigravity` custom entry is persisted verbatim. The `--worker-model`, `--reviewer-model`, and `--reviewer-N-model` flag equivalents follow the same rule: any value is accepted verbatim, and an empty value or an omitted flag answered as empty resolves to "default configured model".

### Effort selection
For each tool selected as the worker or as any reviewer, the effort question is rendered according to the tool:
- For `codex`, the list is the closed set of reasoning-effort levels the tool documents, plus one entry, `default configured effort`, that resolves to "do not pass an explicit effort and let the tool use its default". This set is closed: the only valid effort values for `codex` are the documented levels and the empty "default configured effort".
- For `claude`, the list is a curated set of the reasoning-effort levels Claude Code is known to accept, plus `default configured effort`, plus a final custom entry that opens a free-text input accepting any effort identifier the user types. The curated set is a set of suggestions, not a closed set: through the custom entry the user reaches any effort level the curated set omits, so any effort value is valid for `claude`.
- For `antigravity`, the Antigravity CLI exposes no reasoning-effort setting, so no effort question is asked; the persisted effort is always the empty `default configured effort`.

The `--worker-effort`, `--reviewer-effort`, and `--reviewer-N-effort` flag equivalents follow the same rule per tool: for `claude` any value is accepted verbatim; for `codex` only a documented level or an empty value is accepted, and a value outside that closed set is a usage error; for `antigravity` only an empty value is accepted, and any non-empty value is a usage error because the tool exposes no effort setting. An empty value or an omitted flag answered as empty resolves to "default configured effort".

## Pre-selection from an existing configuration
After the scope is chosen (`Interactive prompts` question 2), the command reads the `.flanders/config.json` file at that chosen scope — the same file a successful run writes (see `Configuration written`) — and seeds the interactive defaults of the questions asked afterward from its stored answers. The read targets the chosen scope's file directly: it does not consult the other scope and does not apply the read-time precedence that commands consuming the configuration to run follow (see [.spec/contracts/shared/flanders-config.md](/.spec/contracts/shared/flanders-config.md)).

The read is lenient. When no `.flanders/config.json` exists at the chosen scope, or the file exists but is malformed or unreadable, the command proceeds with its fresh-install defaults and pre-selects nothing — a malformed pre-existing configuration is repaired by completing the run, which overwrites it, so this read never aborts the command. This leniency is specific to this pre-selection read; a command that consumes the configuration to run still treats a malformed file as a hard error.

When a valid `.flanders/config.json` is read, every interactively-asked question whose answer that file stores is pre-selected to the stored value, and that value is the question's default — the answer taken when the user accepts the prompt without changing it. The stored answers and the questions they seed are the worker tool, model, and effort; the reviewer list — its length and, for each reviewer in order, that reviewer's tool, model, effort, and whether it is optional; and the minimum number of reviewers. The reviewer-list length is reproduced by seeding the `Configure another reviewer?` question so that accepting every default rebuilds a list of the stored length. The per-question defaults stated above in `Reviewer configuration`, `Model selection`, `Effort selection`, and `Weighted-review configuration` — for example, the minimum defaulting to the reviewer-list length and each reviewer defaulting to required — are the defaults used when no configuration is read; a read configuration replaces each of them with its stored value.

The skills-tool answer and the scope are not stored in `.flanders/config.json` (see `Configuration written`) and are therefore never pre-selected from it; both are answered as on a fresh run. A flag still takes precedence over any pre-selected default: a question answered by a flag is not asked, and its answer is the flag's value, not the stored value.

Accepting every pre-selected default — pressing through the configuration-derived questions without changing any answer — reproduces the stored configuration exactly, so a re-run at the same scope that changes nothing writes back the same `.flanders/config.json`. A question pre-selects a stored answer only when that answer is still among the options the question currently offers. Every question other than the `codex` model question can always offer its stored value: the `claude` model question, the `antigravity` model question, and the `claude` effort question through their custom entry, the tool questions and the `codex` effort question because a stored value there is always a member of their fixed set, and the minimum through its free-text entry. The `codex` model question offers the models the probe currently returns plus `default configured model`; a stored `codex` model the probe no longer returns is not among its options, so that one question is presented without a pre-selected default and is answered actively, while every other question still reproduces its stored answer.

## Skills produced
For each AI tool the user picked for skills, the command writes one skill artifact per Flanders skill (`/flanders-spec`, `/flanders-plan`, `/flanders-work`) into that tool's skill folder for the selected scope:
- Claude Code skills are written to `.claude/skills/` (project scope) or `~/.claude/skills/` (global scope), in the directory-plus-`SKILL.md` form Claude Code requires for user-installed skills.
- Codex CLI prompts are written to `.codex/prompts/` (project scope) or `~/.codex/prompts/` (global scope), in the form Codex CLI requires for user-installed prompts.
- Antigravity CLI skills are written to `.agents/skills/` (project scope) or `~/.gemini/antigravity-cli/skills/` (global scope), in the directory-plus-`SKILL.md` form Antigravity CLI requires for user-installed skills.

When the skills-tool selection names more than one tool, the artifacts for every named tool are written, each into its own tool-specific folder.

The textual obligations a user sees when invoking a skill are pinned by the contract files in `.spec/contracts/ai-skills/`. The internal form of each skill artifact (frontmatter fields, body shape) is an implementation detail; what is pinned is that after a successful `install` run the user is able to invoke `/flanders-spec`, `/flanders-plan`, and `/flanders-work` from inside an AI-tool session of each selected tool whose skills root is the chosen scope.

## Configuration written
The command writes the persistent Flanders configuration at the chosen scope, as defined in [.spec/contracts/shared/flanders-config.md](/.spec/contracts/shared/flanders-config.md). Only the answers downstream Flanders commands consume are persisted (worker tool, model, and effort; for each reviewer in the configured order, its tool, model, effort, and whether it is optional; and the minimum number of reviewers that must run to a verdict in each review round). The skills-tool answer is consumed by `install` itself to decide which skill folders to write into and is not persisted to `.flanders/`.

## Overwrite behavior
Existing files at the destination paths — both skill artifacts and `.flanders/` configuration files — are overwritten silently. The command does not back up, version, or prompt about pre-existing files. Preserving prior versions is the user's responsibility, typically through version control.

## Output
On success, the command prints to standard output the list of files it wrote, one path per line. Each path identifies an installed skill artifact or a configuration file unambiguously. The list is exhaustive — every file the command created or overwrote, including the configuration files inside `.flanders/`, is included.

## Voice
The command's interactive prompts and its own status writes carry the Flanders voice defined in [.spec/contracts/shared/flanders-voice.md](/.spec/contracts/shared/flanders-voice.md). The voice seasons that prose only; the printed file paths, the flag names, and every flag value are reported exactly as they are, untouched by the flavor.

## Errors
- `--global` and `--project` supplied together: exits non-zero with a diagnostic naming the conflict.
- A single-valued tool flag (`--worker-tool`, `--reviewer-tool`, or `--reviewer-N-tool`), the `codex` effort flag, or the `antigravity` effort flag is supplied with a value outside its closed set: exits non-zero with a diagnostic that names the offending flag and value. For an `antigravity` tool the only valid effort value is empty, so any non-empty `--worker-effort`/`--reviewer-effort`/`--reviewer-N-effort` is rejected. Model flags and the `claude` effort flag are open and never trigger this error.
- `--skills-tool` is supplied with a value that is not a comma-separated list of one or more distinct names drawn from `claude`, `codex`, and `antigravity` (an empty list, an unknown name, or a repeated name): exits non-zero with a diagnostic that names the offending value.
- Reviewer index flags do not form a contiguous run starting at reviewer 1 (for example a `--reviewer-2-tool`/`-model`/`-effort` flag is supplied without any reviewer-1 flag): exits non-zero with a diagnostic that names the gap.
- A weighted-review flag (`--reviewer-minimum` or any `--reviewer[-N]-optional`) is supplied with a single-reviewer configuration: exits non-zero with a diagnostic that names the offending flag.
- `--reviewer-minimum` equal to the number of configured reviewers is supplied together with any `--reviewer[-N]-optional` flag: exits non-zero with a diagnostic that names the conflict, because a minimum equal to the reviewer count leaves no reviewer that can be optional.
- `--reviewer-minimum` is supplied with a value that is not an integer between `1` and the number of configured reviewers, inclusive: exits non-zero with a diagnostic that names the flag and the offending value.
- A `--reviewer-N-optional` flag references an index beyond the configured reviewer list: exits non-zero with a diagnostic that names the offending index.
- Destination folder cannot be created or written to (permissions, read-only filesystem, etc.): exits non-zero with a diagnostic that names the offending path.
- Unable to produce a skill artifact (e.g., the source content for a skill is missing): exits non-zero with a diagnostic that names the affected skill.

## Out of scope
- The exact internal contents of each skill artifact (frontmatter fields, body shape) are implementation choices and are not pinned by this contract. What is pinned is that after a successful `install` run, the user is able to invoke `/flanders-spec`, `/flanders-plan`, and `/flanders-work` from inside an AI-tool session of each selected tool whose skills root is the chosen scope.
- The exact file names, directory layout, and serialization format inside `.flanders/` are implementation choices. The location per scope, the set of fields persisted, and the read-time precedence are pinned in [.spec/contracts/shared/flanders-config.md](/.spec/contracts/shared/flanders-config.md).
- Uninstallation: this contract does not define a `flanders uninstall` subcommand. The user removes installed skills and the `.flanders/` folder manually if needed.
