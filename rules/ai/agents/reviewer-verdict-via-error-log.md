# Each reviewer's verdict is carried by its own per-reviewer error file, never by the reviewer's output or exit code

The outcome each adversarial reviewer of the `implement` inner loop signals is carried exclusively by that reviewer's own verdict file — the `error.log` inside that reviewer's own temporary folder, a folder created independently of the main temporary folder and of every other reviewer's folder (see `cli-commands/implement/workspace.md`). Whether a reviewer produced its file at all, and what the file holds, is the only signal the orchestrator reads from that reviewer. The orchestrator deletes each per-reviewer `error.log` before its reviewer runs, the reviewer is required to produce its file again — appending the violations it finds, or creating it empty when it finds none — and the orchestrator never consults anything the reviewer printed to its own output, nor any process exit code, to learn that reviewer's result. How the per-reviewer files are combined into the stage verdict is pinned separately by `rules/ai/agents/review-stage-aggregates-error-logs.md`.

## Who this applies to

- **Subject:** the orchestrator of the `implement` inner loop at its adversarial review stage (the per-reviewer delete-before / recreate / re-launch protocol), and the construction of every reviewer prompt.
- **Not subject:** the AI runner, which only streams each reviewer's events and surfaces a successful completion or an error; it does not read any per-reviewer error file and does not decide any verdict.

## Behavior

Each statement below applies independently to every configured reviewer and that reviewer's own per-reviewer error file.

1. **Delete before.** The orchestrator deletes the reviewer's `error.log` before launching that reviewer — leaving the reviewer's own temporary folder itself in place — so the file does not exist when the reviewer starts. The orchestrator does not leave behind an emptied file — the file is absent, so that the reviewer recreating it is observable.

2. **The reviewer always produces its file.** The reviewer prompt instructs the reviewer to append every violation it finds into its own per-reviewer error file as it discovers it — append mode, never overwrite, so the file is created on first write and partial findings survive even if the reviewer is interrupted mid-review. When the reviewer finds no violation across every verification, it must still create its per-reviewer error file as an empty file as its final act, so that the file always exists once the reviewer has run to a verdict. The reviewer must not write a pass confirmation or any other non-violation content into its file: any content there is read as a violation.

3. **No prescribed reviewer output format.** A reviewer's streamed output — the text it prints, which flows to the UI per `cli-commands/implement/ui.md` — has no required shape. The reviewer is free to narrate, summarize, or format its reasoning however it wants. The orchestrator does not parse that output for a verdict token, and the reviewer is not asked to emit one.

4. **A present file means the reviewer ran to a verdict.** After a reviewer invocation completes successfully, the orchestrator inspects that reviewer's per-reviewer error file:
   - **Absent** — the reviewer did not produce the file it was required to produce, so it did not run to a verdict. The orchestrator re-launches that same reviewer (see step 7); an absent file is never read as a pass and never contributes to the stage verdict.
   - **Present** — the reviewer ran to a verdict, and the file's contents (empty or not) are what the stage aggregation consumes.

5. **Exit code is never the signal.** The orchestrator does not use a reviewer process's exit code to decide its result. A successful single-turn agent invocation exits zero regardless of whether the reviewer found violations, so the exit code carries no verdict.

6. **Errors are not passes.** The inspection of step 4 is reached only after a successful reviewer completion. A reviewer invocation that ends in an error is handled by the runner's retry policy (`rules/ai/retry/retry-on-errors-and-rate-limits.md`) and never reaches the inspection, so a reviewer that fails before writing cannot be mistaken for a passing review.

7. **A missing file re-launches that reviewer, unbounded.** When step 4 finds a reviewer's file absent, the orchestrator launches a fresh invocation of that same reviewer — there is no reviewer-to-reviewer continuity, so the re-launch starts clean like any other reviewer invocation. The re-launch repeats every time the file is still absent, with no maximum count, mirroring the runner retry policy's absorption of transient failures. A missing file never consumes a worker iteration and never restarts the worker; only the affected reviewer is re-run.

## Why

An LLM reviewer does not reliably honor an instruction to end with a single bare `PASS` or `FAIL` line: it wraps the token in markdown (for example `**PASS**`), prepends prose, or restructures the verdict, and a parser keying on the literal token then misreads a genuine pass as an unrecognized verdict and burns an iteration re-running work that was already correct. The process exit code is no better: a completed agent turn exits zero whether the reviewer passed or failed the work. A file the orchestrator controls — deleted before, inspected after — removes both failure modes: the presence of content is an unambiguous, format-independent signal that does not depend on the reviewer phrasing anything a particular way.

Deleting the file rather than emptying it closes a further hole: if the orchestrator merely emptied the file, a reviewer that silently did nothing — never inspected the diff, never wrote anything — would leave the file empty and be misread as a clean pass. By requiring the reviewer to recreate the file as its proof of having run to a verdict, an empty file means "the reviewer looked and found nothing," while an absent file means "the reviewer never reached a verdict" and is re-run instead of trusted.

Giving each reviewer its own file in its own independently created temporary folder rather than a shared one keeps the reviewers independent: they run concurrently (see `rules/ai/agents/parallel-reviewers-run-concurrently.md`), a per-reviewer file means no reviewer's writes race against another's and each reviewer's verdict survives on its own, and placing each reviewer's `error.log` in a folder allocated independently of every other reviewer's folder means a reviewer that inspects the directory holding its own verdict file finds only its own verdict there and cannot derive a sibling reviewer's verdict location from the path it was given.

## Failure signals

- The orchestrator parses a reviewer's streamed or final output for a `PASS`/`FAIL` token, or any other verdict marker, to decide that reviewer's outcome.
- The orchestrator uses a reviewer process's exit code as its verdict.
- A reviewer prompt does not instruct the reviewer to write the violations it finds into its own per-reviewer error file, or instructs it to overwrite the file instead of appending.
- A reviewer prompt does not instruct the reviewer to create an empty per-reviewer error file when it finds no violation, so a clean review leaves the file absent and indistinguishable from a reviewer that never ran.
- A reviewer prompt instructs the reviewer to write a pass confirmation, or any other non-violation content, into its per-reviewer error file, so a clean review leaves the file non-empty.
- Two reviewers are pointed at the same error file, or at `error.log` files that share a common folder, instead of one `error.log` in each reviewer's own independently created temporary folder.
- The orchestrator empties a reviewer's per-reviewer error file before that reviewer runs instead of deleting it, so a reviewer that silently does nothing leaves an empty file that is misread as a pass.
- The orchestrator reads an absent per-reviewer error file after a successful reviewer completion as a pass instead of re-launching that reviewer.
- The orchestrator inspects a per-reviewer error file after a reviewer invocation that errored rather than completed, producing a false pass from an absent or empty file.
