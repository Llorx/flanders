# Install command rules

## Interactive prompts go through the shared prompt helper

Every interactive question `install` asks the user — skills tool, scope, worker tool, worker model, worker effort, worker fast, and, for each reviewer in the configured list, that reviewer's tool, model, effort, and fast, plus the `Configure another reviewer?` question that extends the reviewer list, and, when two or more reviewers are configured, the minimum-reviews question and the per-reviewer optional questions (see [src/commands/.spec/rules/install.md#the-weighted-review-configuration-is-collected-only-when-the-reviewer-list-has-two-or-more-reviewers](/src/commands/.spec/rules/install.md#the-weighted-review-configuration-is-collected-only-when-the-reviewer-list-has-two-or-more-reviewers)) — goes through the same prompt helper that `implement` uses for its plan-selection question. The `Configure another reviewer?` question and each fast question are single-selects (yes/no) rendered through the helper's single-select function like every other bounded choice. There is one prompt helper for the whole library, and every interactive prompt across every command goes through it.

### Who this applies to

- **Subject:** every Flanders command that prompts the user interactively. Today that is `install` (all the questions listed above) and `implement` (its plan-selection prompt when `plans/` has more than one file).
- **Not subject:** ad-hoc one-off prompts inside subagents or other code paths the user does not directly interact with. Subagents do not prompt the user; they exit and surface what they need.

### What "the shared prompt helper" means

The helper is a single module exporting at minimum:

- A **single-select** function that takes an array of selectable entries and renders them as a numbered or arrow-navigable list, returning the chosen entry. It accepts an optional default entry — the entry pre-highlighted as the initial selection — which is the entry returned when the user accepts the list without moving off it.
- A **free-text** function that takes an optional placeholder string and returns the user's typed answer (empty string when the user just presses Enter). It accepts an optional default value: when one is supplied, pressing Enter on an unedited input returns that default instead of the empty string.
- A **multi-select** function that takes an array of selectable entries and renders them as a list on which the user toggles any subset, returning the chosen entries; it enforces at least one selection. It accepts an optional set of pre-selected entries — the entries toggled on as the initial state — which are the entries returned when the user accepts the list without changing it. The skills-tool question (where the user picks one or more AI tools to install the skills for) is rendered through this function.

Both functions accept the question text as input and render it consistently across commands: same prefix style, same color (if any), same handling of Ctrl+C (abort the command with a non-zero exit and a short diagnostic).

The helper lives in one file and is imported by every prompting command. A second implementation of single-select, multi-select, or free-text behavior elsewhere in the codebase is a violation of this rule, even if functionally equivalent.

### Dependency policy

The helper is implemented on top of Node.js's standard library — `node:readline`, `node:tty`, `node:process` — and any internal Flanders utility code. It does not introduce a production dependency, per [.spec/rules/dependencies/no-production-dependencies.md](/.spec/rules/dependencies/no-production-dependencies.md). If the helper grows beyond what stdlib can reasonably support, the right move is to drop the affected ergonomic feature, not to add a runtime dependency.

### Non-TTY behavior

When stdin is not a TTY, the helper does not attempt to render an interactive list. It either:

1. Falls back to a deterministic read-from-stdin mode that consumes one answer per question in the order the command would have asked them; or
2. Refuses to run and exits non-zero with a diagnostic that asks the user to either re-run interactively or supply all flag-driven answers.

Which of the two is implemented is a choice the helper pins for the whole library; both are consistent with this rule as long as the same behavior holds for every prompting command. Mixing the two — one command falls back to stdin, another refuses — is a violation.

### Failure signals

- A command opens its own `readline` interface or reads from stdin directly instead of going through the helper, even for "just one quick prompt".
- A command uses a different prompt library (third-party or hand-rolled) for one or more of its questions.
- The helper's behavior diverges between commands — for example, Ctrl+C aborts in `install` but not in `implement`, or the list rendering uses different styles in the two commands.
- The helper adds a production dependency to satisfy a UX feature.
- A subagent prompts the user through the helper or through any other mechanism. Subagents are not interactive; they exit and surface what they need.

## A flag-supplied answer skips its interactive prompt

When the user supplies a flag whose value answers one of the install questions, the corresponding interactive prompt is not shown. The flag value is taken as the user's answer for that question. Questions whose answers come through different flags are independent: supplying `--worker-tool=claude` does not skip the worker model question; only `--worker-model=...` does.

### Who this applies to

- **Subject:** the `install` command, while it collects answers and before it writes any file.
- **Not subject:** subagents or any other command. No other command in Flanders today has flag-driven answers; if a future command grows them, the same mechanic applies but is pinned by that command's own rule, not by this one.

### Mapping flag → question

The mapping between flags pinned by [.spec/contracts/cli-commands/install.md](/.spec/contracts/cli-commands/install.md) and the interactive questions they answer is:

| Flag | Question it answers |
|------|---------------------|
| `--project` or `--global` | Scope |
| `--skills-tool=<value>` | Skills tool |
| `--worker-tool=<value>` | Worker tool |
| `--worker-model=<value>` | Worker model |
| `--worker-effort=<value>` | Worker effort |
| `--worker-fast` | Worker fast |
| `--reviewer-tool=<value>` | Reviewer 1 tool |
| `--reviewer-model=<value>` | Reviewer 1 model |
| `--reviewer-effort=<value>` | Reviewer 1 effort |
| `--reviewer-N-tool=<value>` | Reviewer N tool (N ≥ 2) |
| `--reviewer-N-model=<value>` | Reviewer N model (N ≥ 2) |
| `--reviewer-N-effort=<value>` | Reviewer N effort (N ≥ 2) |
| `--reviewer-fast` / `--reviewer-N-fast` | Whether reviewer 1 / reviewer N runs with fast mode |
| `--reviewer-optional` / `--reviewer-N-optional` | Whether reviewer 1 / reviewer N is optional |
| `--reviewer-minimum=<value>` | Minimum reviewers that must run to a verdict |

Any question whose flag is not present in the command line is asked interactively in the order pinned by the contract. Any question whose flag is present is recorded with the flag's value and not asked.

### Reviewer flags fix the reviewer-list length and skip the "configure another reviewer?" prompt

The reviewers are an ordered list addressed by 1-based index per [.spec/contracts/cli-commands/install.md](/.spec/contracts/cli-commands/install.md). When at least one reviewer flag (`--reviewer-tool/-model/-effort` or any `--reviewer-N-tool/-model/-effort`) is present, the presence of those flags answers the `Configure another reviewer?` question: the reviewer-list length is fixed by the contiguous reviewer indices the flags supply, and the `Configure another reviewer?` prompt is therefore not shown. Within that fixed list, each individual reviewer field still follows the same per-field skip as every other question — a field whose flag is present is recorded from the flag, a field whose flag is absent is asked interactively. When no reviewer flag is present at all, the `Configure another reviewer?` prompt is shown and drives the list length interactively. The weighted-review flags (`--reviewer[-N]-optional`, `--reviewer-minimum`) do not participate in this list-length determination; they annotate the established list.

### Weighted-review flags

The weighted-review configuration — the per-reviewer `optional` flag and `--reviewer-minimum` — is only meaningful for a list of two or more reviewers (see [src/commands/.spec/rules/install.md#the-weighted-review-configuration-is-collected-only-when-the-reviewer-list-has-two-or-more-reviewers](/src/commands/.spec/rules/install.md#the-weighted-review-configuration-is-collected-only-when-the-reviewer-list-has-two-or-more-reviewers)). Supplying any weighted-review flag with a single-reviewer configuration is a usage error pinned by the install contract.

- **`--reviewer-minimum`** follows the same per-field skip as every other question: present → recorded (validated to an integer in `[1, T]`, where `T` is the reviewer-list length); absent → the minimum question is asked interactively for a two-or-more-reviewer list.
- **`--reviewer[-N]-optional`** are presence flags, so they are skipped as a group rather than per field, and they are meaningful only when the chosen minimum is below `T` (the reviewer-list length). A `--reviewer-minimum` equal to `T`, or an interactive minimum of `T`, forces every reviewer required, so no per-reviewer optional question is asked when the minimum equals `T`, and supplying any `--reviewer[-N]-optional` together with a `--reviewer-minimum` equal to `T` is a usage error pinned by the install contract. When the chosen minimum is below `T`: when at least one optional flag is present, optionality is taken entirely from the flags — every reviewer named by a flag is optional and every other reviewer is required — and the per-reviewer optional questions are not asked; when none is present, the per-reviewer optional questions are asked interactively for a two-or-more-reviewer list. A `--reviewer-N-optional` whose index exceeds the reviewer-list length is a usage error.

### Empty values are valid answers

For `--worker-model`, `--worker-effort`, `--reviewer-model`, `--reviewer-effort`, and their indexed forms `--reviewer-N-model`, `--reviewer-N-effort`, an empty value is a valid answer that resolves to `""` in `.flanders/config.json` per [src/workspace/.spec/rules/flanders-config/file-format.md](/src/workspace/.spec/rules/flanders-config/file-format.md). An empty value is therefore distinct from "flag not supplied":

- Flag not supplied → the question is asked interactively.
- Flag supplied with an empty value (for example `--worker-model=`) → the question is not asked; the persisted value is `""` ("default configured model"/"default configured effort").

The set of valid values is closed for the single-valued tool flags — `--worker-tool`, `--reviewer-tool`, `--reviewer-N-tool` — and for the effort flags when the tool they apply to is `codex`: for `codex`, `--worker-effort` / `--reviewer-effort` / `--reviewer-N-effort` validate against Codex's documented effort set. The `--skills-tool` flag's value is a comma-separated list of one or more distinct names drawn from the closed tool set `claude`, `codex`. A supplied value outside a closed set is a usage error pinned by the install contract, and this rule does not relax that. By contrast, the model flags (`--worker-model`, `--reviewer-model`, `--reviewer-N-model`) for every tool, and the effort flags when the tool they apply to is `claude`, are open: they accept any value verbatim and are never rejected on value-set grounds (see [.spec/contracts/cli-commands/install.md](/.spec/contracts/cli-commands/install.md)).

### Order of validation

Flag-value validation runs before any interactive prompt is shown. A flag with an invalid value causes `install` to exit non-zero with a diagnostic naming the flag and the offending value, before asking any other question. The user does not get half-way through the interactive flow only to discover that an earlier flag was malformed.

### Failure signals

- A flag is supplied with a valid value and the question it answers is still shown to the user interactively.
- A flag is supplied with an invalid value and the command starts the interactive flow instead of exiting with a usage error.
- A flag's value is ignored and the interactive answer overrides it.
- The empty-value semantics differ between flag and interactive: for example, leaving the model question empty interactively persists `""`, but `--worker-model=` either errors or persists something else.
- The flag-driven skip silently overrides the contract's prompt order — for example, `--reviewer-tool=claude` is supplied but the worker tool question is rendered after the reviewer tool question instead of before it. The contract's order is fixed even when some questions are skipped.
- A model flag value, or a `claude` effort flag value, that is not among the curated suggestions is rejected as a usage error instead of being accepted verbatim.

## The model list is sourced per tool: codex by probe, claude from a hand-maintained catalog

When `install` asks the user for a model identifier for the worker or the reviewer, the suggested models are sourced from the selected tool. For `codex`, `install` queries the tool's CLI for the models available to the user's account. For `claude`, whose CLI exposes no models-listing command, `install` presents a hand-maintained catalog of the models Claude Code is known to accept. The contract [.spec/contracts/cli-commands/install.md](/.spec/contracts/cli-commands/install.md) pins the user-visible shape of each rendering; this rule pins, per tool, where the suggestions come from and how each path persists its value.

### Who this applies to

- **Subject:** the `install` command, during each model question (worker model and reviewer model).
- **Not subject:** any later Flanders command. Models persisted in `.flanders/config.json` are passed through as opaque strings; no later command re-derives the available models.

### Per-tool model source

- **`codex`** — `install` queries the tool's CLI for the model list. The probe is a specific subprocess invocation that runs at most once per tool per `install` run, even if the same tool is asked about twice (worker and reviewer); the result is cached for the second question. The invocation is `codex debug models` (no `--bundled`, so the catalog is refreshed for the user's account rather than read from the binary's bundled snapshot). The probe captures the launched process's stdout and stderr rather than streaming them to the user's terminal.

  When the launched process completes, the probe **first** tries to interpret the captured stdout as the model catalog, before it consults the exit code or any command-not-found signal: it parses stdout as JSON and checks that it has the shape `{"models":[{"slug":"…","visibility":"…"}, …]}` — an object whose `models` is an array of entries, each carrying a string `slug` and a string `visibility`. When stdout is a catalog of that shape, the probe accepts it on its own terms, regardless of the exit code: the list is the `slug` of every entry whose `visibility` is `"list"`, in catalog order; entries with any other `visibility` (for example `"hide"`, used for internal models) are excluded, mirroring Codex's own `/model` picker. A catalog of that shape with at least one `"list"`-visible entry yields the list; a catalog of that shape with no `"list"`-visible entry means `codex` ran and exposed an empty catalog, and `install` falls back to free-text silently. Because a catalog is accepted on the strength of its shape, a `"list"`-visible model is never reinterpreted as a start failure when not-found-like prose appears elsewhere inside the payload (for example inside instruction or description strings the JSON carries).

  Only when the captured stdout is **not** a usable catalog of that shape — it does not parse as JSON, or it parses but lacks the expected shape, or the process produced no output because it could not be launched — does the probe then classify the failure to decide how `install` falls back to free-text model entry, and how it does so depends on whether `codex` could be started:

  - **`codex` could not be started** — the spawn primitive raised an error before the process ran, or the launched command was reported not found (exit status 127 on a POSIX shell; the not-found diagnostic the host shell emits for an absent command otherwise). `install` surfaces why — the captured stderr, or the captured stdout when stderr is empty, or the spawn primitive's error message when neither produced output, never the bare exit code or signal on its own — then falls back to free-text.
  - **`codex` started but exposed no usable list** — `codex` ran and the probe obtained no list-visible models: a catalog of the expected shape with no `"list"`-visible entry, or a payload that does not parse or lacks the expected shape yet carries no command-not-found signal (for example a future Codex CLI that no longer provides `codex debug models` and reports an unknown subcommand). `install` falls back to free-text silently, because `codex` is present and simply offers no list. If a future Codex CLI removes `codex debug models`, this rule must be updated to pin the replacement command.
- **`claude`** — the Claude Code CLI exposes no command that lists models, so `install` does not probe it. Instead, `install` presents a hand-maintained catalog of the model identifiers Claude Code documents for its `--model` selection. Each catalog entry has a human-readable display label and the value persisted when it is chosen; the value is persisted verbatim. The catalog is organized into one group per model family, plus a group of cross-family aliases.

  Each **family group** lists the family's auto-updating "Latest" alias(es) first — which auto-update to the recommended version over time and persist the alias string — followed by the family's pinned-version identifiers, each pinning a specific release and persisting the full model identifier. A `[1m context]` entry names the 1M-context variant of a model that supports one; Claude Code accepts the `[1m]` suffix appended to a full model name as well as to an alias, and the suffix is offered only for a model that supports a 1M-context window.

  **Opus**

  | Display label | Persisted value |
  |---|---|
  | `Latest Opus` | `opus` |
  | `Latest Opus [1m context]` | `opus[1m]` |
  | `Opus 4.8` | `claude-opus-4-8` |
  | `Opus 4.8 [1m context]` | `claude-opus-4-8[1m]` |
  | `Opus 4.7` | `claude-opus-4-7` |
  | `Opus 4.7 [1m context]` | `claude-opus-4-7[1m]` |
  | `Opus 4.6` | `claude-opus-4-6` |
  | `Opus 4.6 [1m context]` | `claude-opus-4-6[1m]` |

  **Sonnet**

  | Display label | Persisted value |
  |---|---|
  | `Latest Sonnet` | `sonnet` |
  | `Latest Sonnet [1m context]` | `sonnet[1m]` |
  | `Sonnet 4.6` | `claude-sonnet-4-6` |
  | `Sonnet 4.6 [1m context]` | `claude-sonnet-4-6[1m]` |
  | `Sonnet 4.5` | `claude-sonnet-4-5` |
  | `Sonnet 4.5 [1m context]` | `claude-sonnet-4-5[1m]` |

  **Haiku**

  | Display label | Persisted value |
  |---|---|
  | `Latest Haiku` | `haiku` |
  | `Haiku 4.5` | `claude-haiku-4-5-20251001` |

  **Fable**

  | Display label | Persisted value |
  |---|---|
  | `Latest Fable` | `fable` |
  | `Fable 5` | `claude-fable-5` |

  **Cross-family aliases** — aliases that do not belong to a single model family; each persists the alias string. The `default` alias is not in the catalog, because the synthetic `default configured model` entry already covers it.

  | Display label | Persisted value |
  |---|---|
  | `Best (auto-pick)` | `best` |

  The catalog is a set of suggestions, not a closed set; the user reaches any model Claude Code accepts but the catalog omits through the custom entry pinned in [src/commands/.spec/rules/install.md#claudes-model-and-effort-lists-include-a-custom-value-entry](/src/commands/.spec/rules/install.md#claudes-model-and-effort-lists-include-a-custom-value-entry). When Claude Code documents new `--model` aliases or model versions, or retires a listed one, this rule is updated to track that change.

### Rendering the question

- For **`codex`**, when the probe yields a non-empty list, the question is rendered as a selectable list whose entries are the model identifiers the probe returned, plus one synthetic entry at the end labelled `default configured model`. When the probe yields an empty list, is skipped, or fails, the question is rendered as a free-text input with the placeholder `leave empty for the default configured model`.
- For **`claude`**, the question is rendered as the family-grouped two-tier menu pinned in [src/commands/.spec/rules/install.md#the-claude-model-question-groups-models-by-family-a-family-entry-at-the-top-each-opening-a-submenu-of-that-familys-models](/src/commands/.spec/rules/install.md#the-claude-model-question-groups-models-by-family-a-family-entry-at-the-top-each-opening-a-submenu-of-that-familys-models): each model family is a top-level entry that opens a submenu of that family's catalog entries (its "Latest" alias(es) and its pinned versions), the cross-family alias is a top-level direct selection, plus the synthetic `default configured model` entry, plus the custom entry pinned in [src/commands/.spec/rules/install.md#claudes-model-and-effort-lists-include-a-custom-value-entry](/src/commands/.spec/rules/install.md#claudes-model-and-effort-lists-include-a-custom-value-entry).
Picking the synthetic `default configured model` entry resolves to the empty string `""` when persisted in `.flanders/config.json` per [src/workspace/.spec/rules/flanders-config/file-format.md](/src/workspace/.spec/rules/flanders-config/file-format.md). Leaving the `codex` free-text input empty resolves to the same `""`.

### Equivalence between selecting and typing

The available paths never produce different persisted values for the same user intent: picking `default configured model`, leaving the `codex` free-text input empty, and leaving the `claude` custom input empty all resolve to `""`. Picking a specific model identifier — by selecting a top-level entry, by selecting a `claude` family-submenu entry, or by typing it into the `codex` free-text fallback — persists the exact identifier string the entry maps to or the user typed, with no trimming, no case folding, no further validation. The `claude` custom entry is a further path whose persistence is pinned in [src/commands/.spec/rules/install.md#claudes-model-and-effort-lists-include-a-custom-value-entry](/src/commands/.spec/rules/install.md#claudes-model-and-effort-lists-include-a-custom-value-entry).

### Failure signals

- For a **probed** tool (`codex`), `install` ships a hardcoded list of model identifiers instead of querying the tool, ignoring the user's actual subscription / authorization.
- `install` runs the `codex` probe more than once per tool per run.
- The probe streams the tool's stdout or stderr to the user's terminal during model collection, polluting the install UI.
- A list selection and a typed value persist different values for the same user intent (for example, persisting the literal string `"default configured model"` instead of the empty string).
- `install` proceeds to persist a model identifier the user did not actually select (for example, defaulting to the first entry of the list when the user did not pick one).
- When `codex` could not be started (spawn failure or command-not-found), the probe falls back to free-text **silently**, or reports only the bare exit code, instead of surfacing the captured stderr (or stdout when stderr is empty, or the spawn primitive's error message).
- The `codex` probe aborts `install`, or emits a noisy diagnostic, when `codex` started but genuinely exposes no list (a clean empty catalog), instead of falling back to free-text silently.
- The probe consults the exit code or scans for a command-not-found phrase before validating the captured stdout as a catalog, so a correctly-shaped model catalog is misclassified as `codex could not be started` — or otherwise diverted from being parsed into the list — because a not-found phrase appears inside the payload's own data, for example embedded prose in an instruction or description string the JSON carries.

## Effort levels are sourced per tool from each CLI's documented levels

When `install` asks the user for a reasoning-effort level for the worker or the reviewer, the effort levels are sourced from the levels the selected tool's CLI documents. Effort is not discovered through a subprocess probe — each tool's set is documented by its CLI and is hardcoded against that documentation. The contract [.spec/contracts/cli-commands/install.md](/.spec/contracts/cli-commands/install.md) pins the user-visible shape of each rendering; this rule pins, per tool, which set is presented, whether the set is closed, and how each path persists its value.

### Who this applies to

- **Subject:** the `install` command, during each effort question (worker effort and reviewer effort).
- **Not subject:** any later Flanders command. Effort levels persisted in `.flanders/config.json` are passed through as opaque strings; no later command re-derives the available set.

### Per-tool effort sets

- **`codex`** — the effort levels Codex CLI documents are `minimal`, `low`, `medium`, `high`, `xhigh`. `xhigh` is model-dependent but remains in the list — `install` does not pre-filter by model. This set is **closed**: the only valid effort values for `codex` are these documented levels and the empty "default configured effort".
- **`claude`** — the effort levels Claude Code documents for its `--effort` selection are `low`, `medium`, `high`, `xhigh`, `max`. `xhigh` and `max` are model-dependent but remain in the list — `install` does not pre-filter by model. The `ultracode` entry Claude Code's effort menu offers is not in the set, because it is a Claude Code session setting rather than a value the `--effort` flag accepts. This set is **open**: the documented levels are suggestions, and the user reaches any effort value Claude Code accepts but the set omits through the custom entry pinned in [src/commands/.spec/rules/install.md#claudes-model-and-effort-lists-include-a-custom-value-entry](/src/commands/.spec/rules/install.md#claudes-model-and-effort-lists-include-a-custom-value-entry).
### Rendering the question

- For **`codex`**, the question is rendered as a selectable list whose entries are the closed documented set above, plus one synthetic entry at the end labelled `default configured effort`.
- For **`claude`**, the question is rendered as a selectable list whose entries are the documented set above, plus the synthetic `default configured effort` entry, plus the custom entry pinned in [src/commands/.spec/rules/install.md#claudes-model-and-effort-lists-include-a-custom-value-entry](/src/commands/.spec/rules/install.md#claudes-model-and-effort-lists-include-a-custom-value-entry).
Picking the synthetic `default configured effort` entry resolves to the empty string `""` when persisted in `.flanders/config.json` per [src/workspace/.spec/rules/flanders-config/file-format.md](/src/workspace/.spec/rules/flanders-config/file-format.md).

### Equivalence between selecting and typing

The available paths never produce different persisted values for the same user intent: picking `default configured effort` resolves to `""`. Picking a specific effort level by selecting a list entry persists the exact level string the user selected, with no trimming, no case folding, no further validation. The `claude` custom entry is a further path whose persistence is pinned in [src/commands/.spec/rules/install.md#claudes-model-and-effort-lists-include-a-custom-value-entry](/src/commands/.spec/rules/install.md#claudes-model-and-effort-lists-include-a-custom-value-entry).

### Failure signals

- `install` ships a `codex` effort set that diverges from what Codex CLI documents, or a `claude` effort set that diverges from what Claude Code documents, instead of tracking that documentation.
- A list selection and a typed value persist different values for the same user intent (for example, persisting the literal string `"default configured effort"` instead of the empty string).
- `install` proceeds to persist an effort level the user did not actually select (for example, defaulting to the first entry of the list when the user did not pick one).
- `install` pre-filters the effort list by the chosen model, dropping `xhigh` or `max` when it judges the model unsupported, instead of presenting the full documented set.
- `install` includes `ultracode` in the `claude` effort set, even though it is not a value the `--effort` flag accepts.

## Fast mode is offered only for a claude role whose model supports it

After the effort question for the worker or a reviewer, `install` asks whether that role runs with Claude Code's fast mode enabled — but only when the role's tool is `claude` and its selected model is one that supports fast mode. Fast mode is Claude Code's higher-speed, higher-cost configuration; its persisted value is the `fast` boolean pinned in [src/workspace/.spec/rules/flanders-config/file-format.md](/src/workspace/.spec/rules/flanders-config/file-format.md), and the runner consumes it per [src/ai/.spec/rules/runner.md#the-claude-adapter-spawns-claude---print---output-format-stream-json-and-maps-its-events-to-the-tool-interface](/src/ai/.spec/rules/runner.md#the-claude-adapter-spawns-claude---print---output-format-stream-json-and-maps-its-events-to-the-tool-interface). The contract [.spec/contracts/cli-commands/install.md](/.spec/contracts/cli-commands/install.md) pins the user-visible shape; this rule pins which models qualify, how the question is rendered, and how each path persists its value.

### Who this applies to

- **Subject:** the `install` command, on the fast question for the worker and for each reviewer.
- **Not subject:** any later Flanders command — the persisted `fast` boolean is consumed opaquely by the AI runner and no later command re-derives which models support fast mode. The `codex` and `antigravity` roles are also not subject: their tools have no fast mode, so their `fast` is always `false` and no fast question is asked for them.

### Which models support fast mode

A model supports fast mode when its persisted model identifier is one of: `opus`, `opus[1m]`, `claude-opus-4-8`, `claude-opus-4-8[1m]`, `claude-opus-4-7`, `claude-opus-4-7[1m]`.

These are the Opus 4.8 and Opus 4.7 entries of the `claude` catalog pinned in [src/commands/.spec/rules/install.md#the-model-list-is-sourced-per-tool-codex-by-probe-claude-from-a-hand-maintained-catalog](/src/commands/.spec/rules/install.md#the-model-list-is-sourced-per-tool-codex-by-probe-claude-from-a-hand-maintained-catalog): the auto-updating `Latest Opus` alias, which resolves to a fast-capable Opus, the pinned Opus 4.8 and Opus 4.7 identifiers, and each one's 1M-context variant. No other `claude` model identifier supports fast mode: not the `Best (auto-pick)` cross-family alias, not Opus 4.6 or any earlier Opus, not any Sonnet, Haiku, or Fable model, not a custom-typed identifier the catalog does not list, and not the empty `default configured model`. When Claude Code changes which models support fast mode — for example when fast mode for Opus 4.7 is removed — this rule is updated to track that change.

### When the question is asked, and its default

The fast question is asked for a role only when both hold: the role's tool is `claude`, and the role's selected model — the value resolved from that role's model question, whether picked from the catalog menu or typed into the custom entry (see [src/commands/.spec/rules/install.md#claudes-model-and-effort-lists-include-a-custom-value-entry](/src/commands/.spec/rules/install.md#claudes-model-and-effort-lists-include-a-custom-value-entry)) — is one of the fast-supporting identifiers above. The question is a yes/no single-select rendered through the shared prompt helper (see [src/commands/.spec/rules/install.md#interactive-prompts-go-through-the-shared-prompt-helper](/src/commands/.spec/rules/install.md#interactive-prompts-go-through-the-shared-prompt-helper)), and its default is `no` — fast mode off — because fast mode bills at a higher rate. Selecting yes persists `fast` as `true`; selecting no persists it as `false`.

For every role whose fast question is not asked — a `codex` or `antigravity` role, or a `claude` role whose model does not support fast mode — `fast` is persisted as `false` without asking.

### Flag behavior

The `--worker-fast`, `--reviewer-fast`, and `--reviewer-N-fast` flags are presence flags. When the flag for a role is present, that role's fast question is not asked and its `fast` is recorded as `true`; when absent, the role takes the interactive outcome (asked when the model supports fast mode, `false` otherwise). Supplying a fast flag for a role whose tool is not `claude`, or whose resolved model does not support fast mode, is a usage error pinned by the install contract; a `--reviewer-N-fast` whose index exceeds the reviewer-list length is a usage error pinned by the install contract. The fast flags annotate roles within the reviewer list established by the tool, model, and effort flags; they do not establish or extend that list (the list-length determination is pinned in [src/commands/.spec/rules/install.md#reviewer-flags-fix-the-reviewer-list-length-and-skip-the-configure-another-reviewer-prompt](/src/commands/.spec/rules/install.md#reviewer-flags-fix-the-reviewer-list-length-and-skip-the-configure-another-reviewer-prompt)).

### Failure signals

- `install` asks the fast question for a `codex` or `antigravity` role, or for a `claude` role whose model does not support fast mode.
- `install` does not ask the fast question for a `claude` role whose model does support fast mode.
- `install` persists `fast` as `true` for a role whose tool is not `claude`, or whose model does not support fast mode.
- The fast question defaults to `yes` instead of `no`.
- `install` accepts a `--worker-fast` / `--reviewer[-N]-fast` flag for a role whose tool is not `claude` or whose model does not support fast mode, instead of exiting with a usage error.
- `install` treats a fast flag as fixing or extending the reviewer-list length.

## Claude's model and effort lists include a custom value entry

The selectable list `install` shows for the `claude` model question and the one it shows for the `claude` effort question each end with a custom entry placed after the synthetic `default configured …` entry. Selecting the custom entry opens a free-text input through which the user types any identifier the tool accepts; the typed value becomes that question's answer. This is what lets the user choose a `claude` model or effort that the curated suggestion lists do not enumerate.

### Who this applies to

- **Subject:** the `install` command, on exactly two questions — the `claude` worker/reviewer model question and the `claude` worker/reviewer effort question.
- **Not subject:** the `codex` model question and the `codex` effort question, which carry no custom entry — the `codex` model list is the authoritative set the probe returns plus `default configured model`, and the `codex` effort set is the closed documented set plus `default configured effort` (see [src/commands/.spec/rules/install.md#the-model-list-is-sourced-per-tool-codex-by-probe-claude-from-a-hand-maintained-catalog](/src/commands/.spec/rules/install.md#the-model-list-is-sourced-per-tool-codex-by-probe-claude-from-a-hand-maintained-catalog) and [src/commands/.spec/rules/install.md#effort-levels-are-sourced-per-tool-from-each-clis-documented-levels](/src/commands/.spec/rules/install.md#effort-levels-are-sourced-per-tool-from-each-clis-documented-levels)). Any later Flanders command is also not subject: the custom entry exists only at install time.

### The custom entry

On each of these three questions, the selectable list is ordered as: the curated suggestion entries, then the synthetic `default configured model` / `default configured effort` entry, then the custom entry as the final entry. The custom entry is labelled so the user understands it opens a free-text input (for example, `enter a custom value…`).

Selecting the custom entry opens a free-text input rendered through the shared prompt helper's free-text function (see [src/commands/.spec/rules/install.md#interactive-prompts-go-through-the-shared-prompt-helper](/src/commands/.spec/rules/install.md#interactive-prompts-go-through-the-shared-prompt-helper)). The value the user types in that input is the question's answer.

### Persistence of the typed value

The typed value is persisted verbatim — no trimming, no case folding, and no validation against the curated suggestions — identically to selecting a list entry. An empty typed value resolves to the empty string `""` in `.flanders/config.json` per [src/workspace/.spec/rules/flanders-config/file-format.md](/src/workspace/.spec/rules/flanders-config/file-format.md), which is the same "default configured model" / "default configured effort" semantics as picking the synthetic default entry. Selecting a curated entry and selecting the synthetic default entry are pinned in [src/commands/.spec/rules/install.md#the-model-list-is-sourced-per-tool-codex-by-probe-claude-from-a-hand-maintained-catalog](/src/commands/.spec/rules/install.md#the-model-list-is-sourced-per-tool-codex-by-probe-claude-from-a-hand-maintained-catalog) and [src/commands/.spec/rules/install.md#effort-levels-are-sourced-per-tool-from-each-clis-documented-levels](/src/commands/.spec/rules/install.md#effort-levels-are-sourced-per-tool-from-each-clis-documented-levels).

### Failure signals

- A `claude` model or effort question is rendered as a plain selectable list with no custom entry, trapping the user in the curated suggestions.
- The custom entry is offered on a `codex` question.
- Selecting the custom entry does not open a free-text input, or opens one but discards the typed value.
- The typed value is validated against the curated suggestions and rejected when it is not among them, instead of being accepted verbatim.
- The custom entry is placed before the curated suggestions or before the synthetic `default configured …` entry instead of as the final entry.

## The claude model question groups models by family: a family entry at the top, each opening a submenu of that family's models

When `install` asks the user for a `claude` model identifier (for the worker or any reviewer), the question is a two-tier menu. The top level offers one entry per model family, the cross-family alias entry, the default entry, and the custom entry; selecting a family opens a submenu listing that family's models — its auto-updating "Latest" alias(es) and its pinned versions. This rule pins how that menu is laid out and navigated. The set of entries each level draws from, and the value each entry persists, are pinned in [src/commands/.spec/rules/install.md#the-model-list-is-sourced-per-tool-codex-by-probe-claude-from-a-hand-maintained-catalog](/src/commands/.spec/rules/install.md#the-model-list-is-sourced-per-tool-codex-by-probe-claude-from-a-hand-maintained-catalog); this rule does not redefine them.

### Who this applies to

- **Subject:** the `install` command, on the `claude` model question only — the worker model question and each reviewer model question when the tool is `claude`.
- **Not subject:** the `codex` model question (a flat probe-sourced list or a free-text fallback), which uses no grouped menu; every effort question, which is unaffected; and any later Flanders command, which consumes the persisted model string opaquely and never re-renders this menu.

### Top-level entries and their order

The top-level selectable list is ordered as:

1. One entry per model family — Opus, Sonnet, Haiku, Fable — in the family order of the `claude` catalog in [src/commands/.spec/rules/install.md#the-model-list-is-sourced-per-tool-codex-by-probe-claude-from-a-hand-maintained-catalog](/src/commands/.spec/rules/install.md#the-model-list-is-sourced-per-tool-codex-by-probe-claude-from-a-hand-maintained-catalog). A family entry opens that family's submenu (described below); selecting it does not by itself persist a value.
2. The cross-family alias entries from the catalog — the `Best (auto-pick)` entry — as direct selections that answer the question immediately and persist the alias value. A cross-family alias entry does not open a submenu.
3. The synthetic `default configured model` entry pinned in [src/commands/.spec/rules/install.md#the-model-list-is-sourced-per-tool-codex-by-probe-claude-from-a-hand-maintained-catalog](/src/commands/.spec/rules/install.md#the-model-list-is-sourced-per-tool-codex-by-probe-claude-from-a-hand-maintained-catalog).
4. The custom entry pinned in [src/commands/.spec/rules/install.md#claudes-model-and-effort-lists-include-a-custom-value-entry](/src/commands/.spec/rules/install.md#claudes-model-and-effort-lists-include-a-custom-value-entry), as the final entry.

The custom entry remains the final top-level entry, after the `default configured model` entry, consistent with [src/commands/.spec/rules/install.md#claudes-model-and-effort-lists-include-a-custom-value-entry](/src/commands/.spec/rules/install.md#claudes-model-and-effort-lists-include-a-custom-value-entry).

### The family submenu

Selecting a family entry opens that family's submenu. The submenu lists that family's entries from the `claude` catalog in catalog order — the family's auto-updating "Latest" alias first, then its "Latest" 1M-context variant where the family offers one, then each of the family's pinned versions, each followed by its 1M-context variant where the model offers one — plus a back affordance as the final entry. Selecting any model entry answers the question and persists that entry's value: the alias string for a "Latest" entry, the full model identifier for a pinned-version entry. Selecting the back affordance returns to the top-level list without answering the question.

Every family submenu contains its family's "Latest" alias and at least one pinned version, so no submenu collapses to a single model entry.

### Submenus carry neither the default nor the custom entry

The synthetic `default configured model` entry and the custom entry appear only at the top level. No family submenu repeats them: the top-level custom entry is the single escape hatch for any model the catalog omits, and the top-level default entry is the single path to "default configured model". Each family submenu carries only its own model entries plus the back affordance.

### The resolved leaf is the answer

Whatever entry the user lands on — a top-level cross-family alias, the top-level default entry, a family-submenu model entry, or the custom free-text value — is the question's single answer, persisted verbatim per [src/commands/.spec/rules/install.md#the-model-list-is-sourced-per-tool-codex-by-probe-claude-from-a-hand-maintained-catalog](/src/commands/.spec/rules/install.md#the-model-list-is-sourced-per-tool-codex-by-probe-claude-from-a-hand-maintained-catalog). Backing out of a family submenu does not answer the question; it returns to the top level so the user can choose again.

### Failure signals

- The `claude` model question is rendered as a single flat list of every alias and version mixed together, instead of the family-grouped two-tier menu pinned here.
- A family's "Latest" alias, or a generic "pick a specific version" navigation entry, appears at the top level: the top level lists the model families directly, and a family's "Latest" alias lives inside that family's submenu.
- Selecting a family entry persists a value (for example a placeholder) instead of opening that family's submenu.
- A family submenu omits the family's "Latest" alias, omits a pinned version, omits the 1M-context variant of an entry that offers one, or shows a 1M-context variant for a model that has none (for example Haiku).
- A family submenu repeats the `default configured model` entry or the custom entry, instead of leaving those at the top level only.
- A family submenu has no way back, trapping the user inside it, or backing out silently persists an answer instead of returning to the top level.
- The `claude` family grouping is applied to the `codex` model question, which is flat.

## The weighted-review configuration is collected only when the reviewer list has two or more reviewers

After the reviewer list is established (see [.spec/contracts/cli-commands/install.md](/.spec/contracts/cli-commands/install.md)), `install` collects the weighted-review configuration — the `minimumReviews` count and, per reviewer, its `optional` flag (both persisted per [src/workspace/.spec/rules/flanders-config/file-format.md](/src/workspace/.spec/rules/flanders-config/file-format.md)) — but only when the list holds two or more reviewers. The configuration always lands in `.flanders/config.json`; what varies is whether its values come from the user or from the no-op defaults.

### Who this applies to

- **Subject:** the `install` command, while it collects answers and before it writes `.flanders/config.json`.
- **Not subject:** every other command, and the reviewer tool/model/effort collection itself, which is pinned by the install contract and by [src/commands/.spec/rules/install.md#a-flag-supplied-answer-skips-its-interactive-prompt](/src/commands/.spec/rules/install.md#a-flag-supplied-answer-skips-its-interactive-prompt).

### Single reviewer

When the reviewer list holds exactly one reviewer there is no weighted-review configuration to make: the reviewer is required (`optional` is `false`) and `minimumReviews` is `1`. No weighted-review question is asked, and supplying any weighted-review flag (`--reviewer-minimum` or any `--reviewer[-N]-optional`) with a single-reviewer configuration is a usage error pinned by the install contract.

### Two or more reviewers

When the list holds two or more reviewers the weighted-review section is presented without any gate question — there is no "configure weighted reviews?" prompt. Its two data are collected as follows:

- **`minimumReviews`.** Taken from `--reviewer-minimum` when that flag is present; otherwise asked interactively as a free-text numeric entry whose default — an empty entry — is the reviewer-list length `T`. The interactive entry is accepted only as an integer in `[1, T]`; an entry that is non-numeric, below `1`, or above `T` is re-prompted, showing the valid range, until a valid integer or an empty entry is given. A `--reviewer-minimum` outside `[1, T]` is a usage error pinned by the install contract.
- **Per-reviewer `optional`.** The per-reviewer optional configuration is collected only when the chosen minimum is below `T`. A minimum equal to `T` forces every reviewer to run to a verdict, so no reviewer can be optional: when the chosen minimum equals `T`, every reviewer is required, the per-reviewer "is this reviewer optional?" questions are not asked, and supplying any `--reviewer[-N]-optional` flag together with a `--reviewer-minimum` equal to `T` is a usage error pinned by the install contract. When the chosen minimum is below `T`: if at least one `--reviewer[-N]-optional` flag is present, optionality is taken entirely from those flags — every reviewer named by such a flag is optional and every other reviewer is required, and the per-reviewer questions are not asked; if no `--reviewer[-N]-optional` flag is present, each reviewer's optionality is asked interactively, in reviewer order, as a yes/no single-select with `no` (required) as the default, and each question identifies the reviewer it concerns as pinned by the install contract (see [.spec/contracts/cli-commands/install.md](/.spec/contracts/cli-commands/install.md)). A `--reviewer-N-optional` whose index exceeds the reviewer-list length is a usage error pinned by the install contract.

The interactive minimum entry and, when they are asked, the per-reviewer optional questions go through the shared prompt helper (see [src/commands/.spec/rules/install.md#interactive-prompts-go-through-the-shared-prompt-helper](/src/commands/.spec/rules/install.md#interactive-prompts-go-through-the-shared-prompt-helper)) and follow its non-TTY policy like every other prompt.

### No-op defaults

The defaults reproduce a build with no weighted reviews: `minimumReviews` equal to the reviewer-list length `T`, so no reviewer is ever cancelled, and every reviewer required. Because the default minimum equals `T`, a user who accepts it (an empty entry) is not asked any per-reviewer optional question and persists every reviewer as required.

### Failure signals

- `install` asks a weighted-review question, or accepts a weighted-review flag, for a single-reviewer configuration.
- `install` shows a gate ("configure weighted reviews?") question instead of presenting the section directly for a two-or-more-reviewer list.
- `install` persists a `minimumReviews` outside `[1, T]`, or proceeds interactively after a `--reviewer-minimum` outside that range instead of exiting with a usage error.
- `install` asks a per-reviewer optional question, or accepts a `--reviewer[-N]-optional` flag, when the chosen minimum equals `T`.
- `install` renders the interactive minimum question as a single-select list instead of a free-text entry defaulting to `T`, or does not re-prompt an interactive minimum entry that is non-numeric, below `1`, or above `T`.
- `install` persists a reviewer as optional while `minimumReviews` equals the number of configured reviewers.
- `install` writes a `.flanders/config.json` whose `minimumReviews` field or any per-reviewer `optional` field is absent (see [src/workspace/.spec/rules/flanders-config/file-format.md](/src/workspace/.spec/rules/flanders-config/file-format.md)).

## install pre-selects each interactive default from the chosen scope's existing config

After the scope is chosen, `install` reads the `.flanders/config.json` at that scope (its format is pinned in [src/workspace/.spec/rules/flanders-config/file-format.md](/src/workspace/.spec/rules/flanders-config/file-format.md)) and seeds the interactive defaults of the questions asked afterward from its stored answers, so that accepting every default reproduces the stored configuration. The user-facing promise is pinned in [.spec/contracts/cli-commands/install.md#pre-selection-from-an-existing-configuration](/.spec/contracts/cli-commands/install.md#pre-selection-from-an-existing-configuration); this rule pins how the seeding is realized.

### Who this applies to

- **Subject:** the `install` command, after the scope question is answered and before it asks the worker and reviewer questions.
- **Not subject:** the skills-tool and scope questions, whose answers `.flanders/config.json` does not store and which are therefore never pre-selected from it; every other command, which does not pre-select; and any flag-answered question, which is skipped entirely and takes its flag value regardless of the stored configuration.

### The pre-selection read is lenient

The read targets the chosen scope's `.flanders/config.json` directly — it does not apply the consume-to-run precedence of [.spec/contracts/shared/flanders-config.md](/.spec/contracts/shared/flanders-config.md). When the file is absent, unreadable, or does not parse and validate against [src/workspace/.spec/rules/flanders-config/file-format.md](/src/workspace/.spec/rules/flanders-config/file-format.md), `install` pre-selects nothing and uses its fresh-install defaults; it does not abort. This is the one reader that tolerates a malformed file, precisely so that re-running `install` repairs a corrupted configuration by overwriting it.

### How each stored answer seeds its question

Each question is seeded through the shared prompt helper's default support (see [src/commands/.spec/rules/install.md#interactive-prompts-go-through-the-shared-prompt-helper](/src/commands/.spec/rules/install.md#interactive-prompts-go-through-the-shared-prompt-helper)):

- **Worker tool, each reviewer tool** — the single-select's default entry is the stored `tool`. `claude` and `codex` are always offered, so the stored tool is always pre-selectable.
- **Worker effort, each reviewer effort** — the default entry is the entry whose persisted value equals the stored `effort` (the synthetic `default configured effort` entry when the stored effort is `""`). For `claude`, an effort that is not among the curated suggestions defaults to the custom entry, whose free-text default is set to the stored value. For `codex`, the stored effort is always a member of the closed documented set or `""`, so it is always among the offered entries.
- **Worker model, each reviewer model** — the default entry is the entry whose persisted value equals the stored `model` (the synthetic `default configured model` entry when the stored model is `""`). For `claude`, the two-tier menu pre-selects along the path to the stored model: when the stored model belongs to a family submenu, the family entry is the default at the top level and the matching model entry is the default inside that submenu; when it is the cross-family alias or the default entry, that top-level entry is the default; and when it matches none of the catalogued values, the custom entry is the default with its free-text default set to the stored model. For `codex`, the default entry is the probe-returned entry equal to the stored model, or the `default configured model` entry when the stored model is `""`; a stored `codex` model the current probe no longer returns is not among the offered entries and is not forced onto any entry — that question is then answered actively, while every other question still reproduces its stored answer. When the `codex` model question falls back to free-text (empty or failed probe), its free-text default is the stored model.
- **Worker fast, each reviewer fast** — when the fast question is asked for a role (its tool is `claude` and its model supports fast mode per [src/commands/.spec/rules/install.md#fast-mode-is-offered-only-for-a-claude-role-whose-model-supports-it](/src/commands/.spec/rules/install.md#fast-mode-is-offered-only-for-a-claude-role-whose-model-supports-it)), the yes/no single-select defaults to the stored `fast` of that role. When the role's model does not support fast mode, no fast question is asked and the stored `fast` — always `false` for such a role — is carried through unchanged.
- **Reviewer-list length** — the `Configure another reviewer?` single-select is seeded to rebuild a list of the stored length `T`: it defaults to `yes` after each of the first `T − 1` reviewers and to `no` after reviewer `T`, so accepting every default configures exactly `T` reviewers. When at least one reviewer flag is present, the list length is fixed by the flags and this question is not shown at all, per [src/commands/.spec/rules/install.md#reviewer-flags-fix-the-reviewer-list-length-and-skip-the-configure-another-reviewer-prompt](/src/commands/.spec/rules/install.md#reviewer-flags-fix-the-reviewer-list-length-and-skip-the-configure-another-reviewer-prompt).
- **Each reviewer's `optional`** — when the per-reviewer optional questions are asked (the chosen minimum is below `T`), each defaults to the stored `optional` of the reviewer at that position.
- **`minimumReviews`** — the free-text numeric entry's default is the stored `minimumReviews` rather than `T`. The validation pinned by [src/commands/.spec/rules/install.md#the-weighted-review-configuration-is-collected-only-when-the-reviewer-list-has-two-or-more-reviewers](/src/commands/.spec/rules/install.md#the-weighted-review-configuration-is-collected-only-when-the-reviewer-list-has-two-or-more-reviewers) still governs the accepted entry.

The per-question fresh-install defaults pinned elsewhere in this file and in the install contract — the minimum defaulting to `T`, each reviewer defaulting to required, and the first entry of any other list being the initial highlight — are the defaults used when no configuration is read; a read configuration replaces each with the stored value as above.

### Flags still win

A question answered by a flag is skipped and takes the flag value, never the stored default (see [src/commands/.spec/rules/install.md#a-flag-supplied-answer-skips-its-interactive-prompt](/src/commands/.spec/rules/install.md#a-flag-supplied-answer-skips-its-interactive-prompt)). Pre-selection seeds only the defaults of questions that are actually asked.

### Failure signals

- `install` aborts, or prints a malformed-configuration diagnostic, when the pre-existing `.flanders/config.json` at the chosen scope is malformed, instead of falling back to fresh-install defaults.
- The pre-selection read applies the project-over-global precedence instead of reading the chosen scope's file directly.
- Accepting every pre-selected default at a scope whose stored configuration is intact writes back a `.flanders/config.json` that differs from the one read.
- A stored answer that is still among its question's offered options is not pre-selected — for example, a stored worker tool is not the default entry of the worker tool question.
- The skills-tool or scope question is pre-selected from `.flanders/config.json`, which stores neither.
- A `codex` model the current probe no longer returns is forced onto some other entry as the default instead of leaving that question without a pre-selected default.
