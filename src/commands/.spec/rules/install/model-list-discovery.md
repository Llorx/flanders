# The model list is sourced per tool: codex by probe, claude from a hand-maintained catalog

When `install` asks the user for a model identifier for the worker or the reviewer, the suggested models are sourced from the selected tool. For `codex`, `install` queries the tool's CLI for the models available to the user's account. For `claude`, whose CLI exposes no models-listing command, `install` presents a hand-maintained catalog of the models Claude Code is known to accept. The contract [.spec/contracts/cli-commands/install.md](/.spec/contracts/cli-commands/install.md) pins the user-visible shape of each rendering; this rule pins, per tool, where the suggestions come from and how each path persists its value.

## Who this applies to

- **Subject:** the `install` command, during each model question (worker model and reviewer model).
- **Not subject:** any later Flanders command. Models persisted in `.flanders/config.json` are passed through as opaque strings; no later command re-derives the available models.

## Per-tool model source

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

  The catalog is a set of suggestions, not a closed set; the user reaches any model Claude Code accepts but the catalog omits through the custom entry pinned in [src/commands/.spec/rules/install/claude-lists-include-custom-value-entry.md](/src/commands/.spec/rules/install/claude-lists-include-custom-value-entry.md). When Claude Code documents new `--model` aliases or model versions, or retires a listed one, this rule is updated to track that change.

## Rendering the question

- For **`codex`**, when the probe yields a non-empty list, the question is rendered as a selectable list whose entries are the model identifiers the probe returned, plus one synthetic entry at the end labelled `default configured model`. When the probe yields an empty list, is skipped, or fails, the question is rendered as a free-text input with the placeholder `leave empty for the default configured model`.
- For **`claude`**, the question is rendered as the family-grouped two-tier menu pinned in [src/commands/.spec/rules/install/claude-model-menu-family-submenus.md](/src/commands/.spec/rules/install/claude-model-menu-family-submenus.md): each model family is a top-level entry that opens a submenu of that family's catalog entries (its "Latest" alias(es) and its pinned versions), the cross-family alias is a top-level direct selection, plus the synthetic `default configured model` entry, plus the custom entry pinned in [src/commands/.spec/rules/install/claude-lists-include-custom-value-entry.md](/src/commands/.spec/rules/install/claude-lists-include-custom-value-entry.md).

Picking the synthetic `default configured model` entry resolves to the empty string `""` when persisted in `.flanders/config.json` per [src/workspace/.spec/rules/flanders-config/file-format.md](/src/workspace/.spec/rules/flanders-config/file-format.md). Leaving the `codex` free-text input empty resolves to the same `""`.

## Equivalence between selecting and typing

The available paths never produce different persisted values for the same user intent: picking `default configured model` and leaving the `codex` free-text input empty both resolve to `""`. Picking a specific model identifier — by selecting a top-level entry, by selecting a `claude` family-submenu entry, or by typing it into the `codex` free-text fallback — persists the exact identifier string the entry maps to or the user typed, with no trimming, no case folding, no further validation. The `claude` custom entry is a further path whose persistence is pinned in [src/commands/.spec/rules/install/claude-lists-include-custom-value-entry.md](/src/commands/.spec/rules/install/claude-lists-include-custom-value-entry.md).

## Failure signals

- For a **probed** tool (`codex`), `install` ships a hardcoded list of model identifiers instead of querying the tool, ignoring the user's actual subscription / authorization.
- `install` runs the `codex` probe more than once per tool per run.
- The probe streams the tool's stdout or stderr to the user's terminal during model collection, polluting the install UI.
- A list selection and a typed value persist different values for the same user intent (for example, persisting the literal string `"default configured model"` instead of the empty string).
- `install` proceeds to persist a model identifier the user did not actually select (for example, defaulting to the first entry of the list when the user did not pick one).
- When `codex` could not be started (spawn failure or command-not-found), the probe falls back to free-text **silently**, or reports only the bare exit code, instead of surfacing the captured stderr (or stdout when stderr is empty, or the spawn primitive's error message).
- The `codex` probe aborts `install`, or emits a noisy diagnostic, when `codex` started but genuinely exposes no list (a clean empty catalog), instead of falling back to free-text silently.
- The probe consults the exit code or scans for a command-not-found phrase before validating the captured stdout as a catalog, so a correctly-shaped model catalog is misclassified as `codex could not be started` — or otherwise diverted from being parsed into the list — because a not-found phrase appears inside the payload's own data, for example embedded prose in an instruction or description string the JSON carries.
