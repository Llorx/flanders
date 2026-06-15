# A flag-supplied answer skips its interactive prompt

When the user supplies a flag whose value answers one of the install questions, the corresponding interactive prompt is not shown. The flag value is taken as the user's answer for that question. Questions whose answers come through different flags are independent: supplying `--worker-tool=claude` does not skip the worker model question; only `--worker-model=...` does.

## Who this applies to

- **Subject:** the `install` command, while it collects answers and before it writes any file.
- **Not subject:** subagents or any other command. No other command in Flanders today has flag-driven answers; if a future command grows them, the same mechanic applies but is pinned by that command's own rule, not by this one.

## Mapping flag → question

The mapping between flags pinned by [.docs/contracts/cli-commands/install.md](/.docs/contracts/cli-commands/install.md) and the interactive questions they answer is:

| Flag | Question it answers |
|------|---------------------|
| `--project` or `--global` | Scope |
| `--skills-tool=<value>` | Skills tool |
| `--worker-tool=<value>` | Worker tool |
| `--worker-model=<value>` | Worker model |
| `--worker-effort=<value>` | Worker effort |
| `--reviewer-tool=<value>` | Reviewer 1 tool |
| `--reviewer-model=<value>` | Reviewer 1 model |
| `--reviewer-effort=<value>` | Reviewer 1 effort |
| `--reviewer-N-tool=<value>` | Reviewer N tool (N ≥ 2) |
| `--reviewer-N-model=<value>` | Reviewer N model (N ≥ 2) |
| `--reviewer-N-effort=<value>` | Reviewer N effort (N ≥ 2) |

Any question whose flag is not present in the command line is asked interactively in the order pinned by the contract. Any question whose flag is present is recorded with the flag's value and not asked.

## Reviewer flags fix the reviewer-list length and skip the "configure another reviewer?" prompt

The reviewers are an ordered list addressed by 1-based index per [.docs/contracts/cli-commands/install.md](/.docs/contracts/cli-commands/install.md). When at least one reviewer flag (`--reviewer-tool/-model/-effort` or any `--reviewer-N-*`) is present, the presence of those flags answers the `Configure another reviewer?` question: the reviewer-list length is fixed by the contiguous reviewer indices the flags supply, and the `Configure another reviewer?` prompt is therefore not shown. Within that fixed list, each individual reviewer field still follows the same per-field skip as every other question — a field whose flag is present is recorded from the flag, a field whose flag is absent is asked interactively. When no reviewer flag is present at all, the `Configure another reviewer?` prompt is shown and drives the list length interactively.

## Empty values are valid answers

For `--worker-model`, `--worker-effort`, `--reviewer-model`, `--reviewer-effort`, and their indexed forms `--reviewer-N-model`, `--reviewer-N-effort`, an empty value is a valid answer that resolves to `""` in `.flanders/config.json` per [src/workspace/.docs/rules/flanders-config/file-format.md](/src/workspace/.docs/rules/flanders-config/file-format.md). An empty value is therefore distinct from "flag not supplied":

- Flag not supplied → the question is asked interactively.
- Flag supplied with an empty value (for example `--worker-model=`) → the question is not asked; the persisted value is `""` ("default configured model"/"default configured effort").

The set of valid values is closed for the tool flags — `--worker-tool`, `--reviewer-tool`, `--reviewer-N-tool`, and `--skills-tool` — and for the effort flags when the tool they apply to is `codex`: `--worker-effort` / `--reviewer-effort` / `--reviewer-N-effort` then validate against Codex's documented effort set. A supplied value outside a closed set is a usage error pinned by the install contract, and this rule does not relax that. By contrast, the model flags (`--worker-model`, `--reviewer-model`, `--reviewer-N-model`) for every tool, and the effort flags when the tool they apply to is `claude`, are open: they accept any value verbatim and are never rejected on value-set grounds (see [.docs/contracts/cli-commands/install.md](/.docs/contracts/cli-commands/install.md)).

## Order of validation

Flag-value validation runs before any interactive prompt is shown. A flag with an invalid value causes `install` to exit non-zero with a diagnostic naming the flag and the offending value, before asking any other question. The user does not get half-way through the interactive flow only to discover that an earlier flag was malformed.

## Failure signals

- A flag is supplied with a valid value and the question it answers is still shown to the user interactively.
- A flag is supplied with an invalid value and the command starts the interactive flow instead of exiting with a usage error.
- A flag's value is ignored and the interactive answer overrides it.
- The empty-value semantics differ between flag and interactive: for example, leaving the model question empty interactively persists `""`, but `--worker-model=` either errors or persists something else.
- The flag-driven skip silently overrides the contract's prompt order — for example, `--reviewer-tool=claude` is supplied but the worker tool question is rendered after the reviewer tool question instead of before it. The contract's order is fixed even when some questions are skipped.
- A model flag value, or a `claude` effort flag value, that is not among the curated suggestions is rejected as a usage error instead of being accepted verbatim.
