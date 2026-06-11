# Model lists are probed per tool, with free-text fallback

When `install` asks the user for a model identifier for the worker or the reviewer, it first attempts to query the selected tool's CLI for the list of models the tool supports. When the query succeeds, the user picks from the list. When the tool does not expose a list (or the query fails), `install` falls back to a free-text input. The contract `.docs/contracts/cli-commands/install.md` pins both modes; this rule pins how each mode is decided and how the probe runs.

## Who this applies to

- **Subject:** the `install` command, during each model question (worker model and reviewer model).
- **Not subject:** any later Flanders command. Models persisted in `.flanders/config.json` are passed through as opaque strings; no later command re-probes for available models.

## Per-tool probes

For each tool, the probe is a specific subprocess invocation. The probe runs at most once per tool per `install` run, even if the same tool is asked about twice (worker and reviewer); the result is cached for the second question.

- **`claude`** — the Claude Code CLI does not expose a model list as a CLI command. The probe is skipped and the free-text fallback is used.
- **`codex`** — invoke `codex debug models` (no `--bundled`, so the catalog is refreshed for the user's account rather than read from the binary's bundled snapshot). The probe redirects stdout/stderr away from the user's terminal. On exit code 0, the captured stdout is parsed as a JSON object of the shape `{"models":[{"slug":"…","visibility":"…"}, …]}`; the list is the `slug` of every entry whose `visibility` is `"list"`, in catalog order. Entries with any other `visibility` (for example `"hide"`, used for internal models) are excluded, mirroring Codex's own `/model` picker. Any parse failure, a payload with no `"list"`-visible entries, or a non-zero exit is treated as "no list available". If a future Codex CLI removes `codex debug models`, the probe's non-zero exit drives the same free-text fallback, and this rule must be updated to pin the replacement command.

When `claude` ever does expose a model list in the future, this rule must be updated to add the corresponding probe; until then, the entry above is authoritative.

## Rendering the question

When the probe yields a non-empty list, the question is rendered as a selectable list whose entries are the model identifiers returned by the probe, plus one synthetic entry at the end labelled `default configured model`. Picking the synthetic entry resolves to the empty string `""` when persisted in `.flanders/config.json` per `src/workspace/.docs/rules/flanders-config/file-format.md`.

When the probe yields an empty list, or the probe is skipped, or the probe fails, the question is rendered as a free-text input with the placeholder `leave empty for the default configured model`. An empty answer resolves to the empty string `""` when persisted.

## Equivalence between the two modes

The two modes never produce different persisted values for the same user intent: picking `default configured model` in the list form and leaving the free-text input empty must both resolve to `""`. Picking a specific model identifier (whether by list selection or by typing it verbatim into the free-text input) persists the exact identifier string the user selected or typed, with no trimming, no case folding, no further validation.

## Failure signals

- `install` ships a hardcoded list of model identifiers per tool, ignoring the user's actual subscription / authorization.
- `install` runs the probe more than once per tool per run.
- The probe streams the tool's stdout to the user's terminal, polluting the install UI.
- The list form and the free-text form persist different values for the same user intent (for example, the list form persists the literal string `"default configured model"` instead of the empty string).
- `install` proceeds to persist a model identifier the user did not actually select (for example, defaulting to the first entry of the list when the user did not pick one).
- The probe falls back to free-text silently after a transient error (network, transport) without retrying or surfacing the situation to the user — every fallback must be the consequence of the tool genuinely not exposing a list, not of a recoverable failure.
