# The model list is sourced per tool: codex by probe, claude from a curated set

When `install` asks the user for a model identifier for the worker or the reviewer, the suggested models are sourced from the selected tool. For `codex`, `install` queries the tool's CLI for the models available to the user's account. For `claude`, whose CLI exposes no models-listing command, `install` presents a curated set of the models Claude Code is known to accept. The contract `.docs/contracts/cli-commands/install.md` pins the user-visible shape of each rendering; this rule pins, per tool, where the suggestions come from and how each path persists its value.

## Who this applies to

- **Subject:** the `install` command, during each model question (worker model and reviewer model).
- **Not subject:** any later Flanders command. Models persisted in `.flanders/config.json` are passed through as opaque strings; no later command re-derives the available models.

## Per-tool model source

- **`codex`** — `install` queries the tool's CLI for the model list. The probe is a specific subprocess invocation that runs at most once per tool per `install` run, even if the same tool is asked about twice (worker and reviewer); the result is cached for the second question. The invocation is `codex debug models` (no `--bundled`, so the catalog is refreshed for the user's account rather than read from the binary's bundled snapshot). The probe redirects stdout/stderr away from the user's terminal. On exit code 0, the captured stdout is parsed as a JSON object of the shape `{"models":[{"slug":"…","visibility":"…"}, …]}`; the list is the `slug` of every entry whose `visibility` is `"list"`, in catalog order. Entries with any other `visibility` (for example `"hide"`, used for internal models) are excluded, mirroring Codex's own `/model` picker. Any parse failure, a payload with no `"list"`-visible entries, or a non-zero exit is treated as "no list available". If a future Codex CLI removes `codex debug models`, the probe's non-zero exit drives the free-text fallback, and this rule must be updated to pin the replacement command.
- **`claude`** — the Claude Code CLI exposes no command that lists models, so `install` does not probe it. Instead, `install` presents a curated set of model identifiers that tracks the model aliases Claude Code documents for its `--model` selection: `best`, `fable`, `opus`, `opus[1m]`, `sonnet`, `sonnet[1m]`, `haiku`, and `opusplan`. The `default` alias is not in the curated set, because the synthetic `default configured model` entry already covers it. The curated set is a set of suggestions, not a closed set; the user reaches any model Claude Code accepts but the curated set omits through the custom entry pinned in `src/commands/.docs/rules/install/claude-lists-include-custom-value-entry.md`. When Claude Code documents new `--model` aliases, this rule is updated to track them.

## Rendering the question

- For **`codex`**, when the probe yields a non-empty list, the question is rendered as a selectable list whose entries are the model identifiers the probe returned, plus one synthetic entry at the end labelled `default configured model`. When the probe yields an empty list, is skipped, or fails, the question is rendered as a free-text input with the placeholder `leave empty for the default configured model`.
- For **`claude`**, the question is rendered as a selectable list whose entries are the curated set above, plus the synthetic `default configured model` entry, plus the custom entry pinned in `src/commands/.docs/rules/install/claude-lists-include-custom-value-entry.md`.

Picking the synthetic `default configured model` entry resolves to the empty string `""` when persisted in `.flanders/config.json` per `src/workspace/.docs/rules/flanders-config/file-format.md`. Leaving the `codex` free-text input empty resolves to the same `""`.

## Equivalence between selecting and typing

The available paths never produce different persisted values for the same user intent: picking `default configured model` and leaving the `codex` free-text input empty both resolve to `""`. Picking a specific model identifier — by selecting a list entry or by typing it into the `codex` free-text fallback — persists the exact identifier string the user selected or typed, with no trimming, no case folding, no further validation. The `claude` custom entry is a further path whose persistence is pinned in `src/commands/.docs/rules/install/claude-lists-include-custom-value-entry.md`.

## Failure signals

- For a **probed** tool (`codex`), `install` ships a hardcoded list of model identifiers instead of querying the tool, ignoring the user's actual subscription / authorization.
- `install` runs the `codex` probe more than once per tool per run.
- The probe streams the tool's stdout to the user's terminal, polluting the install UI.
- A list selection and a typed value persist different values for the same user intent (for example, persisting the literal string `"default configured model"` instead of the empty string).
- `install` proceeds to persist a model identifier the user did not actually select (for example, defaulting to the first entry of the list when the user did not pick one).
- The `codex` probe falls back to free-text silently after a transient error (network, transport) without retrying or surfacing the situation to the user — every `codex` fallback must be the consequence of the tool genuinely not exposing a list, not of a recoverable failure.
