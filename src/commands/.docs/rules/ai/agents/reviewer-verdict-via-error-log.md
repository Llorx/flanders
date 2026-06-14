# The `implement` orchestrator decides each reviewer's verdict from its own per-reviewer error file — deleted before, inspected after

The orchestrator of the `implement` inner loop gives each configured adversarial reviewer its own verdict file — the `error.log` inside that reviewer's own temporary folder, a folder created independently of the main temporary folder and of every other reviewer's folder (see [.docs/contracts/cli-commands/implement/workspace.md](/.docs/contracts/cli-commands/implement/workspace.md)). The orchestrator deletes that file before the reviewer runs, requires the reviewer to produce it again, and decides that reviewer's outcome solely from whether the file is present and what it holds — never from anything the reviewer printed to its output and never from a process exit code. The reviewer's own obligation to write the file (append violations, create it empty when there are none, never write non-violation content) is the shared [src/prompts/.docs/rules/ai/review/reviewer-records-verdict-via-error-log.md](/src/prompts/.docs/rules/ai/review/reviewer-records-verdict-via-error-log.md); how the per-reviewer files combine into the stage verdict is [src/commands/.docs/rules/ai/agents/review-stage-aggregates-error-logs.md](/src/commands/.docs/rules/ai/agents/review-stage-aggregates-error-logs.md).

## Who this applies to

- **Subject:** the orchestrator of the `implement` inner loop at its adversarial review stage — the per-reviewer delete-before / inspect-after / re-launch protocol and the per-reviewer folder isolation. Each statement below applies independently to every configured reviewer and that reviewer's own per-reviewer error file.
- **Not subject:** the AI runner, which only streams each reviewer's events and surfaces a successful completion or an error; it does not read any per-reviewer error file and does not decide any verdict. Also not subject: the construction of the reviewer prompt's instruction to write the file, which is the shared rule named above.

## Behavior

1. **Delete before.** The orchestrator deletes the reviewer's `error.log` before launching that reviewer — leaving the reviewer's own temporary folder itself in place — so the file does not exist when the reviewer starts. The orchestrator does not leave behind an emptied file: the file is absent, so the reviewer recreating it is observable.

2. **A present file means the reviewer ran to a verdict.** After a reviewer invocation completes successfully, the orchestrator inspects that reviewer's per-reviewer error file:
   - **Absent** — the reviewer did not produce the file it was required to produce, so it did not run to a verdict. The orchestrator re-launches that same reviewer (see point 5); an absent file is never read as a pass and never contributes to the stage verdict.
   - **Present** — the reviewer ran to a verdict, and the file's contents (empty or not) are what the stage aggregation consumes.

3. **Exit code is never the signal.** The orchestrator does not use a reviewer process's exit code to decide its result. A successful single-turn agent invocation exits zero regardless of whether the reviewer found violations, so the exit code carries no verdict.

4. **Errors are not passes.** The inspection in point 2 is reached only after a successful reviewer completion. A reviewer invocation that ends in an error is handled by the runner's retry policy ([src/ai/.docs/rules/retry/retry-on-errors-and-rate-limits.md](/src/ai/.docs/rules/retry/retry-on-errors-and-rate-limits.md)) and never reaches the inspection, so a reviewer that fails before writing cannot be mistaken for a passing review.

5. **A missing file re-launches that reviewer, unbounded.** When point 2 finds a reviewer's file absent, the orchestrator launches a fresh invocation of that same reviewer — there is no reviewer-to-reviewer continuity, so the re-launch starts clean like any other reviewer invocation. The re-launch repeats every time the file is still absent, with no maximum count, mirroring the runner retry policy's absorption of transient failures. A missing file never consumes a worker iteration and never restarts the worker; only the affected reviewer is re-run.

6. **Per-reviewer folder isolation.** Each reviewer's verdict file lives in that reviewer's own independently created temporary folder, never in a folder shared with another reviewer. The reviewers run concurrently (see [src/commands/.docs/rules/ai/agents/parallel-reviewers-run-concurrently.md](/src/commands/.docs/rules/ai/agents/parallel-reviewers-run-concurrently.md)), so a per-reviewer file means no reviewer's writes race against another's and each verdict survives on its own; allocating each folder independently means a reviewer that inspects the directory holding its own verdict file finds only its own verdict there and cannot derive a sibling reviewer's verdict location from the path it was given.

## Why

An LLM reviewer does not reliably end with a single bare `PASS`/`FAIL` line, and a completed agent turn exits zero whether it passed or failed the work — so neither the streamed output nor the exit code is a trustworthy verdict (the reviewer-side rationale is in the shared rule named above). A file the orchestrator controls — deleted before, inspected after — turns the verdict into the presence and content of a file, which does not depend on the reviewer phrasing anything a particular way.

Deleting the file rather than emptying it closes a further hole: if the orchestrator merely emptied the file, a reviewer that silently did nothing — never inspected the changes, never wrote anything — would leave the file empty and be misread as a clean pass. By requiring the reviewer to recreate the file as its proof of having run to a verdict, an empty file means "the reviewer looked and found nothing," while an absent file means "the reviewer never reached a verdict" and is re-run instead of trusted.

## Failure signals

- The orchestrator parses a reviewer's streamed or final output for a `PASS`/`FAIL` token, or any other verdict marker, to decide that reviewer's outcome.
- The orchestrator uses a reviewer process's exit code as its verdict.
- Two reviewers are pointed at the same error file, or at `error.log` files that share a common folder, instead of one `error.log` in each reviewer's own independently created temporary folder.
- The orchestrator empties a reviewer's per-reviewer error file before that reviewer runs instead of deleting it, so a reviewer that silently does nothing leaves an empty file that is misread as a pass.
- The orchestrator reads an absent per-reviewer error file after a successful reviewer completion as a pass instead of re-launching that reviewer.
- The orchestrator inspects a per-reviewer error file after a reviewer invocation that errored rather than completed, producing a false pass from an absent or empty file.
