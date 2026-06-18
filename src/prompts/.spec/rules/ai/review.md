# Adversarial reviewer prompt rules

## Every Flanders adversarial reviewer derives the change set from `git status`, not from `git diff` alone

Every Flanders adversarial reviewer treats git as the authoritative source for the complete set of files under review. It enumerates that set with `git status --porcelain` — which surfaces modified, created, deleted, and renamed files in one pass, including created files that were never staged — and inspects every file in the set. Relying on `git diff` or `git diff --stat` alone is not enough: those surfaces only report tracked changes, so a file that was created but never `git add`-ed is untracked and never appears in them, and a reviewer anchored on diff alone can miss a brand-new file in full.

### Who this applies to

- **Subject:** the construction of every Flanders adversarial reviewer prompt — the `implement` command's reviewer(s) (see [.spec/contracts/cli-commands/implement/iteration-loop.md](/.spec/contracts/cli-commands/implement/iteration-loop.md)) and the `/flanders-work` skill's reviewer subagent (see [.spec/contracts/ai-skills/work-skill.md](/.spec/contracts/ai-skills/work-skill.md)) — at the point where the prompt instructs the reviewer how to determine the change set under review. The change set under review is the worker's uncommitted changes for `implement`, and the working-tree changes present when the review runs for `/flanders-work`. The project is always a git repository in both cases, so this enumeration is unconditional.
- **Not subject:** the worker and other agents; this rule governs only how the adversarial reviewer enumerates the change set, not any other reviewer obligation. It also does not govern how the orchestrator or skill provisions or inspects the reviewer's verdict file.

### Behavior

When the reviewer determines the change set under review:

1. **Enumerate with `git status --porcelain`.** The reviewer runs `git status --porcelain` and reads its output as the authoritative, complete enumeration: tracked modifications (` M`, `M `), staged or unstaged creations, untracked creations (`??`), deletions (` D`, `D `), and renames (`R `). This enumeration — not the list of files the request or task happens to name — is the set the reviewer must account for.

2. **Inspect every file in the set.** The reviewer inspects each file the enumeration reports. It does not narrow its inspection to the files the request or task references when `git status` reports more, and it does not skip a created or deleted file because it was not mentioned.

3. **Read content the right way per file kind.** For tracked modifications, the reviewer inspects content with `git diff` (and `git diff --cached` for staged hunks). For created files that are still untracked — which `git diff` does not surface — the reviewer inspects the file by reading it directly from disk. A created file is never left uninspected on the grounds that `git diff` showed nothing for it.

When the enumeration above is empty — `git status --porcelain` reports no files — the verdict the reviewer reaches is pinned by [src/prompts/.spec/rules/ai/review.md#when-the-change-set-is-empty-the-reviewer-judges-the-spec-against-the-committed-working-tree-not-against-the-absence-of-a-diff](/src/prompts/.spec/rules/ai/review.md#when-the-change-set-is-empty-the-reviewer-judges-the-spec-against-the-committed-working-tree-not-against-the-absence-of-a-diff).

All of these are read-only git operations and are permitted under [src/commands/.spec/rules/ai/agents.md#autonomous-subagents-never-write-to-git](/src/commands/.spec/rules/ai/agents.md#autonomous-subagents-never-write-to-git); this rule never authorizes the reviewer to mutate repository state.

### Why

The changes are uncommitted when the reviewer runs, and the agent that produced them does not reliably stage them. `git diff HEAD` and `git diff --stat` report only tracked paths, so a newly created file that was never `git add`-ed is invisible to them. A reviewer that discovers the changes through diff alone therefore has a blind spot precisely where a whole new file was added — the case where an unreviewed file is most dangerous. `git status --porcelain` lists tracked changes and untracked creations together, in a stable machine-readable form, so making it the authoritative enumeration removes the blind spot and guarantees the reviewer accounts for every file that was touched, created, or removed.

### Failure signals

- The reviewer determines the change set from `git diff`, `git diff HEAD`, or `git diff --stat` alone and never runs `git status`, so untracked created files are absent from what it reviews.
- A file that was created but not staged exists in the work tree, yet the reviewer never inspects it because no diff surface reported it.
- The reviewer confines its inspection to the files the request or task references while `git status` reports additional modified, created, or deleted files that go unexamined.
- The reviewer sees an untracked created file in `git status` but skips its content because `git diff` produced no hunks for it, instead of reading the file directly.

## When the change set is empty, the reviewer judges the spec against the committed working tree, not against the absence of a diff

When a Flanders adversarial reviewer enumerates the change set under review and that enumeration is empty — `git status --porcelain` reports nothing, and both the unstaged and staged diffs are empty — the empty change set is not itself a failure. The reviewer reaches its verdict by judging the spec under review against the committed working tree at `HEAD`, and it passes when that spec is already satisfied there.

This is the case of an idempotent re-application: work that a prior step already committed legitimately leaves nothing to change, so the current review produces no diff while the code that satisfies the spec is present at `HEAD`.

### Who this applies to

- **Subject:** every Flanders adversarial reviewer — the `implement` command's reviewer(s) (see [.spec/contracts/cli-commands/implement/iteration-loop.md](/.spec/contracts/cli-commands/implement/iteration-loop.md)) and the `/flanders-work` skill's reviewer subagent (see [.spec/contracts/ai-skills/work-skill.md](/.spec/contracts/ai-skills/work-skill.md)) — at the moment it decides its verdict, but only when the change set enumerated per [src/prompts/.spec/rules/ai/review.md#every-flanders-adversarial-reviewer-derives-the-change-set-from-git-status-not-from-git-diff-alone](/src/prompts/.spec/rules/ai/review.md#every-flanders-adversarial-reviewer-derives-the-change-set-from-git-status-not-from-git-diff-alone) is empty. The spec under review is the plan task and its acceptance criteria for `implement`, and the user's request for `/flanders-work`.
- **Not subject:** the reviewer when the change set is non-empty — the standard review of the changes is unchanged and is governed by the reviewer's other obligations.

### Behavior

When the enumerated change set is empty:

1. **The empty change set is not a failure on its own.** The reviewer does not record a violation for the sole reason that there is no diff this cycle. The absence of a diff is the expected shape of an idempotent re-application of already-committed work.

2. **The spec is judged against `HEAD`.** The reviewer verifies each element of the spec against the committed working tree, drawing the evidence each element's classification requires per [src/commands/.spec/rules/ai/evidence.md#a-claims-evidence-requirement-is-set-by-what-signal-can-soundly-observe-its-regression](/src/commands/.spec/rules/ai/evidence.md#a-claims-evidence-requirement-is-set-by-what-signal-can-soundly-observe-its-regression): for a toolchain-guarded element, the automated signal the project already runs; for a test-guarded element, an existing passing test whose assertion a regression would trip; for a review-adjudicated element, the reviewer's inspection of the full working tree at `HEAD`. The reviewer does not require the evidence to originate from an uncommitted diff.

3. **The verdict follows from the spec, not from the diff's size.** The reviewer passes — recording its verdict by leaving its error-log file empty per [src/prompts/.spec/rules/ai/review.md#every-flanders-adversarial-reviewer-records-its-verdict-by-writing-violations-into-its-error-log-file-never-via-its-output-or-exit-code](/src/prompts/.spec/rules/ai/review.md#every-flanders-adversarial-reviewer-records-its-verdict-by-writing-violations-into-its-error-log-file-never-via-its-output-or-exit-code) — when the spec under review is satisfied at `HEAD`. It records a violation only for a spec element, contract, or rule that is genuinely unsatisfied at `HEAD`.

### Why

An agent that correctly determines its work is already satisfied by committed code produces no diff. A reviewer that treats the empty diff as proof that "the spec carries no evidence" fails such work even though the code is present and its tests pass. That failure is a false negative: it consumes a full additional iteration in which the work re-runs and again produces nothing, and the state does not change. Anchoring the verdict to the committed working tree removes that false negative, because the evidence each spec element needs already exists at `HEAD` through the same classification the project applies to every other claim: an existing test, an automated signal, or a full-working-tree inspection.

### Failure signals

- The reviewer records a violation whose sole basis is that `git status --porcelain` is empty or that the diff contains no hunks.
- The reviewer requires a spec element's evidence to live in an uncommitted diff and disregards an existing test, an automated signal, or the committed code at `HEAD` that already satisfies it.
- Two reviewers of the same empty change set reach opposite verdicts because one judges the spec against `HEAD` and the other treats the empty diff as a failure.

## No Flanders adversarial reviewer runs the build or test scripts

No Flanders adversarial reviewer executes the build or the test command. By the time a reviewer runs, build and test have already passed against the changes under review: in the `implement` command the iteration loop's build and test stages gate entry into the review stage (see [.spec/contracts/cli-commands/implement/iteration-loop.md](/.spec/contracts/cli-commands/implement/iteration-loop.md)), and in `/flanders-work` the session's own build and test gates must pass before each review round (see [.spec/contracts/ai-skills/work-skill.md](/.spec/contracts/ai-skills/work-skill.md) and [src/prompts/.spec/rules/ai/skills/work.md#the-flanders-work-review-loop-is-driven-by-the-presence-and-content-of-a-temporary-error-log-file](/src/prompts/.spec/rules/ai/skills/work.md#the-flanders-work-review-loop-is-driven-by-the-presence-and-content-of-a-temporary-error-log-file)). Both gate flows are the same validation defined in [.spec/contracts/shared/build-test-validation.md](/.spec/contracts/shared/build-test-validation.md). The reviewer establishes every toolchain-guarded and test-guarded claim by naming the automated failure or the asserting test a regression would trip, per [src/commands/.spec/rules/ai/evidence.md#a-claims-evidence-requirement-is-set-by-what-signal-can-soundly-observe-its-regression](/src/commands/.spec/rules/ai/evidence.md#a-claims-evidence-requirement-is-set-by-what-signal-can-soundly-observe-its-regression), never by invoking build or test itself.

### Who this applies to

- **Subject:** the construction of every Flanders adversarial reviewer prompt — the `implement` command's reviewer(s) (see [.spec/contracts/cli-commands/implement/iteration-loop.md](/.spec/contracts/cli-commands/implement/iteration-loop.md) and [src/commands/.spec/rules/ai/agents.md#reviewers-run-concurrently-one-independent-runner-invocation-each-and-the-stage-ends-when-the-last-finishes](/src/commands/.spec/rules/ai/agents.md#reviewers-run-concurrently-one-independent-runner-invocation-each-and-the-stage-ends-when-the-last-finishes)) and the `/flanders-work` skill's reviewer subagent (see [.spec/contracts/ai-skills/work-skill.md](/.spec/contracts/ai-skills/work-skill.md) and [src/prompts/.spec/rules/ai/skills/work.md#the-flanders-work-reviewer-is-a-single-in-session-subagent-independent-of-the-flanders-configuration](/src/prompts/.spec/rules/ai/skills/work.md#the-flanders-work-reviewer-is-a-single-in-session-subagent-independent-of-the-flanders-configuration)).
- **Not subject:**
  - The build and test gates that precede the review on each surface — the `implement` orchestrator's build and test stages, and the `/flanders-work` session's build and test gates — which run the commands as the validation gates ahead of the review.
  - The worker (in `implement`) and the `/flanders-work` session in its work-and-rework role, which produce the changes and run build and test to validate them; this rule binds the reviewer role, not the role that produces the work.

### Behavior

1. **No build or test execution by the reviewer.** The reviewer prompt does not instruct or license the reviewer to run the build command or the test command, and the reviewer does not run them — neither directly, nor through the project's package manager, nor through any wrapper.
2. **Toolchain-guarded claims by named signal.** For a toolchain-guarded claim, the reviewer confirms the claim by naming the build, type, link, lint, or runtime failure a regression would trigger, relying on the build and test gates that already passed before the review. It does not run the commands again to obtain that signal.
3. **Test-guarded claims by named test.** For a test-guarded claim, the reviewer confirms the claim by citing the asserting test whose assertion a regression would trip, not by running the test suite.
4. **Only read-only git commands.** The only commands the reviewer runs are the read-only git operations it uses to derive the change set (see [src/prompts/.spec/rules/ai/review.md#every-flanders-adversarial-reviewer-derives-the-change-set-from-git-status-not-from-git-diff-alone](/src/prompts/.spec/rules/ai/review.md#every-flanders-adversarial-reviewer-derives-the-change-set-from-git-status-not-from-git-diff-alone)).

### Why

On each surface the build and test gates run, and must pass, before the review is reached, against the very changes under review. Re-running them inside the reviewer therefore re-validates work the surface has already validated, consuming time and tokens for no added signal, and — for the test command — risks producing build artifacts or coverage files that break the reviewer's read-only stance on the project (see [src/commands/.spec/rules/ai/agents.md#reviewers-run-concurrently-one-independent-runner-invocation-each-and-the-stage-ends-when-the-last-finishes](/src/commands/.spec/rules/ai/agents.md#reviewers-run-concurrently-one-independent-runner-invocation-each-and-the-stage-ends-when-the-last-finishes)). The reviewer's distinct value is the inspection-and-classification audit the build and test gates cannot perform; its evidence for a toolchain-guarded or test-guarded claim is the named signal, which it states without execution.

### Failure signals

- The reviewer invokes the build command or the test command — directly, through the package manager, or through any wrapper.
- The reviewer prompt instructs or licenses the reviewer to "run the build", "run the tests", or "re-run the toolchain".
- The reviewer marks a toolchain-guarded or test-guarded claim satisfied by reporting the exit status of a build or test run it performed itself, instead of by naming the automated failure or the asserting test a regression would trip.

## Every Flanders adversarial reviewer prompt enumerates the same FAIL conditions and demands exhaustive enumeration

Every Flanders adversarial reviewer prompt instructs the reviewer to look adversarially for why the changes under review FAIL, against a fixed set of FAIL conditions, and to enumerate every violation it finds rather than stopping at the first. This is the review methodology shared across Flanders' reviewers; what differs per surface is the spec the reviewer measures the work against, not the conditions or the exhaustiveness discipline.

### Who this applies to

- **Subject:** the construction of every Flanders adversarial reviewer prompt — the `implement` command's reviewer(s) (see [.spec/contracts/cli-commands/implement/iteration-loop.md](/.spec/contracts/cli-commands/implement/iteration-loop.md)) and the `/flanders-work` skill's reviewer subagent (see [.spec/contracts/ai-skills/work-skill.md](/.spec/contracts/ai-skills/work-skill.md)). The spec under review is the plan task and its acceptance criteria for `implement`, and the user's request for `/flanders-work`.
- **Not subject:** the worker, the build/test detection agent, and the content-skill final validators (`/flanders-spec`, `/flanders-plan`), whose gate is governed by [src/prompts/.spec/rules/ai/skills/skills-common.md#every-flanders-content-skill-hosts-its-final-validator-the-same-way](/src/prompts/.spec/rules/ai/skills/skills-common.md#every-flanders-content-skill-hosts-its-final-validator-the-same-way).

### Behavior

The reviewer prompt instructs the reviewer to FAIL on ANY of the following five conditions; a violation of any one is a FAIL:

1. The spec under review is not satisfied.
2. A contract referenced by the work is not honored.
3. A rule referenced by the work is not actively applied — acknowledging a rule is not enough; the changes must demonstrate compliance.
4. A contract or rule from the project's spec corpus that the reviewer determines should have applied to the changes but was not honored, even if the spec under review did not reference it.
5. A behavior rule whose `.spec/flanders` scope encloses the files the changes touch is not honored, even if the spec under review did not reference it.

The prompt also imposes:

- **Exhaustiveness.** The reviewer runs every verification it is required to run and every additional check its judgment deems applicable, and does not stop when the first violation is discovered. The five conditions above and the spec-verification protocol below are executed in full on every invocation; encountering a violation in one does not exempt the reviewer from completing the rest. The goal is that a single review produces the complete list of fixes the next round of work needs.
- **Pattern occurrence enumeration.** When a violation is an instance of a pattern, the reviewer enumerates every occurrence of that pattern across the file and every other file in the same module or suite where it could recur, each as its own independently-actionable entry with its `file:line`. A FAIL that cites only a subset of a pattern's occurrences is itself a failure of this rule.
- **Spec-verification protocol.** Before deciding the work satisfies the spec under review, the reviewer enumerates every element of that spec as a separate item and classifies each by the regression-signal question of [src/commands/.spec/rules/ai/evidence.md#a-claims-evidence-requirement-is-set-by-what-signal-can-soundly-observe-its-regression](/src/commands/.spec/rules/ai/evidence.md#a-claims-evidence-requirement-is-set-by-what-signal-can-soundly-observe-its-regression), confirming the changes carry evidence of the type that classification requires. A spec element lacking that evidence is a violation. A spec element that enumerates N independent facts expands into N items per [src/commands/.spec/rules/ai/evidence.md#a-claim-that-enumerates-n-facts-needs-n-independent-guards](/src/commands/.spec/rules/ai/evidence.md#a-claim-that-enumerates-n-facts-needs-n-independent-guards).

How the reviewer records the violations it finds is pinned by [src/prompts/.spec/rules/ai/review.md#every-flanders-adversarial-reviewer-records-its-verdict-by-writing-violations-into-its-error-log-file-never-via-its-output-or-exit-code](/src/prompts/.spec/rules/ai/review.md#every-flanders-adversarial-reviewer-records-its-verdict-by-writing-violations-into-its-error-log-file-never-via-its-output-or-exit-code).

### Why

The reviewer's value is the completeness of the fix list it produces. A reviewer that stops at the first violation, or that cites one occurrence of a recurring pattern, forces each subsequent round of work to rediscover the rest one at a time, multiplying iterations. Fixing the FAIL conditions in one shared place keeps every Flanders reviewer measuring the same five failure modes, so the only thing a surface specializes is the spec it holds the work to.

### Failure signals

- A reviewer prompt omits one of the five FAIL conditions, or narrows the corpus-wide conditions 4 and 5 to only the contracts, rules, or behavior rules the spec under review explicitly references.
- A reviewer prompt instructs the reviewer to stop at the first violation, or does not require enumerating every occurrence of a recurring pattern.
- A reviewer prompt drops the spec-verification protocol, letting the reviewer pass the work on "the code looks right" without classifying each spec element and confirming regression-detecting evidence.
- A reviewer prompt is constructed per surface with its own divergent FAIL conditions instead of building on this shared set.

## Every Flanders adversarial reviewer records its verdict by writing violations into its error-log file, never via its output or exit code

The outcome a Flanders adversarial reviewer signals is carried exclusively by its own verdict file — a fixed-name error-log file the reviewer is given. Whether the reviewer produced that file at all, and what it holds, is the only signal read from the reviewer. Nothing the reviewer prints to its streamed output, and no process exit code, is consulted to learn its verdict. This rule pins how every Flanders reviewer prompt instructs the reviewer to record its result; how the file is provisioned, inspected, and re-launched against differs per surface and is pinned separately.

### Who this applies to

- **Subject:** the construction of every Flanders adversarial reviewer prompt — the `implement` command's reviewer(s) (see [.spec/contracts/cli-commands/implement/iteration-loop.md](/.spec/contracts/cli-commands/implement/iteration-loop.md)) and the `/flanders-work` skill's reviewer subagent (see [.spec/contracts/ai-skills/work-skill.md](/.spec/contracts/ai-skills/work-skill.md)).
- **Not subject:** the lifecycle of the verdict file — its provisioning before the reviewer runs, its inspection afterward, and any re-launch on absence. That lifecycle is the orchestrating surface's, pinned for `implement` by [src/commands/.spec/rules/ai/agents.md#the-implement-orchestrator-decides-each-reviewers-verdict-from-its-own-per-reviewer-error-file--deleted-before-inspected-after](/src/commands/.spec/rules/ai/agents.md#the-implement-orchestrator-decides-each-reviewers-verdict-from-its-own-per-reviewer-error-file--deleted-before-inspected-after) and for `/flanders-work` by [src/prompts/.spec/rules/ai/skills/work.md#the-flanders-work-review-loop-is-driven-by-the-presence-and-content-of-a-temporary-error-log-file](/src/prompts/.spec/rules/ai/skills/work.md#the-flanders-work-review-loop-is-driven-by-the-presence-and-content-of-a-temporary-error-log-file).

### Behavior

The reviewer prompt instructs the reviewer to record its result through its error-log file, and only through that file:

1. **Append every violation as it is found.** The reviewer appends each violation to its error-log file as it discovers it — append mode, never overwrite — so the file is created on first write and partial findings survive even if the reviewer is interrupted mid-review. Each appended entry is independently actionable: precise enough that the next round of work can act on it from the file alone, citing concrete `file:line` references, contract or rule paths, and the exact behavior or evidence that is missing.

2. **Create the file empty when there is no violation.** When the reviewer finds no violation across every verification, it must still create its error-log file as an empty file as its final act, so the file always exists once the reviewer has run to a verdict.

3. **Never write non-violation content.** The reviewer must not write a pass confirmation or any other non-violation content into the file: any content there is read as a failure.

4. **The verdict lives only in the file.** The reviewer's streamed output has no prescribed format — it may narrate, summarize, or format its reasoning however it wants — and is never parsed for a verdict token. A process exit code is never the signal either: a completed single-turn agent invocation exits zero whether or not it found violations.

The reading of this signal — an absent file means the reviewer did not run to a verdict, a present empty file means a clean pass, a present non-empty file means violations — is performed by the orchestrating surface per the per-surface rules named under "Not subject".

### Why

An LLM reviewer does not reliably honor an instruction to end with a single bare `PASS`/`FAIL` line: it wraps the token in markdown, prepends prose, or restructures the verdict, and a parser keying on the token then misreads a genuine pass as an unrecognized verdict and burns a round re-running work that was already correct. The process exit code is no better: a completed agent turn exits zero whether the reviewer passed or failed the work. A file whose presence and content carry the verdict removes both failure modes: it is an unambiguous, format-independent signal that does not depend on the reviewer phrasing anything a particular way. Requiring the reviewer to create the file even on a clean pass makes "the reviewer looked and found nothing" distinguishable from "the reviewer never reached a verdict".

### Failure signals

- A reviewer prompt instructs the reviewer to end with a `PASS`/`FAIL` token, or lets its streamed output or exit code stand in for the verdict.
- A reviewer prompt does not instruct the reviewer to append the violations it finds into its error-log file, or instructs it to overwrite the file instead of appending.
- A reviewer prompt does not instruct the reviewer to create an empty file when it finds no violation, so a clean review leaves the file absent and indistinguishable from a reviewer that never ran.
- A reviewer prompt instructs the reviewer to write a pass confirmation, or any other non-violation content, into the file, so a clean review leaves the file non-empty.
- A violation entry is not independently actionable — it lacks the `file:line`, the contract or rule path, or the description of what is missing — forcing the next round of work to rediscover the problem.
