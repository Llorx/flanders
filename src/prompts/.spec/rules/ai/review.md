# Adversarial reviewer prompt rules

## Every Flanders adversarial reviewer derives the change set from `git status`, not from `git diff` alone

Every Flanders adversarial reviewer treats git as the authoritative source for the complete set of files under review. It enumerates that set with `git status --porcelain` — which surfaces modified, created, deleted, and renamed files in one pass, including created files that were never staged — and inspects every file in the set. Relying on `git diff` or `git diff --stat` alone is not enough: those surfaces only report tracked changes, so a file that was created but never `git add`-ed is untracked and never appears in them, and a reviewer anchored on diff alone can miss a brand-new file in full.

### Who this applies to

- **Subject:** the construction of every Flanders adversarial reviewer prompt — the `implement` command's reviewer(s) (see [.spec/contracts/cli-commands/implement/iteration-loop.md](/.spec/contracts/cli-commands/implement/iteration-loop.md)) and the `/flanders-implement` skill's reviewers (see [.spec/contracts/ai-skills/implement-skill.md](/.spec/contracts/ai-skills/implement-skill.md)) — at the point where the prompt instructs the reviewer how to determine the change set under review. The change set under review is the changes produced since the run baseline the orchestrating surface captured before its first iteration (see [.spec/contracts/shared/task-cycle.md#run-baseline](/.spec/contracts/shared/task-cycle.md#run-baseline)). The project is always a git repository, so this enumeration is unconditional.
- **Not subject:** the worker and other agents; this rule governs only how the adversarial reviewer enumerates the change set, not any other reviewer obligation. It also does not govern how the orchestrator or skill provisions or inspects the reviewer's verdict file.

### Behavior

When the reviewer determines the change set under review:

1. **Enumerate with `git status --porcelain`.** The reviewer runs `git status --porcelain` and reads its output as the authoritative, complete enumeration: tracked modifications (` M`, `M `), staged or unstaged creations, untracked creations (`??`), deletions (` D`, `D `), and renames (`R `). This enumeration — not the list of files the request or task happens to name — is the set the reviewer must account for.

2. **Inspect every file in the set.** The reviewer inspects each file the enumeration reports. It does not narrow its inspection to the files the request or task references when `git status` reports more, and it does not skip a created or deleted file because it was not mentioned.

3. **Read content the right way per file kind.** For tracked modifications, the reviewer inspects content with `git diff` (and `git diff --cached` for staged hunks). For created files that are still untracked — which `git diff` does not surface — the reviewer inspects the file by reading it directly from disk. A created file is never left uninspected on the grounds that `git diff` showed nothing for it.

4. **Reduce the enumeration to what postdates the baseline.** Content the surface's baseline already carried is not part of the change set, so the reviewer accounts for it as inherited state rather than as work under review. A path whose only pending content belongs to the baseline drops out of the set entirely; a path the baseline also carries stays in the set and contributes the content that postdates it. The orchestrating surface supplies what the reviewer needs to draw this line: the run baseline it captured before the first iteration.

When the change set the four steps above derive is empty — the enumeration, reduced to what postdates the baseline, leaves no file — the verdict the reviewer reaches is pinned by [src/prompts/.spec/rules/ai/review.md#when-the-change-set-is-empty-the-reviewer-judges-the-spec-against-the-tree-as-it-stands-not-against-the-absence-of-a-diff](/src/prompts/.spec/rules/ai/review.md#when-the-change-set-is-empty-the-reviewer-judges-the-spec-against-the-tree-as-it-stands-not-against-the-absence-of-a-diff). That is the trigger whether the enumeration itself was empty or the reduction emptied it: a tree whose only pending content is the baseline's carries no work under review.

All of these are read-only git operations and are permitted under [src/commands/.spec/rules/ai/agents.md#autonomous-subagents-never-write-to-git](/src/commands/.spec/rules/ai/agents.md#autonomous-subagents-never-write-to-git); this rule never authorizes the reviewer to mutate repository state.

### Why

The changes are uncommitted when the reviewer runs, and the agent that produced them does not reliably stage them. `git diff HEAD` and `git diff --stat` report only tracked paths, so a newly created file that was never `git add`-ed is invisible to them. A reviewer that discovers the changes through diff alone therefore has a blind spot precisely where a whole new file was added — the case where an unreviewed file is most dangerous. `git status --porcelain` lists tracked changes and untracked creations together, in a stable machine-readable form, so making it the authoritative enumeration removes the blind spot and guarantees the reviewer accounts for every file that was touched, created, or removed.

### Failure signals

- The reviewer determines the change set from `git diff`, `git diff HEAD`, or `git diff --stat` alone and never runs `git status`, so untracked created files are absent from what it reviews.
- A file that was created but not staged exists in the work tree, yet the reviewer never inspects it because no diff surface reported it.
- The reviewer confines its inspection to the files the request or task references while `git status` reports additional modified, created, or deleted files that go unexamined.
- The reviewer sees an untracked created file in `git status` but skips its content because `git diff` produced no hunks for it, instead of reading the file directly.
- The reviewer treats content the surface's baseline already carried as work under review, so state the run inherited is attributed to the agent that produced none of it.
- The reviewer drops a path from the change set because the baseline carries it, discarding the content a worker later added to that same path.

## When the change set is empty, the reviewer judges the spec against the tree as it stands, not against the absence of a diff

When a Flanders adversarial reviewer derives the change set under review and that change set is empty — the enumeration reports nothing, or what it reports is entirely content the surface's baseline already carried — the empty change set is not itself a failure. The reviewer reaches its verdict by judging the spec under review against the working tree as it stands, and it passes when that spec is already satisfied there.

This is the case of an idempotent re-application: work that a prior step already committed legitimately leaves nothing to change, so the current review produces no diff while the code that satisfies the spec is already present. The tree the reviewer judges is the committed tree at `HEAD` together with whatever the baseline holds — the baseline is excluded from the work under review, not from the state the spec is measured against, so a spec element a baseline change already satisfies is satisfied.

### Who this applies to

- **Subject:** every Flanders adversarial reviewer — the `implement` command's reviewer(s) (see [.spec/contracts/cli-commands/implement/iteration-loop.md](/.spec/contracts/cli-commands/implement/iteration-loop.md)) and the `/flanders-implement` skill's reviewers (see [.spec/contracts/ai-skills/implement-skill.md](/.spec/contracts/ai-skills/implement-skill.md)) — at the moment it decides its verdict, but only when the change set derived per [src/prompts/.spec/rules/ai/review.md#every-flanders-adversarial-reviewer-derives-the-change-set-from-git-status-not-from-git-diff-alone](/src/prompts/.spec/rules/ai/review.md#every-flanders-adversarial-reviewer-derives-the-change-set-from-git-status-not-from-git-diff-alone) — the enumeration after the baseline reduction — is empty. The spec under review is the plan task and its acceptance criteria for `implement`, and the user's request for `/flanders-implement`.
- **Not subject:** the reviewer when the change set is non-empty — the standard review of the changes is unchanged and is governed by the reviewer's other obligations.

### Behavior

When the derived change set is empty:

1. **The empty change set is not a failure on its own.** The reviewer does not record a violation for the sole reason that there is no diff this cycle. The absence of a diff is the expected shape of an idempotent re-application of already-committed work.

2. **The spec is judged against the tree as it stands.** The reviewer verifies each element of the spec against that tree — through the build and test gates that already passed before the review, an existing test whose assertion a regression would trip, or its own inspection of the full tree, as the element allows. The reviewer does not require the evidence to originate from an uncommitted diff.

3. **The verdict follows from the spec, not from the diff's size.** The reviewer passes — recording its verdict by leaving its error-log file empty per [src/prompts/.spec/rules/ai/review.md#every-flanders-adversarial-reviewer-records-its-verdict-by-writing-violations-into-its-error-log-file-never-via-its-output-or-exit-code](/src/prompts/.spec/rules/ai/review.md#every-flanders-adversarial-reviewer-records-its-verdict-by-writing-violations-into-its-error-log-file-never-via-its-output-or-exit-code) — when the spec under review is satisfied in that tree. It records a violation only for a spec element, contract, or rule that is genuinely unsatisfied there.

### Why

An agent that correctly determines its work is already satisfied by the code in front of it produces no diff. A reviewer that treats the empty diff as proof that "the spec carries no evidence" fails such work even though the code is present and its tests pass. That failure is a false negative: it consumes a full additional iteration in which the work re-runs and again produces nothing, and the state does not change. Anchoring the verdict to the tree as it stands removes that false negative, because the evidence each spec element needs already exists in that tree through the same classification the project applies to every other claim: an existing test, an automated signal, or a full-tree inspection. The tree is where the evidence is looked for whether the code that carries it was committed or arrived with the baseline; what the baseline changes is whose work is under review, not what the spec is measured against.

### Failure signals

- The reviewer records a violation whose sole basis is that the derived change set is empty or that the diff contains no hunks.
- The reviewer requires a spec element's evidence to live in an uncommitted diff and disregards an existing test, an automated signal, or the code already in the tree that satisfies it.
- Two reviewers of the same empty change set reach opposite verdicts because one judges the spec against the tree as it stands and the other treats the empty diff as a failure.
- The reviewer treats a change set the baseline reduction emptied as a non-empty one, so a tree whose only pending content is the baseline's is reviewed as though a worker had produced it.

## No Flanders adversarial reviewer runs the build or test scripts

No Flanders adversarial reviewer executes the build or the test command, and it performs no operation that writes to the project or the machine. The reviewer is an inspection-only role: it reads the working tree, the read-only git surface, and the answers of the Flanders commands that only report, and it creates, modifies, deletes, and renames nothing. Compiling the project and running its tests both generate files on the machine — build artifacts, coverage output, caches — so the reviewer runs neither. By the time a reviewer runs, build and test have already passed against the changes under review: the build and test stages of the single-task cycle gate entry into its review stage on every surface that runs it (see [.spec/contracts/shared/task-cycle.md](/.spec/contracts/shared/task-cycle.md)), and they are the validation defined in [.spec/contracts/shared/build-test-validation.md](/.spec/contracts/shared/build-test-validation.md). The reviewer therefore takes the build as succeeding and the tests as passing without running them, and confirms a claim that the build or an existing test would catch by naming that already-passed gate or that test, never by invoking build or test itself.

### Who this applies to

- **Subject:** the construction of every Flanders adversarial reviewer prompt — the `implement` command's reviewer(s) (see [.spec/contracts/cli-commands/implement/iteration-loop.md](/.spec/contracts/cli-commands/implement/iteration-loop.md) and [src/commands/.spec/rules/ai/agents.md#reviewers-run-concurrently-one-independent-invocation-each](/src/commands/.spec/rules/ai/agents.md#reviewers-run-concurrently-one-independent-invocation-each)) and the `/flanders-implement` skill's reviewers (see [.spec/contracts/ai-skills/implement-skill.md](/.spec/contracts/ai-skills/implement-skill.md) and [src/prompts/.spec/rules/ai/skills/implement.md#the-flanders-implement-skill-orchestrates-the-cycle-and-implements-nothing-itself](/src/prompts/.spec/rules/ai/skills/implement.md#the-flanders-implement-skill-orchestrates-the-cycle-and-implements-nothing-itself)).
- **Not subject:**
  - The build and test gates that precede the review on each surface — the `implement` orchestrator's build and test stages, and the `/flanders-implement` session's build and test gates — which run the commands as the validation gates ahead of the review.
  - The cycle's worker, which produces the changes the gates then validate; this rule binds the reviewer role, not the role that produces the work.

### Behavior

1. **No build, test, or file-writing execution by the reviewer.** The reviewer prompt does not instruct or license the reviewer to run the build command, the test command, or any other operation that generates files, and the reviewer runs none of them — neither directly, nor through the project's package manager, nor through any wrapper.
2. **The build is assumed to succeed.** For a claim a build, type, link, lint, or runtime failure would catch, the reviewer confirms it by naming that failure, relying on the build gate that already passed before the review. It does not run the build again to obtain the signal.
3. **The tests are assumed to pass.** For a claim an existing test would catch, the reviewer confirms it by citing the asserting test whose assertion a regression would trip, not by running the test suite.
4. **Only commands that report.** The only commands the reviewer runs are the read-only git operations it uses to derive the change set (see [src/prompts/.spec/rules/ai/review.md#every-flanders-adversarial-reviewer-derives-the-change-set-from-git-status-not-from-git-diff-alone](/src/prompts/.spec/rules/ai/review.md#every-flanders-adversarial-reviewer-derives-the-change-set-from-git-status-not-from-git-diff-alone)) and the Flanders spec-query commands its prompt names, which report which specs govern a path and write nothing (see [src/prompts/.spec/rules/ai/spec-query-commands-in-prompts.md](/src/prompts/.spec/rules/ai/spec-query-commands-in-prompts.md)).

### Why

On each surface the build and test gates run, and must pass, before the review is reached, against the very changes under review. Re-running them inside the reviewer therefore re-validates work the surface has already validated, consuming time and tokens for no added signal, and — because compiling and running tests both write files — breaks the reviewer's inspection-only stance on the project, which is what keeps the concurrent reviewers from contending over the working tree (see [src/commands/.spec/rules/ai/agents.md#reviewers-run-concurrently-one-independent-invocation-each](/src/commands/.spec/rules/ai/agents.md#reviewers-run-concurrently-one-independent-invocation-each)). The reviewer's distinct value is the inspection audit the build and test gates cannot perform; its evidence for a claim a gate would catch is the named gate or test, which it states without execution.

### Failure signals

- The reviewer invokes the build command or the test command — directly, through the package manager, or through any wrapper — or any other command that writes files to the project or the machine.
- The reviewer prompt instructs or licenses the reviewer to "run the build", "run the tests", or "re-run the toolchain".
- The reviewer marks a claim satisfied by reporting the exit status of a build or test run it performed itself, instead of by naming the automated failure or the asserting test a regression would trip.

## Every Flanders adversarial reviewer prompt enumerates the same FAIL conditions and demands exhaustive enumeration

Every Flanders adversarial reviewer prompt instructs the reviewer to look adversarially for why the changes under review FAIL, against a fixed set of FAIL conditions, and to enumerate every violation it finds rather than stopping at the first. This is the review methodology shared across Flanders' reviewers; what differs per surface is the spec the reviewer measures the work against, not the conditions or the exhaustiveness discipline.

### Who this applies to

- **Subject:** the construction of every Flanders adversarial reviewer prompt — the `implement` command's reviewer(s) (see [.spec/contracts/cli-commands/implement/iteration-loop.md](/.spec/contracts/cli-commands/implement/iteration-loop.md)) and the `/flanders-implement` skill's reviewers (see [.spec/contracts/ai-skills/implement-skill.md](/.spec/contracts/ai-skills/implement-skill.md)). The spec under review is the plan task and its acceptance criteria for `implement`, and the user's request for `/flanders-implement`.
- **Not subject:** the worker, the build/test detection agent, and the content-skill final validators (`/flanders-spec`, `/flanders-plan`), whose gate is governed by [src/prompts/.spec/rules/ai/skills/skills-common.md#every-flanders-content-skill-hosts-its-final-validator-the-same-way](/src/prompts/.spec/rules/ai/skills/skills-common.md#every-flanders-content-skill-hosts-its-final-validator-the-same-way).

### Behavior

The reviewer prompt instructs the reviewer to FAIL on ANY of the following five conditions; a violation of any one is a FAIL:

1. The spec under review is not satisfied.
2. A contract referenced by the work is not honored.
3. A rule referenced by the work is not actively applied — acknowledging a rule is not enough; the changes must demonstrate compliance.
4. A contract or rule from the project's spec corpus that the reviewer determines should have applied to the changes but was not honored, even if the spec under review did not reference it.
5. A behavior rule whose `.spec/flanders` scope encloses the files the changes touch is not honored, even if the spec under review did not reference it.

Conditions 2 through 5 are decided about the work the change set performs, per [src/prompts/.spec/rules/ai/review.md#every-flanders-adversarial-reviewer-judges-the-work-the-change-set-performs-never-work-the-spec-under-review-does-not-commission](/src/prompts/.spec/rules/ai/review.md#every-flanders-adversarial-reviewer-judges-the-work-the-change-set-performs-never-work-the-spec-under-review-does-not-commission). That scope leaves the corpus the reviewer consults undiminished — conditions 4 and 5 still reach every contract, rule, and behavior rule in the project, referenced or not — and bounds only what the changes are held answerable for.

The prompt also imposes:

- **Exhaustiveness.** The reviewer runs every verification it is required to run and every additional check its judgment deems applicable, and does not stop when the first violation is discovered. The five conditions above and the spec-verification protocol below are executed in full on every invocation; encountering a violation in one does not exempt the reviewer from completing the rest. The goal is that a single review produces the complete list of fixes the next round of work needs.
- **Pattern occurrence enumeration.** When a violation is an instance of a pattern, the reviewer enumerates every occurrence of that pattern across the file and every other file in the same module or suite where it could recur, each as its own independently-actionable entry with its `file:line`. A FAIL that cites only a subset of a pattern's occurrences is itself a failure of this rule.
- **Referenced-obligation enumeration.** Before deciding conditions 2, 3, 4, and 5 are met, the reviewer enumerates the discrete obligations of each contract and rule in scope — every contract and rule the work references, plus every corpus contract, rule, or behavior rule the reviewer judges should have applied — as separate items, and confirms each obligation is actively applied in the changes. A contract or rule that pins more than one discrete obligation — for example a list of required exclusions, a set of required surfaces, or several conditions stated in one section — is never satisfied by confirming the contract or rule "in general": each enumerated obligation is its own item with its own confirmation, and an obligation the changes leave unapplied, or that the reviewer never enumerated, is a violation. An enumerated obligation whose trigger the change set does not carry is recorded as untriggered rather than as a violation, per [src/prompts/.spec/rules/ai/review.md#every-flanders-adversarial-reviewer-judges-the-work-the-change-set-performs-never-work-the-spec-under-review-does-not-commission](/src/prompts/.spec/rules/ai/review.md#every-flanders-adversarial-reviewer-judges-the-work-the-change-set-performs-never-work-the-spec-under-review-does-not-commission). A contract or rule whose obligations enumerate N discrete facts expands into N items per [src/commands/.spec/rules/ai/evidence.md#a-claim-that-enumerates-n-facts-needs-n-independent-confirmations](/src/commands/.spec/rules/ai/evidence.md#a-claim-that-enumerates-n-facts-needs-n-independent-confirmations).
- **Spec-verification protocol.** Before deciding the work satisfies the spec under review, the reviewer enumerates every element of that spec — every acceptance criterion for `implement`, every obligation of the request for `/flanders-implement` — as a separate item and confirms the working-tree changes actually satisfy each one. A spec element the changes leave unsatisfied is a violation, never waved through on "the code looks right". A spec element that enumerates N independent facts expands into N items per [src/commands/.spec/rules/ai/evidence.md#a-claim-that-enumerates-n-facts-needs-n-independent-confirmations](/src/commands/.spec/rules/ai/evidence.md#a-claim-that-enumerates-n-facts-needs-n-independent-confirmations). The reviewer holds the work to this spec and to the contracts and rules in scope, and applies no test-adequacy, coverage, or regression standard of its own: it requires a test, a particular assertion, or a regression guard for a spec element only where a contract or rule in scope requires one, and it then enforces that requirement exactly as it enforces any other rule under conditions 3 and 4 above.

How the reviewer records the violations it finds is pinned by [src/prompts/.spec/rules/ai/review.md#every-flanders-adversarial-reviewer-records-its-verdict-by-writing-violations-into-its-error-log-file-never-via-its-output-or-exit-code](/src/prompts/.spec/rules/ai/review.md#every-flanders-adversarial-reviewer-records-its-verdict-by-writing-violations-into-its-error-log-file-never-via-its-output-or-exit-code).

### Why

The reviewer's value is the completeness of the fix list it produces. A reviewer that stops at the first violation, or that cites one occurrence of a recurring pattern, forces each subsequent round of work to rediscover the rest one at a time, multiplying iterations. Fixing the FAIL conditions in one shared place keeps every Flanders reviewer measuring the same five failure modes, so the only thing a surface specializes is the spec it holds the work to.

### Failure signals

- A reviewer prompt omits one of the five FAIL conditions, or narrows the corpus the reviewer consults under conditions 4 and 5 to only the contracts, rules, or behavior rules the spec under review explicitly references.
- A reviewer prompt instructs the reviewer to stop at the first violation, or does not require enumerating every occurrence of a recurring pattern.
- A reviewer prompt drops the spec-verification protocol, letting the reviewer pass the work on "the code looks right" without enumerating each spec element and confirming the changes satisfy it.
- A reviewer prompt lets the reviewer confirm a contract or rule applied "in general" without enumerating and checking each of its discrete obligations, so a multi-obligation rule — such as a required exclusion list — passes with one of its obligations unmet.
- A reviewer prompt bakes in a test-adequacy, coverage, or regression standard of its own, instead of requiring tests or particular assertions for a spec element only where a contract or rule in scope requires them.
- A reviewer prompt is constructed per surface with its own divergent FAIL conditions instead of building on this shared set.

## Every Flanders adversarial reviewer judges the work the change set performs, never work the spec under review does not commission

Every Flanders adversarial reviewer prompt bounds what the changes are answerable for to the work they actually perform. Each violation the reviewer records rests on one of exactly two grounds: an element of the spec under review that the changes leave unsatisfied, or the work the change set performed — the content it wrote, and any corpus obligation that content triggers. An obligation whose trigger the change set does not carry is not a violation of this work: the code that would activate it is code this change set did not write, and no element of the spec under review commissions writing it. The reviewer records such an obligation as untriggered and moves on.

This bounds the object of judgment, not the reviewer's reach. The reviewer still consults the whole spec corpus, still holds every element of the spec under review to a complete confirmation, and still reports an element the changes leave unsatisfied — including one left unsatisfied by omission, where the commissioned work is precisely the code that is missing. What it does not do is require code the spec under review never asked for, on the strength of a corpus obligation nothing in the change set activated.

### Who this applies to

- **Subject:** the construction of every Flanders adversarial reviewer prompt — the `implement` command's reviewer(s) (see [.spec/contracts/cli-commands/implement/iteration-loop.md](/.spec/contracts/cli-commands/implement/iteration-loop.md)) and the `/flanders-implement` skill's reviewers (see [.spec/contracts/ai-skills/implement-skill.md](/.spec/contracts/ai-skills/implement-skill.md)) — at the point where the prompt tells the reviewer what the changes are answerable for. The spec under review is the plan task and its acceptance criteria for `implement`, and the user's request for `/flanders-implement`.
- **Not subject:** the breadth of the corpus the reviewer consults, which conditions 4 and 5 of [src/prompts/.spec/rules/ai/review.md#every-flanders-adversarial-reviewer-prompt-enumerates-the-same-fail-conditions-and-demands-exhaustive-enumeration](/src/prompts/.spec/rules/ai/review.md#every-flanders-adversarial-reviewer-prompt-enumerates-the-same-fail-conditions-and-demands-exhaustive-enumeration) keep project-wide; and the elements of the spec under review, each of which is confirmed satisfied whether or not the change set carries a trigger for it. The comment-specific application of the same principle is pinned in [src/prompts/.spec/rules/ai/review.md#every-flanders-adversarial-reviewer-records-a-violation-for-a-source-comment-that-argues-the-change-instead-of-stating-a-constraint](/src/prompts/.spec/rules/ai/review.md#every-flanders-adversarial-reviewer-records-a-violation-for-a-source-comment-that-argues-the-change-instead-of-stating-a-constraint).

### Behavior

1. **Every violation names its ground.** For each violation it records, the reviewer identifies which of the two grounds it rests on: the unsatisfied element of the spec under review, or the content in the change set that carries the defect or triggers the obligation the changes leave unapplied.

2. **An obligation the change set does not trigger is untriggered, not violated.** When an obligation of a corpus contract, rule, or behavior rule would be satisfied only by code the change set did not write, and no element of the spec under review commissions that code, the reviewer records the obligation as untriggered by this work. A plan distributes one specification across ordered tasks, so an obligation belonging to work another task performs is outside what this change set answers for.

3. **A triggered obligation is enforced wherever its remedy lives.** When the change set does carry an obligation's trigger, the obligation is in scope even where satisfying it means writing code elsewhere — the file the trigger sits in does not bound the remedy. The complementary discipline, which keeps a task from triggering an obligation whose remedy it is not commissioned to deliver, binds the planner and is pinned in [src/prompts/.spec/rules/ai/skills/plan.md#flanders-plan-cuts-every-leaf-task-to-deliver-complete-every-obligation-its-own-work-triggers](/src/prompts/.spec/rules/ai/skills/plan.md#flanders-plan-cuts-every-leaf-task-to-deliver-complete-every-obligation-its-own-work-triggers).

### Why

A reviewer that holds one change answerable for the whole corpus fails work that was never commissioned, and the failure has no fix the work is authorized to make: satisfying it means performing another task's work, and honoring the task's own scope means leaving the finding open. The loop then cannot converge — each iteration re-earns the same findings until the run hard-stops — and the reviewer's report stops distinguishing the defects the work introduced from the specification the project has not finished implementing. Grounding every violation in the work performed keeps the report actionable by the agent receiving it, which is what makes an adversarial review worth an iteration. This is the same confinement [src/prompts/.spec/rules/ai/review.md#every-flanders-adversarial-reviewer-records-a-violation-for-a-source-comment-that-argues-the-change-instead-of-stating-a-constraint](/src/prompts/.spec/rules/ai/review.md#every-flanders-adversarial-reviewer-records-a-violation-for-a-source-comment-that-argues-the-change-instead-of-stating-a-constraint) applies to comments — the reviewer judges what the work wrote, not what it inherited — generalized to every obligation the reviewer enumerates.

### Failure signals

- A reviewer prompt lets the reviewer record a violation that rests on neither ground — neither an unsatisfied element of the spec under review nor the work the change set performed.
- A reviewer prompt has the reviewer demand code whose only basis is a corpus obligation nothing in the change set triggers, so the work is failed for a specification another task implements.
- A reviewer prompt narrows the corpus the reviewer consults, or lets an element of the spec under review pass unconfirmed, on the grounds that the change set carries no trigger for it.
- A reviewer prompt confines an obligation's remedy to the file whose content triggered it, so a triggered obligation goes unenforced because satisfying it requires touching another file.
- A reviewer prompt records an untriggered obligation as a violation instead of as untriggered, leaving the next round of work unable to tell which findings it is authorized to close.

## Every Flanders adversarial reviewer records its verdict by writing violations into its error-log file, never via its output or exit code

The outcome a Flanders adversarial reviewer signals is carried exclusively by its own verdict file — a fixed-name error-log file the reviewer is given. Whether the reviewer produced that file at all, and what it holds, is the only signal read from the reviewer. Nothing the reviewer prints to its streamed output, and no process exit code, is consulted to learn its verdict. This rule pins how every Flanders reviewer prompt instructs the reviewer to record its result; how the file is provisioned, inspected, and re-launched against differs per surface and is pinned separately.

### Who this applies to

- **Subject:** the construction of every Flanders adversarial reviewer prompt — the `implement` command's reviewer(s) (see [.spec/contracts/cli-commands/implement/iteration-loop.md](/.spec/contracts/cli-commands/implement/iteration-loop.md)) and the `/flanders-implement` skill's reviewers (see [.spec/contracts/ai-skills/implement-skill.md](/.spec/contracts/ai-skills/implement-skill.md)).
- **Not subject:** the lifecycle of the verdict file — its provisioning before the reviewer runs, its inspection afterward, and any re-launch on absence. That lifecycle belongs to the orchestrating surface and is pinned for every one of them by [src/commands/.spec/rules/ai/agents.md#the-review-round-orchestrator-decides-each-reviewers-verdict-from-its-own-per-reviewer-error-file--deleted-before-inspected-after](/src/commands/.spec/rules/ai/agents.md#the-review-round-orchestrator-decides-each-reviewers-verdict-from-its-own-per-reviewer-error-file--deleted-before-inspected-after).

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

## Every Flanders adversarial reviewer records a violation for a source comment that argues the change instead of stating a constraint

Every Flanders adversarial reviewer prompt instructs the reviewer to judge the comments the change set adds or modifies, and to record as a violation each one that argues the correctness of the change, cites a contract, rule, plan task, or reviewer finding, or narrates what the code previously did. The reviewer applies the same test the authoring prompt applies, pinned by [src/prompts/.spec/rules/ai/code-comment-economy.md#flanders-code-authoring-prompts-instruct-the-agent-that-a-source-comment-carries-only-what-the-code-cannot-express](/src/prompts/.spec/rules/ai/code-comment-economy.md#flanders-code-authoring-prompts-instruct-the-agent-that-a-source-comment-carries-only-what-the-code-cannot-express): a comment earns its place when it states an external constraint, an invariant the code cannot enforce, or a consequence a competent reader of the code alone would get wrong. The content a rule of the host project requires at that construct is never a violation, and any further content the same comment carries beyond what the rule requires is judged by the same test as any other comment.

### Who this applies to

- **Subject:** the construction of every Flanders adversarial reviewer prompt — the `implement` command's reviewer(s) (see [.spec/contracts/cli-commands/implement/iteration-loop.md](/.spec/contracts/cli-commands/implement/iteration-loop.md)) and the `/flanders-implement` skill's reviewers (see [.spec/contracts/ai-skills/implement-skill.md](/.spec/contracts/ai-skills/implement-skill.md)) — at the point where the prompt instructs the reviewer what to inspect in the change set, and only for the comments that change set adds or modifies.
- **Not subject:** comments in files the change set does not touch, and comments a touched file already carried unmodified — the reviewer judges what the work wrote, not the code it inherited. The authoring side of this discipline is pinned by [src/prompts/.spec/rules/ai/code-comment-economy.md#flanders-code-authoring-prompts-instruct-the-agent-that-a-source-comment-carries-only-what-the-code-cannot-express](/src/prompts/.spec/rules/ai/code-comment-economy.md#flanders-code-authoring-prompts-instruct-the-agent-that-a-source-comment-carries-only-what-the-code-cannot-express).

### Behavior

1. **Judge each added or modified comment.** For every comment the change set introduces or rewrites, the reviewer decides whether it states something the code cannot show. One that instead defends the diff, cites the obligation behind it, or records what the code used to do is a violation, and the reviewer records it with its `file:line` per [src/prompts/.spec/rules/ai/review.md#every-flanders-adversarial-reviewer-records-its-verdict-by-writing-violations-into-its-error-log-file-never-via-its-output-or-exit-code](/src/prompts/.spec/rules/ai/review.md#every-flanders-adversarial-reviewer-records-its-verdict-by-writing-violations-into-its-error-log-file-never-via-its-output-or-exit-code).

2. **Required content passes; the rest is judged.** The content a host-project rule mandates at that construct satisfies this check, and the reviewer confirms it rather than flagging it; any further content the same comment carries beyond what the rule mandates is judged by the test in item 1 like any other comment, and flagged when it fails that test.

### Why

The authoring instruction alone does not survive the loop. The pressure that produces these comments is renewed on every round by the demand that the changes demonstrate compliance, and an instruction carrying no verdict erodes against a standing incentive that does — the agent that annotates its diff is never penalized for it, while the agent that does not risks the FAIL. Putting the comments in the change set among the things the reviewer adjudicates gives the discipline the same footing as every other obligation the reviewer enumerates, so the incentive points the same way the instruction does. Confining the judgment to the comments the work wrote keeps the reviewer from turning every touched file into a cleanup mandate, which would expand each change beyond its own scope.

### Failure signals

- A reviewer prompt does not instruct the reviewer to judge the comments the change set adds or modifies, leaving the authoring instruction unenforced.
- A reviewer prompt has the reviewer flag a comment that states an external constraint, an invariant, or a consequence the code cannot show.
- A reviewer prompt has the reviewer flag the content a host-project rule requires at that construct.
- A reviewer prompt has the reviewer treat content a comment carries beyond what a host-project rule requires as immune from the test in item 1, leaving that further content unjudged.
- A reviewer prompt has the reviewer flag comments in files the change set does not touch, or comments a touched file carried unmodified.
