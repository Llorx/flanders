# No Flanders adversarial reviewer runs the build or test scripts

No Flanders adversarial reviewer executes the build or the test command. By the time a reviewer runs, build and test have already passed against the changes under review: in the `implement` command the iteration loop's build and test stages gate entry into the review stage (see `.docs/contracts/cli-commands/implement/iteration-loop.md`), and in `/flanders-work` the session's own build and test gates must pass before each review round (see `.docs/contracts/ai-skills/work-skill.md` and `src/prompts/.docs/rules/ai/skills/work/review-loop-driven-by-error-log-presence.md`). Both gate flows are the same validation defined in `.docs/contracts/shared/build-test-validation.md`. The reviewer establishes every toolchain-guarded and test-guarded claim by naming the automated failure or the asserting test a regression would trip, per `src/commands/.docs/rules/ai/agents/evidence/claim-evidence-classification.md`, never by invoking build or test itself.

## Who this applies to

- **Subject:** the construction of every Flanders adversarial reviewer prompt — the `implement` command's reviewer(s) (see `.docs/contracts/cli-commands/implement/iteration-loop.md` and `src/commands/.docs/rules/ai/agents/parallel-reviewers-run-concurrently.md`) and the `/flanders-work` skill's reviewer subagent (see `.docs/contracts/ai-skills/work-skill.md` and `src/prompts/.docs/rules/ai/skills/work/reviewer-hosted-as-in-session-subagent.md`).
- **Not subject:**
  - The build and test gates that precede the review on each surface — the `implement` orchestrator's build and test stages, and the `/flanders-work` session's build and test gates — which run the commands as the validation gates ahead of the review.
  - The worker (in `implement`) and the `/flanders-work` session in its work-and-rework role, which produce the changes and run build and test to validate them; this rule binds the reviewer role, not the role that produces the work.

## Behavior

1. **No build or test execution by the reviewer.** The reviewer prompt does not instruct or license the reviewer to run the build command or the test command, and the reviewer does not run them — neither directly, nor through the project's package manager, nor through any wrapper.
2. **Toolchain-guarded claims by named signal.** For a toolchain-guarded claim, the reviewer confirms the claim by naming the build, type, link, lint, or runtime failure a regression would trigger, relying on the build and test gates that already passed before the review. It does not run the commands again to obtain that signal.
3. **Test-guarded claims by named test.** For a test-guarded claim, the reviewer confirms the claim by citing the asserting test whose assertion a regression would trip, not by running the test suite.
4. **Only read-only git commands.** The only commands the reviewer runs are the read-only git operations it uses to derive the change set (see `src/prompts/.docs/rules/ai/review/reviewer-derives-change-set-from-git.md`).

## Why

On each surface the build and test gates run, and must pass, before the review is reached, against the very changes under review. Re-running them inside the reviewer therefore re-validates work the surface has already validated, consuming time and tokens for no added signal, and — for the test command — risks producing build artifacts or coverage files that break the reviewer's read-only stance on the project (see `src/commands/.docs/rules/ai/agents/parallel-reviewers-run-concurrently.md`). The reviewer's distinct value is the inspection-and-classification audit the build and test gates cannot perform; its evidence for a toolchain-guarded or test-guarded claim is the named signal, which it states without execution.

## Failure signals

- The reviewer invokes the build command or the test command — directly, through the package manager, or through any wrapper.
- The reviewer prompt instructs or licenses the reviewer to "run the build", "run the tests", or "re-run the toolchain".
- The reviewer marks a toolchain-guarded or test-guarded claim satisfied by reporting the exit status of a build or test run it performed itself, instead of by naming the automated failure or the asserting test a regression would trip.
