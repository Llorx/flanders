# Claude's model and effort lists include a custom value entry

The selectable list `install` shows for the `claude` model question, and the one it shows for the `claude` effort question, each end with a custom entry placed after the synthetic `default configured …` entry. Selecting the custom entry opens a free-text input through which the user types any identifier the tool accepts; the typed value becomes that question's answer. This is what lets the user choose a `claude` model or effort that the curated suggestion lists do not enumerate.

## Who this applies to

- **Subject:** the `install` command, on exactly two questions — the `claude` worker/reviewer model question and the `claude` worker/reviewer effort question.
- **Not subject:** the `codex` model question and the `codex` effort question, which carry no custom entry — the `codex` model list is the authoritative set the probe returns plus `default configured model`, and the `codex` effort set is the closed documented set plus `default configured effort` (see [src/commands/.docs/rules/install/model-list-discovery.md](/src/commands/.docs/rules/install/model-list-discovery.md) and [src/commands/.docs/rules/install/effort-set-discovery.md](/src/commands/.docs/rules/install/effort-set-discovery.md)). Any later Flanders command is also not subject: the custom entry exists only at install time.

## The custom entry

On each of the two `claude` questions, the selectable list is ordered as: the curated suggestion entries, then the synthetic `default configured model` / `default configured effort` entry, then the custom entry as the final entry. The custom entry is labelled so the user understands it opens a free-text input (for example, `enter a custom value…`).

Selecting the custom entry opens a free-text input rendered through the shared prompt helper's free-text function (see [src/commands/.docs/rules/install/interactive-prompts.md](/src/commands/.docs/rules/install/interactive-prompts.md)). The value the user types in that input is the question's answer.

## Persistence of the typed value

The typed value is persisted verbatim — no trimming, no case folding, and no validation against the curated suggestions — identically to selecting a list entry. An empty typed value resolves to the empty string `""` in `.flanders/config.json` per [src/workspace/.docs/rules/flanders-config/file-format.md](/src/workspace/.docs/rules/flanders-config/file-format.md), which is the same "default configured model" / "default configured effort" semantics as picking the synthetic default entry. Selecting a curated entry and selecting the synthetic default entry are pinned in [src/commands/.docs/rules/install/model-list-discovery.md](/src/commands/.docs/rules/install/model-list-discovery.md) and [src/commands/.docs/rules/install/effort-set-discovery.md](/src/commands/.docs/rules/install/effort-set-discovery.md).

## Failure signals

- A `claude` model or effort question is rendered as a plain selectable list with no custom entry, trapping the user in the curated suggestions.
- The custom entry is offered on a `codex` question.
- Selecting the custom entry does not open a free-text input, or opens one but discards the typed value.
- The typed value is validated against the curated suggestions and rejected when it is not among them, instead of being accepted verbatim.
- The custom entry is placed before the curated suggestions or before the synthetic `default configured …` entry instead of as the final entry.
