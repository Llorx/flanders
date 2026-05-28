# The review verdict is carried by the `error.log` file, never by the reviewer's output or exit code

The outcome of the adversarial review stage of the `implement` inner loop is signalled exclusively by whether the `error.log` file inside the temporary folder holds any content after the reviewer finishes. The orchestrator empties that file before the reviewer runs, the reviewer appends the violations it finds into it, and the orchestrator decides pass or fail from the file's content alone. Nothing the reviewer prints to its own output, and no process exit code, is consulted to decide the verdict.

## Who this applies to

- **Subject:** the orchestrator of the `implement` inner loop at its adversarial review stage (the decision of pass vs. fail), and the construction of the reviewer prompt. Both are bound by the single signalling protocol this rule pins.
- **Not subject:** the AI runner, which only streams the reviewer's events and surfaces a successful completion or an error; it does not read `error.log` and does not decide the verdict.

## Behavior

1. **Empty before.** The orchestrator empties `error.log` before launching the reviewer, so the file starts each review with no content left over from any earlier stage or iteration.

2. **Reviewer writes only violations, by append.** The reviewer prompt instructs the reviewer to append every violation it finds into `error.log` as it discovers it — append mode, never overwrite, so partial findings survive even if the reviewer is interrupted mid-review. When the reviewer finds no violation, it writes nothing, leaving `error.log` empty. The reviewer must not write a pass confirmation or any other non-violation content into `error.log`: any content there is read as a failure.

3. **No prescribed reviewer output format.** The reviewer's streamed output — the text it prints, which flows to the UI per `cli-commands/implement/ui.md` — has no required shape. The reviewer is free to narrate, summarize, or format its reasoning however it wants. The orchestrator does not parse that output for a verdict token, and the reviewer is not asked to emit one.

4. **Decide from the trimmed file only.** After the reviewer invocation completes successfully, the orchestrator reads `error.log` and trims surrounding whitespace, including newlines, from its contents. Empty after trimming means the review passed; any remaining non-whitespace text means the review failed, and that text is the next iteration's briefing.

5. **Exit code is never the signal.** The orchestrator does not use the reviewer process's exit code to decide the verdict. A successful single-turn agent invocation exits zero regardless of whether the reviewer found violations, so the exit code carries no verdict.

6. **Errors are not passes.** The file inspection of step 4 is reached only after a successful reviewer completion. A reviewer invocation that ends in an error is handled by the runner's retry policy (`rules/ai/retry/retry-on-errors-and-rate-limits.md`) and never reaches the inspection, so a reviewer that fails before writing cannot be mistaken for a passing review.

## Why

An LLM reviewer does not reliably honor an instruction to end with a single bare `PASS` or `FAIL` line: it wraps the token in markdown (for example `**PASS**`), prepends prose, or restructures the verdict, and a parser keying on the literal token then misreads a genuine pass as an unrecognized verdict and burns an iteration re-running work that was already correct. The process exit code is no better: a completed agent turn exits zero whether the reviewer passed or failed the work. A file the orchestrator controls — emptied before, inspected after — removes both failure modes: the presence of content is an unambiguous, format-independent signal that does not depend on the reviewer phrasing anything a particular way.

## Failure signals

- The orchestrator parses the reviewer's streamed or final output for a `PASS`/`FAIL` token, or any other verdict marker, to decide the outcome.
- The orchestrator uses the reviewer process's exit code as the verdict.
- The reviewer prompt does not instruct the reviewer to write the violations it finds into `error.log`, or instructs it to overwrite the file instead of appending.
- The reviewer prompt instructs the reviewer to write a pass confirmation, or any other non-violation content, into `error.log`, so a clean review leaves the file non-empty.
- The orchestrator does not empty `error.log` before the reviewer runs, so content from a previous stage or iteration is misread as the current review's result.
- The orchestrator decides without trimming surrounding whitespace, so a stray newline or space turns a passing review into a failure.
- The orchestrator inspects `error.log` after a reviewer invocation that errored rather than completed, producing a false pass from an empty file.
