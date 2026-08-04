# `/flanders-implement` Skill Contract

## Purpose
Carry a single, self-contained piece of work from request to reviewed, committed completion in one invocation, without a plan. The skill runs the same single-task cycle the `implement` command runs for one task (see [.spec/contracts/shared/task-cycle.md](/.spec/contracts/shared/task-cycle.md)), with the user's request in place of a plan task. What it saves over the command is the plan: no plan file is authored, selected, or updated. The session the user invoked the skill in is the orchestrator of that cycle — it drives the stages and reports on them, and it implements nothing itself.

## Provisioning
The skill becomes available only after the user runs `npx flanders install` (see [.spec/contracts/cli-commands/install.md](/.spec/contracts/cli-commands/install.md)). The skill is installed for each AI tool the user picked at install time (Claude Code, Codex CLI, or both). The user reaches the installed skill through the invoking tool's own skill-invocation mechanism, pinned in [.spec/contracts/ai-skills/skill-invocation.md](/.spec/contracts/ai-skills/skill-invocation.md).

The short description the invoking tool presents for the skill — the text an AI session reads when it decides whether this skill fits a request — states that the skill carries one request through the cycle and that a plan file is implemented by running the `implement` command (see [.spec/contracts/cli-commands/implement/overview.md](/.spec/contracts/cli-commands/implement/overview.md)) instead.

## Invocation
The user invokes the skill by its name from inside an AI-tool session, optionally supplying one `<data>` argument after it (see [.spec/contracts/ai-skills/skill-invocation.md](/.spec/contracts/ai-skills/skill-invocation.md)). The optional `<data>` argument is interpreted the same way as `/flanders-spec` (see [.spec/contracts/ai-skills/spec-skill.md](/.spec/contracts/ai-skills/spec-skill.md)) and `/flanders-plan`. The resolved request is the task the cycle carries, and its verbatim text is what the orchestrator injects into the worker and into every reviewer.

That resolved request is a single, self-contained piece of work. A plan file is not such a request: its tasks are carried by the `implement` command (see [.spec/contracts/cli-commands/implement/overview.md](/.spec/contracts/cli-commands/implement/overview.md)), which selects the plan, advances it one task at a time, and records each accepted task in it.

## Behavior

1. **Load the Flanders configuration** from `.flanders/`, resolved by the per-scope precedence of [.spec/contracts/shared/flanders-config.md](/.spec/contracts/shared/flanders-config.md). The loaded configuration determines the AI tool, model, reasoning effort, and fast-mode setting of the worker and of every reviewer. When no configuration is readable at any scope, the skill stops and tells the user to run `npx flanders install`.

2. **Commit the pending spec.** Every spec file that carries an uncommitted change is committed, per [Git](#git).

3. **Set up the workspace** — the main temporary folder, one folder per configured reviewer, and the build and test scripts the detect agent writes — per [.spec/contracts/shared/task-workspace.md](/.spec/contracts/shared/task-workspace.md).

4. **Capture the run baseline** and **run the single-task cycle** per [.spec/contracts/shared/task-cycle.md](/.spec/contracts/shared/task-cycle.md), with the user's request as the task: worker, build gate, test gate, adversarial review round, and commit, up to five iterations, with each failing stage briefing the next iteration through `error.log`.

5. **Finish.** On a cycle that ends with success, the skill reports to the user what was implemented and that it is committed. On a hard stop, it diagnoses per [Hard stop](#hard-stop) below. It authors no plan file and writes no Flanders configuration.

### The worker and the reviewers are configured AI-tool processes
Every AI the cycle spawns — the worker, each reviewer, and the build/test detect agent — runs as its own process of the AI tool its configured entry names, with that entry's own model, reasoning effort, and fast-mode setting. The skill's own session hosts none of them: it runs no subagent of its own and performs no inline pass in place of one. The invocation is non-interactive and grants the tool the maximum access its CLI offers, so no agent stalls waiting for an approval the orchestrator cannot answer. It also carries no time limit, and neither does a run of the build or test script: every process the skill launches runs until it produces its result, however long that takes.

The reviewers of a round run concurrently under the weighted-review configuration, exactly as the cycle's review stage defines (see [.spec/contracts/shared/task-cycle.md](/.spec/contracts/shared/task-cycle.md)).

### Absorbing an invocation that reaches no result
No AI runner sits between the skill and the processes it launches, so the skill absorbs their failures itself, identically for the worker, a reviewer, and the detect agent:
- **A usage limit** is a wait, not a failure: the skill waits and launches that invocation again until it produces its result. For a reviewer, this is the usage-limit wait the round-completion condition accounts for, so an optional reviewer waiting when the round completes is cancelled and a required one is always waited out.
- **Any other error** is relaunched, and three consecutive errored invocations of the same agent in the same iteration stop the skill, naming that agent and reproducing the error. Any invocation that completes resets its count.
- **A report that the tool is not logged in** is the fatal authentication failure of [.spec/contracts/shared/task-cycle.md#login-failure-hard-stop](/.spec/contracts/shared/task-cycle.md#login-failure-hard-stop): it ends the run on the spot, is never relaunched, and never counts toward the error allowance.

### Hard stop
When the cycle hard-stops because the iteration cap was exceeded or because the worker declared the task structurally impossible, the skill diagnoses that stop itself, in the same run and without asking the user first: it applies [.spec/contracts/shared/hard-stop-diagnosis.md](/.spec/contracts/shared/hard-stop-diagnosis.md) to its own preserved temporary folder and presents the root-cause finding and the recommendation in chat. Where that diagnosis recommends narrowing or correcting the statement of the work, the statement is the user's request, so the recommendation names how to re-invoke `/flanders-implement` with a narrower one. The message ends with the launch question of [Recommending and launching the next step](#recommending-and-launching-the-next-step), asked as plain chat text per [.spec/contracts/ai-skills/report-before-question.md](/.spec/contracts/ai-skills/report-before-question.md).

A login-failure hard stop carries no such diagnosis: the run stopped against credentials rather than against the work, so the skill reports that the configured AI tool is not logged in, tells the user to log in and re-invoke, and ends.

The temporary folder is preserved on every hard stop, diagnosed or not, so the user can inspect it after the skill has reported.

## Recommending and launching the next step
After presenting a hard-stop diagnosis, the skill asks the user which skill to launch to carry out the recommendation — `/flanders-spec`, `/flanders-plan`, or neither — following the cadence pinned in [.spec/contracts/ai-skills/question-cadence.md](/.spec/contracts/ai-skills/question-cadence.md). It recommends `/flanders-spec` (see [.spec/contracts/ai-skills/spec-skill.md](/.spec/contracts/ai-skills/spec-skill.md)) when the cause is a contract or rule defect, and `/flanders-plan` (see [.spec/contracts/ai-skills/plan-skill.md](/.spec/contracts/ai-skills/plan-skill.md)) when the evidence shows the request is too large for one task and needs to be carried as an ordered plan instead. When the user chooses one, the skill launches it in the same session with no `<data>` argument, so the launched skill takes its input from the conversation — the request and the diagnosis just produced. The run then proceeds under that skill's own contract, whose write boundary governs any file it writes. When the recommended fix is to re-invoke `/flanders-implement` with a narrower request, or to re-run unchanged, the skill states that and launches nothing. When the user declines, the skill ends.

## Git
The skill requires the project to be a git repository, and it commits twice.

**Before the work.** Every spec file that carries an uncommitted change — any path traversing a directory named `.spec` at any depth (see [.spec/contracts/shared/spec-folder-layout.md](/.spec/contracts/shared/spec-folder-layout.md)), whether that change is staged, unstaged, or an untracked addition — is committed under the message `Commit pending spec changes`. When no spec file carries such a change, no commit is made. Because each reviewer judges the changes produced since the run baseline, and that baseline is captured after this commit, this commit is what keeps the user's spec work out of the change set under review.

**When the cycle accepts the work.** The commit the cycle's commit stage creates carries a single-line message summarizing the work the worker performed, derived from the user's request. Both commit messages are written in English.

Beyond the spec files above, the skill does not require the working tree to be clean before it runs: a pending change to any other file is left as it stands, the run baseline records it as inherited rather than as the worker's work, and the cycle's commit captures it alongside the accepted work.

When the spec commit fails, the skill reports the git output and stops before any work is performed. A failure of the cycle's own commit is a failing stage of that cycle, handled there.

## Spec-folder immovability
Neither the worker nor any reviewer nor the detect agent creates, modifies, deletes, or renames any file inside any `.spec/contracts` folder, any `.spec/rules` folder, any `.spec/flanders` folder, or the `plans/` folder, per [.spec/contracts/shared/spec-folder-write-authority.md](/.spec/contracts/shared/spec-folder-write-authority.md). The skill itself writes to none of them either; the spec commit above records those files in git without altering their content, so it leaves this boundary intact.

## Interaction language
The natural language the skill converses in with the user — its progress reports, its completion summary, its hard-stop diagnosis, and every other message it prints in chat — is resolved per [.spec/contracts/ai-skills/interaction-language.md](/.spec/contracts/ai-skills/interaction-language.md).

## Out of scope
- The skill authors, selects, updates, and renames no plan file, and records no task metrics. Those belong to the `implement` command, which carries a plan (see [.spec/contracts/cli-commands/implement/overview.md](/.spec/contracts/cli-commands/implement/overview.md)).
- The skill reads the Flanders configuration and never writes it.
- Beyond the discovery description pinned under [Provisioning](#provisioning), the exact internal contents of the skill artifact are implementation choices, pinned only insofar as the user is able to invoke `/flanders-implement` from inside an AI-tool session of each selected tool after a successful `install` run.
