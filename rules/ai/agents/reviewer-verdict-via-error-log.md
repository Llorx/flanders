# The review verdict is carried by the `error.log` file, never by the reviewer's output or exit code

The outcome of the adversarial review stage of the `implement` inner loop is signalled exclusively by the `error.log` file inside the temporary folder: whether the reviewer produced the file at all, and whether it holds any content after the reviewer finishes. The orchestrator deletes that file before the reviewer runs, the reviewer is required to produce it again — appending the violations it finds, or creating it empty when it finds none — and the orchestrator decides pass, fail, or reviewer-malfunction from the file's existence and content alone. Nothing the reviewer prints to its own output, and no process exit code, is consulted to decide the verdict.

## Who this applies to

- **Subject:** the orchestrator of the `implement` inner loop at its adversarial review stage (the decision of pass vs. fail vs. re-launch), and the construction of the reviewer prompt. Both are bound by the single signalling protocol this rule pins.
- **Not subject:** the AI runner, which only streams the reviewer's events and surfaces a successful completion or an error; it does not read `error.log` and does not decide the verdict.

## Behavior

1. **Delete before.** The orchestrator deletes `error.log` before launching the reviewer, so the file does not exist when the reviewer starts. The orchestrator does not leave behind an emptied file — the file is absent, so that the reviewer recreating it is observable.

2. **Reviewer always produces the file.** The reviewer prompt instructs the reviewer to append every violation it finds into `error.log` as it discovers it — append mode, never overwrite, so the file is created on first write and partial findings survive even if the reviewer is interrupted mid-review. When the reviewer finds no violation across every verification, it must still create `error.log` as an empty file as its final act, so that the file always exists once the reviewer has run to a verdict. The reviewer must not write a pass confirmation or any other non-violation content into `error.log`: any content there is read as a failure.

3. **No prescribed reviewer output format.** The reviewer's streamed output — the text it prints, which flows to the UI per `cli-commands/implement/ui.md` — has no required shape. The reviewer is free to narrate, summarize, or format its reasoning however it wants. The orchestrator does not parse that output for a verdict token, and the reviewer is not asked to emit one.

4. **Decide from the file's existence and trimmed content.** After the reviewer invocation completes successfully, the orchestrator inspects `error.log`:
   - **Absent** — the reviewer did not produce the file it was required to produce, so it did not run to a verdict. The orchestrator re-launches the reviewer (see step 7); an absent file is never read as a pass.
   - **Present and empty after trimming** surrounding whitespace, including newlines — the review passed.
   - **Present and non-empty after trimming** — the review failed, and that text is the next iteration's briefing.

5. **Exit code is never the signal.** The orchestrator does not use the reviewer process's exit code to decide the verdict. A successful single-turn agent invocation exits zero regardless of whether the reviewer found violations, so the exit code carries no verdict.

6. **Errors are not passes.** The inspection of step 4 is reached only after a successful reviewer completion. A reviewer invocation that ends in an error is handled by the runner's retry policy (`rules/ai/retry/retry-on-errors-and-rate-limits.md`) and never reaches the inspection, so a reviewer that fails before writing cannot be mistaken for a passing review.

7. **A missing file re-launches the reviewer, unbounded.** When step 4 finds the file absent, the orchestrator launches a fresh reviewer invocation — there is no reviewer-to-reviewer continuity, so the re-launch starts clean like any other reviewer invocation. The re-launch repeats every time the file is still absent, with no maximum count, mirroring the runner retry policy's absorption of transient failures. A missing file never consumes a worker iteration and never restarts the worker; only the reviewer is re-run.

## Why

An LLM reviewer does not reliably honor an instruction to end with a single bare `PASS` or `FAIL` line: it wraps the token in markdown (for example `**PASS**`), prepends prose, or restructures the verdict, and a parser keying on the literal token then misreads a genuine pass as an unrecognized verdict and burns an iteration re-running work that was already correct. The process exit code is no better: a completed agent turn exits zero whether the reviewer passed or failed the work. A file the orchestrator controls — deleted before, inspected after — removes both failure modes: the presence of content is an unambiguous, format-independent signal that does not depend on the reviewer phrasing anything a particular way.

Deleting the file rather than emptying it closes a further hole: if the orchestrator merely emptied the file, a reviewer that silently did nothing — never inspected the diff, never wrote anything — would leave the file empty and be misread as a clean pass. By requiring the reviewer to recreate the file as its proof of having run to a verdict, an empty file means "the reviewer looked and found nothing," while an absent file means "the reviewer never reached a verdict" and is re-run instead of trusted.

## Failure signals

- The orchestrator parses the reviewer's streamed or final output for a `PASS`/`FAIL` token, or any other verdict marker, to decide the outcome.
- The orchestrator uses the reviewer process's exit code as the verdict.
- The reviewer prompt does not instruct the reviewer to write the violations it finds into `error.log`, or instructs it to overwrite the file instead of appending.
- The reviewer prompt does not instruct the reviewer to create an empty `error.log` when it finds no violation, so a clean review leaves the file absent and indistinguishable from a reviewer that never ran.
- The reviewer prompt instructs the reviewer to write a pass confirmation, or any other non-violation content, into `error.log`, so a clean review leaves the file non-empty.
- The orchestrator empties `error.log` before the reviewer runs instead of deleting it, so a reviewer that silently does nothing leaves an empty file that is misread as a pass.
- The orchestrator reads an absent `error.log` after a successful reviewer completion as a pass instead of re-launching the reviewer.
- The orchestrator decides without trimming surrounding whitespace, so a stray newline or space turns a passing review into a failure.
- The orchestrator inspects `error.log` after a reviewer invocation that errored rather than completed, producing a false pass from an absent or empty file.
