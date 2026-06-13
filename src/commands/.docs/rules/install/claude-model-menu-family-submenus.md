# The claude model question groups models by family: a family entry at the top, each opening a submenu of that family's models

When `install` asks the user for a `claude` model identifier (for the worker or any reviewer), the question is a two-tier menu. The top level offers one entry per model family, the cross-family alias entry, the default entry, and the custom entry; selecting a family opens a submenu listing that family's models — its auto-updating "Latest" alias(es) and its pinned versions. This rule pins how that menu is laid out and navigated. The set of entries each level draws from, and the value each entry persists, are pinned in `src/commands/.docs/rules/install/model-list-discovery.md`; this rule does not redefine them.

## Who this applies to

- **Subject:** the `install` command, on the `claude` model question only — the worker model question and each reviewer model question when the tool is `claude`.
- **Not subject:** the `codex` model question, which is a flat probe-sourced list or a free-text fallback per `src/commands/.docs/rules/install/model-list-discovery.md`; every effort question, which is unaffected; and any later Flanders command, which consumes the persisted model string opaquely and never re-renders this menu.

## Top-level entries and their order

The top-level selectable list is ordered as:

1. One entry per model family — Opus, Sonnet, Haiku, Fable — in the family order of the `claude` catalog in `src/commands/.docs/rules/install/model-list-discovery.md`. A family entry opens that family's submenu (described below); selecting it does not by itself persist a value.
2. The cross-family alias entries from the catalog — the `Best (auto-pick)` entry — as direct selections that answer the question immediately and persist the alias value. A cross-family alias entry does not open a submenu.
3. The synthetic `default configured model` entry pinned in `src/commands/.docs/rules/install/model-list-discovery.md`.
4. The custom entry pinned in `src/commands/.docs/rules/install/claude-lists-include-custom-value-entry.md`, as the final entry.

The custom entry remains the final top-level entry, after the `default configured model` entry, consistent with `src/commands/.docs/rules/install/claude-lists-include-custom-value-entry.md`.

## The family submenu

Selecting a family entry opens that family's submenu. The submenu lists that family's entries from the `claude` catalog in catalog order — the family's auto-updating "Latest" alias first, then its "Latest" 1M-context variant where the family offers one, then each of the family's pinned versions, each followed by its 1M-context variant where the model offers one — plus a back affordance as the final entry. Selecting any model entry answers the question and persists that entry's value: the alias string for a "Latest" entry, the full model identifier for a pinned-version entry. Selecting the back affordance returns to the top-level list without answering the question.

Every family submenu contains its family's "Latest" alias and at least one pinned version, so no submenu collapses to a single model entry.

## Submenus carry neither the default nor the custom entry

The synthetic `default configured model` entry and the custom entry appear only at the top level. No family submenu repeats them: the top-level custom entry is the single escape hatch for any model the catalog omits, and the top-level default entry is the single path to "default configured model". Each family submenu carries only its own model entries plus the back affordance.

## The resolved leaf is the answer

Whatever entry the user lands on — a top-level cross-family alias, the top-level default entry, a family-submenu model entry, or the custom free-text value — is the question's single answer, persisted verbatim per `src/commands/.docs/rules/install/model-list-discovery.md`. Backing out of a family submenu does not answer the question; it returns to the top level so the user can choose again.

## Failure signals

- The `claude` model question is rendered as a single flat list of every alias and version mixed together, instead of the family-grouped two-tier menu pinned here.
- A family's "Latest" alias, or a generic "pick a specific version" navigation entry, appears at the top level: the top level lists the model families directly, and a family's "Latest" alias lives inside that family's submenu.
- Selecting a family entry persists a value (for example a placeholder) instead of opening that family's submenu.
- A family submenu omits the family's "Latest" alias, omits a pinned version, omits the 1M-context variant of an entry that offers one, or shows a 1M-context variant for a model that has none (for example Haiku).
- A family submenu repeats the `default configured model` entry or the custom entry, instead of leaving those at the top level only.
- A family submenu has no way back, trapping the user inside it, or backing out silently persists an answer instead of returning to the top level.
- The family grouping is applied to the `codex` model question, which is flat per `src/commands/.docs/rules/install/model-list-discovery.md`.
