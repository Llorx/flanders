# The weighted-review configuration is collected only when the reviewer list has two or more reviewers

After the reviewer list is established (see [.docs/contracts/cli-commands/install.md](/.docs/contracts/cli-commands/install.md)), `install` collects the weighted-review configuration — the `minimumReviews` count and, per reviewer, its `optional` flag (both persisted per [src/workspace/.docs/rules/flanders-config/file-format.md](/src/workspace/.docs/rules/flanders-config/file-format.md)) — but only when the list holds two or more reviewers. The configuration always lands in `.flanders/config.json`; what varies is whether its values come from the user or from the no-op defaults.

## Who this applies to

- **Subject:** the `install` command, while it collects answers and before it writes `.flanders/config.json`.
- **Not subject:** every other command, and the reviewer tool/model/effort collection itself, which is pinned by the install contract and by [src/commands/.docs/rules/install/flag-driven-skip.md](/src/commands/.docs/rules/install/flag-driven-skip.md).

## Single reviewer

When the reviewer list holds exactly one reviewer there is no weighted-review configuration to make: the reviewer is required (`optional` is `false`) and `minimumReviews` is `1`. No weighted-review question is asked, and supplying any weighted-review flag (`--reviewer-minimum` or any `--reviewer[-N]-optional`) with a single-reviewer configuration is a usage error pinned by the install contract.

## Two or more reviewers

When the list holds two or more reviewers the weighted-review section is presented without any gate question — there is no "configure weighted reviews?" prompt. Its two data are collected as follows:

- **`minimumReviews`.** Taken from `--reviewer-minimum` when that flag is present; otherwise asked interactively as a single-select of the integers `1` through the reviewer-list length `T`, with `T` as the highlighted default. The value is validated to an integer in `[1, T]`; a `--reviewer-minimum` outside that range is a usage error pinned by the install contract.
- **Per-reviewer `optional`.** When at least one `--reviewer[-N]-optional` flag is present, optionality is taken entirely from those flags: every reviewer named by such a flag is optional and every other reviewer is required, and the per-reviewer "is this reviewer optional?" questions are not asked. When no `--reviewer[-N]-optional` flag is present, each reviewer's optionality is asked interactively, in reviewer order, as a yes/no single-select with `no` (required) as the default. A `--reviewer-N-optional` whose index exceeds the reviewer-list length is a usage error pinned by the install contract.

Both interactive questions go through the shared prompt helper (see [src/commands/.docs/rules/install/interactive-prompts.md](/src/commands/.docs/rules/install/interactive-prompts.md)) and follow its non-TTY policy like every other prompt.

## No-op defaults

The defaults reproduce a build with no weighted reviews: `minimumReviews` equal to the reviewer-list length, so no reviewer is ever cancelled, and every reviewer required. A user who accepts the highlighted minimum and marks no reviewer optional persists exactly that.

## Failure signals

- `install` asks a weighted-review question, or accepts a weighted-review flag, for a single-reviewer configuration.
- `install` shows a gate ("configure weighted reviews?") question instead of presenting the section directly for a two-or-more-reviewer list.
- `install` persists a `minimumReviews` outside `[1, T]`, or proceeds interactively after a `--reviewer-minimum` outside that range instead of exiting with a usage error.
- `install` writes a `.flanders/config.json` whose `minimumReviews` field or any per-reviewer `optional` field is absent (see [src/workspace/.docs/rules/flanders-config/file-format.md](/src/workspace/.docs/rules/flanders-config/file-format.md)).
