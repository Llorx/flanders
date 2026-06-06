# The /flanders-plan validator confirms the detected task count equals the count the host generated

The `/flanders-plan` validator does not only check that each line presented as a task is well-formed; it also confirms that no task the host generated was silently lost to a recognition failure. The host passes the validator the number of leaf task lines it generated, and the validator counts the lines that match the canonical task-line recognizer regex and confirms that count equals the host-supplied count exactly. Any inequality is a FAIL.

This closes a gap a per-line format check cannot: a line the host intended as a task but wrote in a shape the recognizer does not match — for example a line whose bracket is followed by `(` rather than the metrics object, so it reads as a link bullet — is invisible to a per-line check, because the validator cannot tell from the line alone that it was meant to be a task. The host-supplied count is the only ground truth that surfaces such a loss.

## Who this applies to

- **Subject:** the `/flanders-plan` skill, as the host that packages the validator's prompt — it MUST pass the number of leaf task lines it generated as an explicit input to the validator, alongside the inputs enumerated in `rules/ai/skills/plan/final-validator.md`.
- **Subject (when running as a subagent):** the validator instance, in counting recognized task lines and comparing that count to the host-supplied count.
- **Not subject:** the `/flanders-spec` validator, which audits a different artifact and has no task concept.

## The count check

- The host supplies a single non-negative integer: the number of leaf task lines it wrote into the plan.
- The validator counts every line in the plan that matches the canonical task-line recognizer regex pinned in `rules/ai/skills/plan/validator-matches-task-line-regex.md`.
- This check is PASS only when the counted number equals the host-supplied number exactly. A counted number lower than supplied (a generated task was not recognized — most often because it is malformed) and a counted number higher than supplied (a non-task line was recognized as a task) are both FAIL.

## How to apply this rule

- The host computes the expected count from the leaf tasks it generated and inlines that integer into the validator's prompt.
- The validator enumerates the recognized task lines, reports the count, and on inequality FAILs, naming the discrepancy as the expected count versus the detected count.

## Failure signals

- The host launches the validator without passing the expected leaf-task count.
- The validator reports PASS when the number of lines matching the canonical recognizer differs from the host-supplied count.
- The validator compares the counts approximately or tolerates an off-by-one instead of requiring exact equality.
