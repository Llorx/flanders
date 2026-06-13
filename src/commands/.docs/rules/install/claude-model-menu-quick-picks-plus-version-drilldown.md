# The claude model question is a two-tier menu: latest-of-family quick picks, then a drill-down to pinned versions

When `install` asks the user for a `claude` model identifier (for the worker or any reviewer), the question is not a single flat list. The top level offers the auto-updating aliases as one-keystroke quick picks; a dedicated `pick a specific version…` entry opens a drill-down that reaches the pinned, full-version identifiers by family. This rule pins how that menu is laid out and navigated. The set of entries each level draws from, and the value each entry persists, are pinned in `src/commands/.docs/rules/install/model-list-discovery.md`; this rule does not redefine them.

## Who this applies to

- **Subject:** the `install` command, on the `claude` model question only — the worker model question and each reviewer model question when the tool is `claude`.
- **Not subject:** the `codex` model question, which is a flat probe-sourced list or a free-text fallback per `src/commands/.docs/rules/install/model-list-discovery.md`; every effort question, which is unaffected; and any later Flanders command, which consumes the persisted model string opaquely and never re-renders this menu.

## Top-level entries and their order

The top-level selectable list is ordered as:

1. The auto-updating alias entries from the `claude` catalog in `src/commands/.docs/rules/install/model-list-discovery.md`, in catalog order — one quick pick for the latest model of each family and for the cross-family aliases (for example `Latest Opus`, `Latest Opus 1M`, `Best (auto-pick)`, `Opus Plan`).
2. A single `pick a specific version…` navigation entry that opens the version drill-down described below.
3. The synthetic `default configured model` entry pinned in `src/commands/.docs/rules/install/model-list-discovery.md`.
4. The custom entry pinned in `src/commands/.docs/rules/install/claude-lists-include-custom-value-entry.md`, as the final entry.

The `pick a specific version…` entry sits among the curated entries, before the synthetic `default configured model` entry; the custom entry remains the final entry, consistent with `src/commands/.docs/rules/install/claude-lists-include-custom-value-entry.md`. Selecting an auto-updating alias entry answers the question immediately and persists that alias's value; it does not open a submenu.

## The version drill-down

Selecting `pick a specific version…` opens a **family submenu**, then a **version submenu**:

1. **Family submenu.** Lists each model family that has at least one pinned-version entry in the `claude` catalog — Opus, Sonnet, Haiku, and Fable — in catalog order, plus a back affordance that returns to the top-level list without answering the question. Selecting a family opens that family's version submenu.
2. **Version submenu.** Lists that family's pinned-version entries from the catalog in catalog order, each labelled with its concrete version and, where the model offers a 1M-context variant, a separate entry for that variant (for example `Opus 4.8` and `Opus 4.8 (1M context)`), plus a back affordance that returns to the family submenu without answering the question. Selecting a version entry answers the question and persists that entry's full model identifier.

The drill-down always renders both levels even when a family has a single version entry; a one-entry version submenu is shown rather than auto-selected, so navigation is uniform across families.

## Submenus carry neither the default nor the custom entry

The synthetic `default configured model` entry and the custom entry appear only at the top level. Neither the family submenu nor any version submenu repeats them: the top-level custom entry is the single escape hatch for any model the drill-down omits, and the top-level default entry is the single path to "default configured model". Each submenu carries only its own selectable entries plus a back affordance.

## The resolved leaf is the answer

Whatever entry the user lands on — a top-level alias, the top-level default entry, a version-submenu entry, or the custom free-text value — is the question's single answer, persisted verbatim per `src/commands/.docs/rules/install/model-list-discovery.md`. Backing out of a submenu does not answer the question; it returns to the prior level so the user can choose again.

## Failure signals

- The `claude` model question is rendered as a single flat list of every alias and version mixed together, instead of the two-tier menu pinned here.
- The auto-updating aliases are dropped from the top level, forcing the user through the drill-down even to pick "the latest Opus".
- Selecting `pick a specific version…` answers the question directly (for example by persisting a placeholder) instead of opening the family drill-down.
- A version submenu omits the 1M-context variant of a family member that offers one, or shows a 1M-context variant for a model that has none (for example Haiku).
- A family submenu or a version submenu repeats the `default configured model` entry or the custom entry, instead of leaving those at the top level only.
- A submenu has no way back, trapping the user inside the drill-down, or backing out silently persists an answer instead of returning to the prior level.
- The drill-down is applied to the `codex` model question, which is flat per `src/commands/.docs/rules/install/model-list-discovery.md`.
