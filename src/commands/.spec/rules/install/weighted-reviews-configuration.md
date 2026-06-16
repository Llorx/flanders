# The weighted-review configuration is collected only when the reviewer list has two or more reviewers

After the reviewer list is established (see [.spec/contracts/cli-commands/install.md](/.spec/contracts/cli-commands/install.md)), `install` collects the weighted-review configuration — the `minimumReviews` count and, per reviewer, its `optional` flag (both persisted per [src/workspace/.spec/rules/flanders-config/file-format.md](/src/workspace/.spec/rules/flanders-config/file-format.md)) — but only when the list holds two or more reviewers. The configuration always lands in `.flanders/config.json`; what varies is whether its values come from the user or from the no-op defaults.

## Who this applies to

- **Subject:** the `install` command, while it collects answers and before it writes `.flanders/config.json`.
- **Not subject:** every other command, and the reviewer tool/model/effort collection itself, which is pinned by the install contract and by [src/commands/.spec/rules/install/flag-driven-skip.md](/src/commands/.spec/rules/install/flag-driven-skip.md).

## Single reviewer

When the reviewer list holds exactly one reviewer there is no weighted-review configuration to make: the reviewer is required (`optional` is `false`) and `minimumReviews` is `1`. No weighted-review question is asked, and supplying any weighted-review flag (`--reviewer-minimum` or any `--reviewer[-N]-optional`) with a single-reviewer configuration is a usage error pinned by the install contract.

## Two or more reviewers

When the list holds two or more reviewers the weighted-review section is presented without any gate question — there is no "configure weighted reviews?" prompt. Its two data are collected as follows:

- **`minimumReviews`.** Taken from `--reviewer-minimum` when that flag is present; otherwise asked interactively as a free-text numeric entry whose default — an empty entry — is the reviewer-list length `T`. The interactive entry is accepted only as an integer in `[1, T]`; an entry that is non-numeric, below `1`, or above `T` is re-prompted, showing the valid range, until a valid integer or an empty entry is given. A `--reviewer-minimum` outside `[1, T]` is a usage error pinned by the install contract.
- **Per-reviewer `optional`.** The per-reviewer optional configuration is collected only when the chosen minimum is below `T`. A minimum equal to `T` forces every reviewer to run to a verdict, so no reviewer can be optional: when the chosen minimum equals `T`, every reviewer is required, the per-reviewer "is this reviewer optional?" questions are not asked, and supplying any `--reviewer[-N]-optional` flag together with a `--reviewer-minimum` equal to `T` is a usage error pinned by the install contract. When the chosen minimum is below `T`: if at least one `--reviewer[-N]-optional` flag is present, optionality is taken entirely from those flags — every reviewer named by such a flag is optional and every other reviewer is required, and the per-reviewer questions are not asked; if no `--reviewer[-N]-optional` flag is present, each reviewer's optionality is asked interactively, in reviewer order, as a yes/no single-select with `no` (required) as the default, and each question identifies the reviewer it concerns as pinned by the install contract (see [.spec/contracts/cli-commands/install.md](/.spec/contracts/cli-commands/install.md)). A `--reviewer-N-optional` whose index exceeds the reviewer-list length is a usage error pinned by the install contract.

The interactive minimum entry and, when they are asked, the per-reviewer optional questions go through the shared prompt helper (see [src/commands/.spec/rules/install/interactive-prompts.md](/src/commands/.spec/rules/install/interactive-prompts.md)) and follow its non-TTY policy like every other prompt.

## No-op defaults

The defaults reproduce a build with no weighted reviews: `minimumReviews` equal to the reviewer-list length `T`, so no reviewer is ever cancelled, and every reviewer required. Because the default minimum equals `T`, a user who accepts it (an empty entry) is not asked any per-reviewer optional question and persists every reviewer as required.

## Failure signals

- `install` asks a weighted-review question, or accepts a weighted-review flag, for a single-reviewer configuration.
- `install` shows a gate ("configure weighted reviews?") question instead of presenting the section directly for a two-or-more-reviewer list.
- `install` persists a `minimumReviews` outside `[1, T]`, or proceeds interactively after a `--reviewer-minimum` outside that range instead of exiting with a usage error.
- `install` asks a per-reviewer optional question, or accepts a `--reviewer[-N]-optional` flag, when the chosen minimum equals `T`.
- `install` renders the interactive minimum question as a single-select list instead of a free-text entry defaulting to `T`, or does not re-prompt an interactive minimum entry that is non-numeric, below `1`, or above `T`.
- `install` persists a reviewer as optional while `minimumReviews` equals the number of configured reviewers.
- `install` writes a `.flanders/config.json` whose `minimumReviews` field or any per-reviewer `optional` field is absent (see [src/workspace/.spec/rules/flanders-config/file-format.md](/src/workspace/.spec/rules/flanders-config/file-format.md)).
