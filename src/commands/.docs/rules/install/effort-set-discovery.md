# Effort levels are a closed per-tool set, with free-text fallback

When `install` asks the user for a reasoning-effort level for the worker or the reviewer, the question is rendered from the closed set of effort levels the selected tool's CLI documents. When the tool documents such a set, the user picks from it; when it does not, `install` falls back to a free-text input. The contract `.docs/contracts/cli-commands/install.md` pins both modes; this rule pins, per tool, which set is presented and how each mode persists its value. Unlike the model question, effort is not discovered through a subprocess probe — the set is documented by each tool's CLI and is hardcoded against that documentation.

## Who this applies to

- **Subject:** the `install` command, during each effort question (worker effort and reviewer effort).
- **Not subject:** any later Flanders command. Effort levels persisted in `.flanders/config.json` are passed through as opaque strings; no later command re-derives the available set.

## Per-tool effort sets

- **`claude`** — Claude Code does not expose a discrete, enumerable set of effort levels selectable for its model invocations. The question is rendered as a free-text input with the placeholder `leave empty for the default configured effort`.
- **`codex`** — the effort levels Codex CLI documents are `minimal`, `low`, `medium`, `high`, `xhigh`. `xhigh` is model-dependent but remains in the list — `install` does not pre-filter by model. The question is rendered as a selectable list of these levels plus one synthetic entry at the end labelled `default configured effort`.

## Rendering the question

When the tool exposes a closed set, the question is rendered as a selectable list whose entries are that set's levels, plus one synthetic entry at the end labelled `default configured effort`. Picking the synthetic entry resolves to the empty string `""` when persisted in `.flanders/config.json` per `src/.docs/rules/flanders-config/file-format.md`.

When the tool does not expose a closed set, the question is rendered as a free-text input with the placeholder `leave empty for the default configured effort`. An empty answer resolves to the empty string `""` when persisted.

## Equivalence between the two modes

The two modes never produce different persisted values for the same user intent: picking `default configured effort` in the list form and leaving the free-text input empty both resolve to `""`. Picking a specific effort level (whether by list selection or by typing it verbatim into the free-text input) persists the exact level string the user selected or typed, with no trimming, no case folding, no further validation.

## Failure signals

- `install` ships an effort set that diverges from what the tool's CLI documents, instead of tracking that documentation.
- The list form and the free-text form persist different values for the same user intent (for example, the list form persists the literal string `"default configured effort"` instead of the empty string).
- `install` proceeds to persist an effort level the user did not actually select (for example, defaulting to the first entry of the list when the user did not pick one).
- `install` pre-filters the Codex effort list by the chosen model, dropping `xhigh` when it judges the model unsupported, instead of presenting the full documented set.
