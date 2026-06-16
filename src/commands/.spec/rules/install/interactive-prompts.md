# Interactive prompts go through the shared prompt helper

Every interactive question `install` asks the user — skills tool, scope, worker tool, worker model, worker effort, and, for each reviewer in the configured list, that reviewer's tool, model, and effort, plus the `Configure another reviewer?` question that extends the reviewer list, and, when two or more reviewers are configured, the minimum-reviews question and the per-reviewer optional questions (see [src/commands/.spec/rules/install/weighted-reviews-configuration.md](/src/commands/.spec/rules/install/weighted-reviews-configuration.md)) — goes through the same prompt helper that `implement` uses for its plan-selection question. The `Configure another reviewer?` question is a single-select (yes/no) rendered through the helper's single-select function like every other bounded choice. There is one prompt helper for the whole library, and every interactive prompt across every command goes through it.

## Who this applies to

- **Subject:** every Flanders command that prompts the user interactively. Today that is `install` (all the questions listed above) and `implement` (its plan-selection prompt when `plans/` has more than one file).
- **Not subject:** ad-hoc one-off prompts inside subagents or other code paths the user does not directly interact with. Subagents do not prompt the user; they exit and surface what they need.

## What "the shared prompt helper" means

The helper is a single module exporting at minimum:

- A **single-select** function that takes an array of selectable entries and renders them as a numbered or arrow-navigable list, returning the chosen entry.
- A **free-text** function that takes an optional placeholder string and returns the user's typed answer (empty string when the user just presses Enter).

Both functions accept the question text as input and render it consistently across commands: same prefix style, same color (if any), same handling of Ctrl+C (abort the command with a non-zero exit and a short diagnostic).

The helper lives in one file and is imported by every prompting command. A second implementation of single-select or free-text behavior elsewhere in the codebase is a violation of this rule, even if functionally equivalent.

## Dependency policy

The helper is implemented on top of Node.js's standard library — `node:readline`, `node:tty`, `node:process` — and any internal Flanders utility code. It does not introduce a production dependency, per [.spec/rules/dependencies/no-production-dependencies.md](/.spec/rules/dependencies/no-production-dependencies.md). If the helper grows beyond what stdlib can reasonably support, the right move is to drop the affected ergonomic feature, not to add a runtime dependency.

## Non-TTY behavior

When stdin is not a TTY, the helper does not attempt to render an interactive list. It either:

1. Falls back to a deterministic read-from-stdin mode that consumes one answer per question in the order the command would have asked them; or
2. Refuses to run and exits non-zero with a diagnostic that asks the user to either re-run interactively or supply all flag-driven answers.

Which of the two is implemented is a choice the helper pins for the whole library; both are consistent with this rule as long as the same behavior holds for every prompting command. Mixing the two — one command falls back to stdin, another refuses — is a violation.

## Failure signals

- A command opens its own `readline` interface or reads from stdin directly instead of going through the helper, even for "just one quick prompt".
- A command uses a different prompt library (third-party or hand-rolled) for one or more of its questions.
- The helper's behavior diverges between commands — for example, Ctrl+C aborts in `install` but not in `implement`, or the list rendering uses different styles in the two commands.
- The helper adds a production dependency to satisfy a UX feature.
- A subagent prompts the user through the helper or through any other mechanism. Subagents are not interactive; they exit and surface what they need.
