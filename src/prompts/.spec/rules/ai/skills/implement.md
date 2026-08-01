# /flanders-implement skill rules

## The `/flanders-implement` skill orchestrates the cycle and implements nothing itself

The `/flanders-implement` skill is the orchestrator of the single-task cycle, never one of its agents. Every AI the cycle spawns — the worker, each reviewer, and the build/test detect agent — runs as its own process of the AI tool the Flanders configuration names for that role, and the session the user invoked the skill in writes no project code of its own.

### Who this applies to

- **Subject:** the source content that produces the `/flanders-implement` skill artifact body — the prompt text the `install` command ships — at every point where it directs the skill to spawn an agent; and the `/flanders-implement` skill at runtime when it spawns one.
- **Not subject:** the `implement` command, which runs the same cycle through the AI runner (see [src/ai/.spec/contracts/ai-runner.md](/src/ai/.spec/contracts/ai-runner.md) and [.spec/contracts/cli-commands/implement/overview.md](/.spec/contracts/cli-commands/implement/overview.md)); the per-tool adapters, whose bypass prohibition binds flanders' own call sites and not a skill artifact running in a user project, where no flanders module is reachable at all; and the content-skill final validators, which are in-session subagents governed by [src/prompts/.spec/rules/ai/skills/skills-common.md#every-flanders-content-skill-hosts-its-final-validator-the-same-way](/src/prompts/.spec/rules/ai/skills/skills-common.md#every-flanders-content-skill-hosts-its-final-validator-the-same-way).

### Behavior

1. **The configuration selects every agent.** The skill resolves the Flanders configuration by the per-scope precedence of [.spec/contracts/shared/flanders-config.md](/.spec/contracts/shared/flanders-config.md). The worker and the detect agent take the configured worker fields; each reviewer takes its own configured entry. When no configuration is readable at any scope, the skill stops and tells the user to run `npx flanders install`; it invents no agent of its own.

2. **One process per agent, from that agent's own fields.** Each agent is launched as its own process of the AI tool its fields name, with that entry's own model, reasoning effort, and fast-mode setting. The invocation is non-interactive and grants the tool the maximum access its CLI offers, the same invocation surface the per-tool adapters realize (see [src/ai/.spec/rules/runner.md#every-ai-adapter-invokes-its-tool-non-interactively](/src/ai/.spec/rules/runner.md#every-ai-adapter-invokes-its-tool-non-interactively) and [src/ai/.spec/rules/runner.md#every-ai-adapter-grants-its-tool-the-maximum-access-its-cli-offers](/src/ai/.spec/rules/runner.md#every-ai-adapter-grants-its-tool-the-maximum-access-its-cli-offers)).

3. **The host session implements nothing.** The skill edits no project code, writes no test, and runs no build or test command in place of the cycle's gates. Its own work is orchestration: reading the configuration, provisioning the workspace, launching the agents, running the gates against the scripts the detect agent wrote, forming each round's verdict, committing, and reporting.

4. **Every process is awaited inside the turn that started it.** The skill waits for the processes it launched within the same turn in which it launched them, and it ends no turn while one of them is still running. An agent the round cancels is terminated before the round's verdict is formed, so no process survives the stage that started it.

5. **The prompts are self-contained.** Each agent's prompt is built from the shared Flanders methodology its role carries — the worker's from the cycle's worker-stage instructions, each reviewer's from the shared reviewer methodology of [src/prompts/.spec/rules/ai/review.md](/src/prompts/.spec/rules/ai/review.md), with the spec under review being the user's request. Because the prompts ship inside a skill artifact, they inline those obligations and carry no flanders-internal spec citations, per [src/prompts/.spec/rules/ai/skills/skills-common.md#flanders-skill-artifact-prompts-are-self-contained--no-citations-of-flanders-internal-spec-paths](/src/prompts/.spec/rules/ai/skills/skills-common.md#flanders-skill-artifact-prompts-are-self-contained--no-citations-of-flanders-internal-spec-paths).

### Why

A skill that both writes the code and judges the run collapses two roles the cycle deliberately separates. Putting the worker in its own configured process gives the work the tool and model the user chose for implementation rather than whichever session happened to invoke the skill, and it keeps the orchestrator's context free of the worker's reasoning — the same independence that makes each reviewer worth an iteration. It is also what lets one cycle serve both surfaces: the skill and the `implement` command drive identical stages, differing only in what supplies the task.

### Failure signals

- The skill edits project code, writes a test, or otherwise performs the worker's work in its own session.
- The skill runs an agent as a subagent of its own session, or performs an inline pass, instead of launching the configured processes.
- The skill invents an agent, or an agent's tool, model, effort, or fast-mode setting, instead of taking them from the configuration.
- The skill gives the detect agent or the worker a reviewer's fields, or the reviewers the worker's.
- The skill proceeds with some default when no Flanders configuration is readable, instead of stopping and pointing the user at `npx flanders install`.
- The skill ends a turn while a process it launched is still running, or leaves a cancelled agent's process alive.
- The skill launches an interactive invocation, or one that gates the tool's access, so an agent stalls waiting for an approval that never comes.
- An agent prompt cites a flanders-internal spec path instead of inlining the obligation.

## Every process the `/flanders-implement` skill launches runs unbounded in duration

The `/flanders-implement` skill launches each agent process — the worker, each reviewer, and the detect agent — and each run of the build and test scripts through the command facility of the AI tool it is hosted in, and it lets every one of them run until it exits. What ends the wait is the process reaching its result or the skill's own decision to terminate it; elapsed time never is.

### Who this applies to

- **Subject:** the source content that produces the `/flanders-implement` skill artifact body — the prompt text the `install` command ships — at every point where it directs the skill to launch an agent process or to run the build or test script; and the `/flanders-implement` skill at runtime when it launches one.
- **Not subject:** the `implement` command, whose agents are spawned through flanders' own process facility rather than a host tool's command facility (see [src/ai/.spec/contracts/ai-runner.md](/src/ai/.spec/contracts/ai-runner.md)); the content-skill validators, which are in-session subagents governed by [src/prompts/.spec/rules/ai/skills/skills-common.md#every-flanders-content-skill-hosts-its-final-validator-the-same-way](/src/prompts/.spec/rules/ai/skills/skills-common.md#every-flanders-content-skill-hosts-its-final-validator-the-same-way); and the short-lived commands the skill runs for its own bookkeeping — reading the configuration, provisioning the workspace, and its git commits — whose runtime never approaches such a limit.

### Behavior

1. **No limit where the facility lets one be omitted.** The skill names no time limit when it launches the process, so the facility waits on the process rather than on a clock.

2. **The facility's maximum where a limit is mandatory.** When the facility requires a time limit, or caps how long it will wait for a command, the skill supplies the highest value that facility accepts.

3. **Only the process ends the wait.** The skill stops waiting when the process exits, or when it terminates the process by a decision of its own — a reviewer the round cancels, an agent a hard stop ends. Because no wait is cut short by elapsed time, the awaiting obligation of [src/prompts/.spec/rules/ai/skills/implement.md#the-flanders-implement-skill-orchestrates-the-cycle-and-implements-nothing-itself](/src/prompts/.spec/rules/ai/skills/implement.md#the-flanders-implement-skill-orchestrates-the-cycle-and-implements-nothing-itself) holds for a process of any duration.

### Why

A worker implementing a task, a reviewer reading a whole change set against the corpus, and a full build or test suite each routinely run far longer than the default a command facility applies when its caller names none. A process killed at that boundary reaches no result, and the skill cannot tell it apart from an invocation that genuinely failed: it relaunches work that was progressing, spends that agent's error allowance on it, and every relaunch dies at the same boundary — a cycle that cannot finish for a reason nothing in the run reports. Naming no limit, or the largest the facility grants, is what lets each stage take as long as its work does.

### Failure signals

- The skill artifact body directs an agent launch or a gate run without stating that no time limit is supplied, leaving the facility's default in force.
- The skill supplies a time limit to a facility that would have accepted none.
- The skill supplies a value below the maximum where the facility requires a limit.
- An agent process or a gate run is killed for elapsed time, and the skill treats that killed invocation as an errored one, consuming the agent's error allowance.

## The `/flanders-implement` skill absorbs its agents' usage limits, errors, and login failures itself

The `/flanders-implement` skill launches its agents as bare AI-tool processes, with no AI runner between it and them, so nothing else absorbs an invocation that reaches no result. The skill takes that on, identically for the worker, each reviewer, and the detect agent: it waits out a usage limit, relaunches an errored invocation up to a bounded number of consecutive attempts, and stops on the spot when a tool reports it is not logged in.

### Who this applies to

- **Subject:** the source content that produces the `/flanders-implement` skill artifact body, and the `/flanders-implement` skill at runtime, for every agent invocation it makes that ends without its result.
- **Not subject:** the `implement` command, whose invocations are absorbed by the AI runner's retry policy instead (see [src/ai/.spec/rules/retry.md#the-runner-retries-retryable-errors-and-rate-limits-via-the-tool-interface-events](/src/ai/.spec/rules/retry.md#the-runner-retries-retryable-errors-and-rate-limits-via-the-tool-interface-events)); and the re-launch that follows a reviewer completing successfully without producing its verdict file, which is the shared lifecycle of [src/commands/.spec/rules/ai/agents.md#the-review-round-orchestrator-decides-each-reviewers-verdict-from-its-own-per-reviewer-error-file--deleted-before-inspected-after](/src/commands/.spec/rules/ai/agents.md#the-review-round-orchestrator-decides-each-reviewers-verdict-from-its-own-per-reviewer-error-file--deleted-before-inspected-after).

### Behavior

1. **A usage limit is a wait, not a failure.** An invocation that ends because its tool refused the request against a usage or rate limit is waited out and launched again, until it produces its result. For a reviewer this is the usage-limit wait the round-completion condition accounts for, so an optional reviewer still waiting when the round completes is cancelled per [src/commands/.spec/rules/ai/agents.md#a-review-round-completes--cancelling-any-still-waiting-reviewers--once-no-reviewer-is-running-every-required-reviewer-has-a-verdict-and-the-minimum-is-met](/src/commands/.spec/rules/ai/agents.md#a-review-round-completes--cancelling-any-still-waiting-reviewers--once-no-reviewer-is-running-every-required-reviewer-has-a-verdict-and-the-minimum-is-met) and a required one is always waited out. A worker or detect invocation has no such cancellation: its limit is always waited out.

2. **Any other error is relaunched, three consecutive times at most.** An invocation that ends in an error of any other kind is launched again. The skill counts those errors per agent and per iteration: when three consecutive invocations of the same agent in the same iteration have ended in an error, the skill stops, naming that agent and reproducing the error. Any invocation of that agent that completes resets its count to zero.

3. **A login failure ends the run.** An invocation reporting that its AI tool is not logged in is the fatal authentication failure of [.spec/contracts/shared/task-cycle.md#login-failure-hard-stop](/.spec/contracts/shared/task-cycle.md#login-failure-hard-stop). It is never relaunched, never counts toward the error allowance of point 2, and never consumes an iteration.

4. **A relaunched worker keeps its session.** Relaunching a worker invocation that reached no result is not a new iteration: the skill relaunches it the same way the current iteration would launch it, resuming the captured session when the iteration is one that resumes, so the retry does not restart the task from scratch.

### Why

The `implement` command gets this absorption for free from the AI runner, which retries transient failures, works a rate-limited invocation toward its reset, and marks a login failure fatal. A skill driving processes directly has none of that, and the two failure modes it must not conflate are a limit that will clear and an error that will not: waiting out the first is what lets a required reviewer — or the worker itself — finish at all, while relaunching the second forever would spin silently against a broken model name or a missing binary. Bounding the error path at three consecutive attempts keeps a genuine transient absorbed while surfacing a deterministic failure to the user, who is present and can fix it.

### Failure signals

- The skill treats a usage limit as an error, consuming the error allowance or abandoning an agent that would have finished once its limit cleared.
- The skill relaunches an errored invocation without bound, so a deterministic failure loops instead of surfacing.
- The skill stops on the first error instead of relaunching, or carries an error count across iterations or between agents, or fails to reset an agent's count after an invocation of it completes.
- The skill retries a login failure, or folds it into the error allowance, instead of ending the run.
- A relaunched worker is launched as a fresh invocation on an iteration that resumes, discarding the session the task had built.
- The skill counts a relaunch as an iteration, so absorbing transient failures burns the task's iteration budget.

## `/flanders-implement` commits the pending spec before the cycle and writes no plan file or Flanders configuration

Before it starts the cycle, the `/flanders-implement` skill commits every spec file carrying an uncommitted change. The commit that records the accepted work is the cycle's own commit stage, carrying a message the skill supplies. The skill creates or modifies no plan file and writes no Flanders configuration anywhere in the run.

### Who this applies to

- **Subject:** the source content that produces the `/flanders-implement` skill artifact body, and the `/flanders-implement` skill at runtime, at the point where it commits the pending spec and at the point where it supplies the cycle's commit message.
- **Not subject:** the agents the skill launches, which are forbidden from writing to git at all by [src/commands/.spec/rules/ai/agents.md#autonomous-subagents-never-write-to-git](/src/commands/.spec/rules/ai/agents.md#autonomous-subagents-never-write-to-git); and the commit stage's own staging and failure handling, pinned by [.spec/contracts/shared/task-cycle.md](/.spec/contracts/shared/task-cycle.md).

### Behavior

1. **The spec commit, before the cycle.** The skill collects every file whose path traverses a directory named `.spec` at any depth and that carries a change the latest commit does not hold — staged, unstaged, or an untracked addition alike — and commits exactly those files under the message `Commit pending spec changes`. When no such file exists, it makes no commit. It leaves every pending change to any other file untouched, so the run baseline the cycle then captures records those as inherited.

2. **The cycle's commit message.** The message the cycle's commit stage carries is a single line summarizing the work the worker performed, derived from the user's request.

3. **Both messages in English.** The fixed spec-commit message and the authored cycle message are both written in English, whatever language the skill is conversing with the user in per [.spec/contracts/ai-skills/interaction-language.md](/.spec/contracts/ai-skills/interaction-language.md).

4. **A failing spec commit stops the skill.** When the spec commit exits non-zero, the skill reports the git output to the user and stops before any work is performed. It is not retried.

5. **Nothing else is written.** The skill creates, modifies, deletes, and renames nothing in the `plans/` folder — it has no plan file, so there is no checkbox to flip and no metrics to record — and it writes nothing to `.flanders/`, which it only ever reads.

### Why

The spec commit is what makes the review converge. Each reviewer judges the changes produced since the run baseline, and a spec file the user left uncommitted would sit in that baseline's tree as a pending change — where it trips the spec-folder immovability the reviewer enforces, with no remedy the cycle is allowed to apply, because it may neither alter the user's spec work nor exclude it from the tree. Committing the spec first moves it behind the baseline, so the reviewers see only the work the worker performed. Ordering it before the baseline capture, rather than after, is what puts it there.

### Failure signals

- The cycle starts while a spec file still carries an uncommitted change, so the reviewers judge the user's spec work as part of the change set.
- The spec commit is taken after the run baseline is captured, so the spec sits in the baseline instead of behind it.
- The spec commit sweeps in files that are not spec files, or the skill skips it because the pending spec change was staged (or untracked) rather than an unstaged modification.
- The skill supplies no message for the cycle's commit, or writes either message in the interaction language instead of English.
- A failing spec commit is retried, or is treated as a failing gate that starts the cycle anyway, instead of stopping the skill with the git output reported.
- The skill writes a plan file, flips a checkbox or rewrites metrics in an existing plan file, or writes to `.flanders/`.

## The `/flanders-implement` skill diagnoses its own hard stop without being asked

When the cycle hard-stops on the iteration cap or on a worker-declared structural impossibility, the `/flanders-implement` skill does not merely report the stop: it runs the hard-stop diagnosis itself, in the same run, without first asking the user whether to analyze it.

### Who this applies to

- **Subject:** the source content that produces the `/flanders-implement` skill artifact body, and the `/flanders-implement` skill at runtime, at the moment its cycle hard-stops on the iteration cap or on a worker-declared `hard-stop.log`.
- **Not subject:** a login-failure hard stop, which stopped the run against credentials rather than against the work and so carries nothing to diagnose; the `implement` command, whose hard stop is diagnosed after the fact by the separate `/flanders-hard-stop-review` skill (see [.spec/contracts/ai-skills/hard-stop-review-skill.md](/.spec/contracts/ai-skills/hard-stop-review-skill.md)); and the diagnosis methodology itself, pinned by [.spec/contracts/shared/hard-stop-diagnosis.md](/.spec/contracts/shared/hard-stop-diagnosis.md).

### Behavior

1. **Diagnose unprompted.** On such a hard stop the skill proceeds directly to the diagnosis. It puts no question to the user first — not whether to analyze, not which folder to analyze — because it already holds the answer to both: its own run just produced the preserved folder.

2. **Apply the shared methodology.** The skill reads its own preserved temporary folder, grounds the analysis in the project's specs, classifies the stop between real progress and a loop, and maps the cause to the action that removes it, per [.spec/contracts/shared/hard-stop-diagnosis.md](/.spec/contracts/shared/hard-stop-diagnosis.md). Where that methodology recommends narrowing or correcting the statement of the work, the statement is the user's request, so the skill names re-invoking `/flanders-implement` with a narrower one.

3. **Present, then offer.** The skill presents the finding and the recommendation in chat and ends that same message with its launch question, per [.spec/contracts/ai-skills/implement-skill.md](/.spec/contracts/ai-skills/implement-skill.md).

4. **Preserve the evidence.** The temporary folder stays on disk after the diagnosis, so the user can check the analysis against the logs it was drawn from.

### Why

The user is present, the run just failed, and the evidence is on disk and fresh — every input the diagnosis needs is already in hand. Asking permission to analyze would spend a turn to learn something the situation has already settled, and reporting a bare hard stop would leave the user to invoke a second skill and re-supply a folder path the skill itself printed. Doing it unprompted turns the failure into an answer in the same breath.

### Failure signals

- The skill reports a hard stop and stops, leaving the diagnosis for the user to request.
- The skill asks the user whether to analyze the stop, or asks which folder to analyze.
- The skill diagnoses a login-failure hard stop as though it were a failure of the work.
- The skill invents its own root-cause classification or remedy set instead of applying the shared methodology.
- The skill removes the temporary folder once it has diagnosed it.
- The skill presents the diagnosis without the launch question, or asks the launch question in a separate message from the diagnosis.
