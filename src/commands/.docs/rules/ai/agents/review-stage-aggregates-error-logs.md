# The review-stage verdict is the trimmed concatenation of every per-reviewer error file, on one linear path

The adversarial review stage produces a single verdict from the per-reviewer error files by following one linear path with no per-file presence branching: read every per-reviewer error file, concatenate their contents in reviewer order with one newline between files, trim the concatenation, and treat a non-empty result as the failure. Each step has one responsibility — read all, concatenate, trim, test for emptiness — and the test is performed once on the combined string, never as a per-file "does this one have content?" branch.

## Who this applies to

- **Subject:** the orchestrator of the `implement` inner loop, at the adversarial review stage, once every configured reviewer has run to a verdict (every per-reviewer error file is present per `src/commands/.docs/rules/ai/agents/reviewer-verdict-via-error-log.md`).
- **Not subject:** the reviewers themselves and the AI runner. The reviewers each write their own per-reviewer error file; this rule governs only how the orchestrator combines those files into the stage verdict.

## Behavior

After every reviewer has run to a verdict, the orchestrator forms the stage verdict in this fixed order:

1. **Read all.** Read the contents of every per-reviewer verdict file — the `error.log` inside each reviewer's own temporary folder, taken in reviewer order (reviewer 1 first) through the last configured reviewer. A reviewer that found no violation left its file empty; that empty content is read like any other, with no special-casing.

2. **Concatenate.** Join the contents in reviewer order (reviewer 1 first) with exactly one newline (`\n`) between consecutive files. The join does not inspect whether a given file is empty before adding it — every file is concatenated unconditionally.

3. **Trim.** Trim surrounding whitespace, including blank lines and newlines, from the concatenated string.

4. **Test once.** The trimmed string is the verdict signal:
   - **Empty** — every reviewer passed; the review stage passed.
   - **Non-empty** — at least one reviewer recorded violations; the review stage failed, and the trimmed (or full) concatenation is the next iteration's briefing.

Before the review round runs, the orchestrator deletes the aggregate `error.log` briefing file, so a stale briefing written by an earlier stage never survives into the review round. On a failed review, the orchestrator then writes the concatenated reviewer violations into that same `error.log` briefing file inside the temporary folder (the same file the build, test, and commit stages use), so the next worker iteration is briefed through the single generic briefing path.

## Why one linear path

Branching per file — "if this reviewer's file has content, mark a failure; otherwise skip it" — multiplies the decision points and invites bugs where one path forgets to trim, or treats an empty-but-present file differently from an absent one. Because every passing reviewer contributes the empty string, an unconditional read-concatenate-trim-test collapses the entire stage decision into a single emptiness check on one combined string: no reviewer needs to be inspected individually, and the same code handles one reviewer or many identically.

## Failure signals

- The orchestrator decides the stage verdict by checking each per-reviewer error file individually ("any file non-empty ⇒ fail") instead of concatenating first and testing the combined string once.
- The orchestrator skips a per-reviewer error file from the concatenation because it looks empty, instead of concatenating every file unconditionally.
- The concatenation omits the single-newline separator between files, so adjacent reviewers' violations run together on one line.
- The orchestrator tests the concatenation for emptiness without trimming first, so a stray newline from an otherwise-clean round is misread as a failure.
- A failed review does not write the aggregated violations into the `error.log` briefing file, leaving the next worker iteration without the combined reviewer findings.
- The orchestrator leaves a stale `error.log` in place before the review round instead of deleting it, so a briefing from an earlier stage can be mistaken for a review result.
