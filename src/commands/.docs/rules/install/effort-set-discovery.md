# Effort levels are sourced per tool from each CLI's documented levels

When `install` asks the user for a reasoning-effort level for the worker or the reviewer, the effort levels are sourced from the levels the selected tool's CLI documents. Effort is not discovered through a subprocess probe — each tool's set is documented by its CLI and is hardcoded against that documentation. The contract `.docs/contracts/cli-commands/install.md` pins the user-visible shape of each rendering; this rule pins, per tool, which set is presented, whether the set is closed, and how each path persists its value.

## Who this applies to

- **Subject:** the `install` command, during each effort question (worker effort and reviewer effort).
- **Not subject:** any later Flanders command. Effort levels persisted in `.flanders/config.json` are passed through as opaque strings; no later command re-derives the available set.

## Per-tool effort sets

- **`codex`** — the effort levels Codex CLI documents are `minimal`, `low`, `medium`, `high`, `xhigh`. `xhigh` is model-dependent but remains in the list — `install` does not pre-filter by model. This set is **closed**: the only valid effort values for `codex` are these documented levels and the empty "default configured effort".
- **`claude`** — the effort levels Claude Code documents for its `--effort` selection are `low`, `medium`, `high`, `xhigh`, `max`. `xhigh` and `max` are model-dependent but remain in the list — `install` does not pre-filter by model. The `ultracode` entry Claude Code's effort menu offers is not in the set, because it is a Claude Code session setting rather than a value the `--effort` flag accepts. This set is **open**: the documented levels are suggestions, and the user reaches any effort value Claude Code accepts but the set omits through the custom entry pinned in `src/commands/.docs/rules/install/claude-lists-include-custom-value-entry.md`.

## Rendering the question

- For **`codex`**, the question is rendered as a selectable list whose entries are the closed documented set above, plus one synthetic entry at the end labelled `default configured effort`.
- For **`claude`**, the question is rendered as a selectable list whose entries are the documented set above, plus the synthetic `default configured effort` entry, plus the custom entry pinned in `src/commands/.docs/rules/install/claude-lists-include-custom-value-entry.md`.

Picking the synthetic `default configured effort` entry resolves to the empty string `""` when persisted in `.flanders/config.json` per `src/workspace/.docs/rules/flanders-config/file-format.md`.

## Equivalence between selecting and typing

The available paths never produce different persisted values for the same user intent: picking `default configured effort` resolves to `""`. Picking a specific effort level by selecting a list entry persists the exact level string the user selected, with no trimming, no case folding, no further validation. The `claude` custom entry is a further path whose persistence is pinned in `src/commands/.docs/rules/install/claude-lists-include-custom-value-entry.md`.

## Failure signals

- `install` ships a `codex` effort set that diverges from what Codex CLI documents, or a `claude` effort set that diverges from what Claude Code documents, instead of tracking that documentation.
- A list selection and a typed value persist different values for the same user intent (for example, persisting the literal string `"default configured effort"` instead of the empty string).
- `install` proceeds to persist an effort level the user did not actually select (for example, defaulting to the first entry of the list when the user did not pick one).
- `install` pre-filters the effort list by the chosen model, dropping `xhigh` or `max` when it judges the model unsupported, instead of presenting the full documented set.
- `install` includes `ultracode` in the `claude` effort set, even though it is not a value the `--effort` flag accepts.
