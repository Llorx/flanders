# Single-Task Cycle — Shared Contract

## Purpose
Define, once for every Flanders surface that drives one task to a reviewed, committed result, the cycle that walks a worker AI through implementation and validates the result through build, test, and adversarial-review gates. The `implement` command runs this cycle once per task of a plan (see [.spec/contracts/cli-commands/implement/iteration-loop.md](/.spec/contracts/cli-commands/implement/iteration-loop.md)), and the `/flanders-implement` skill runs it once for the user's request (see [.spec/contracts/ai-skills/implement-skill.md](/.spec/contracts/ai-skills/implement-skill.md)). Each surface supplies the task the cycle carries and decides what happens around it; everything below is identical on both.

## The task
The cycle carries one task: a unit of work with a statement of what it must achieve. What supplies that statement is the surface's own — a plan task and its acceptance criteria for the `implement` command, the user's request for the `/flanders-implement` skill. Everywhere below, "the task" means whichever of these the surface supplied, and "the task text" means the verbatim statement of it the surface injects.

## Per-cycle state
- `iteration` — counter for the current task, starting at 0.
- `MAX_ITER` — fixed upper bound of 5 iterations per task. Hardcoded; not configurable.

## Run baseline
Before the first iteration, the surface captures the pending state of the working tree as the run baseline: the content of every change already present in the tree when the cycle started. The baseline is captured before the first worker is launched and stays fixed for the whole run.

The baseline separates the work the cycle performs from the state it inherited. Every change a worker produces postdates the baseline, and the pending changes the baseline holds are no worker's work. Each adversarial reviewer therefore judges the changes produced since the baseline rather than every pending change the tree carries, and the surface provides each reviewer what it needs to tell the two apart (see [src/prompts/.spec/rules/ai/review.md#every-flanders-adversarial-reviewer-derives-the-change-set-from-git-status-not-from-git-diff-alone](/src/prompts/.spec/rules/ai/review.md#every-flanders-adversarial-reviewer-derives-the-change-set-from-git-status-not-from-git-diff-alone)). A path the baseline carries is still reviewed for whatever content a worker later adds to it: the baseline excludes the inherited content, not the file.

The baseline governs review only. The commit stage is unaffected: the baseline's changes are staged and captured by the cycle's commit exactly as any other pending change, so the cycle still leaves a clean tree.

## The cycle
Each iteration walks through the stages below in order. Any stage that fails writes context to the `error.log` file inside the temporary folder (see [.spec/contracts/shared/task-workspace.md](/.spec/contracts/shared/task-workspace.md)) and restarts the cycle at stage 1; the next iteration's worker prompt automatically includes the previous-iteration briefing because the iteration counter is greater than 1.

1. Increment `iteration`. If `iteration` exceeds `MAX_ITER`, hard stop per the Hard stop section below.

2. **Worker stage.** Spawn a worker AI whose tool, model, reasoning effort, and fast-mode setting are the worker fields of the Flanders configuration (see [.spec/contracts/shared/flanders-config.md](/.spec/contracts/shared/flanders-config.md)).

   How the worker is launched depends on the iteration:
   - **Iteration 1.** A fresh worker invocation, carrying the task text injected into the prompt verbatim, with no summarization or rewriting.
   - **Iteration n>1.** The worker continues from the work it produced in iteration 1 by session resume, so its prior tool calls and prior reasoning remain available; the task text is not re-injected (see [src/commands/.spec/rules/ai/task-context.md#the-worker-resumes-its-captured-session_id-across-iterations-of-the-same-task](/src/commands/.spec/rules/ai/task-context.md#the-worker-resumes-its-captured-session_id-across-iterations-of-the-same-task)).

   The worker prompt contains:
   - On iteration 1, the full task text. On iterations n>1 this is not repeated.
   - Instructions to honor the obligations of every contract, rule, and behavior rule that applies, implement the task, and update or extend tests so the new behavior is covered.
   - The full list of contract files and the full list of rule files, both by their project-root-relative namespace. The worker may consult any file in these lists at its discretion. A surface that also consolidates reference content for the worker to read defines that consolidation itself.
   - Instructions stating that, if the implementation changes how the project builds or how its tests run, the worker also updates the build and test scripts inside the temporary folder.
   - Instructions for declaring the task structurally impossible: when the worker establishes that the task cannot reach a clean iteration through any implementation the task authorizes — its stated outcome cannot be satisfied while honoring an obligation that applies or the design the task prescribes, or closing the recorded review findings requires decisions or work outside the task's scope — it writes a `hard-stop.log` file in the temporary folder stating the structural cause, the evidence (the criterion and the obligation or design statement in conflict), and the change that would unblock the task, then ends its turn without further implementation work. Ordinary difficulty, a failing gate, or findings the worker can still address within the task's scope never qualify.
   - On every iteration after the first, the previous-iteration briefing (see below).

   When the worker invocation completes, the surface first checks for a `hard-stop.log` file in the temporary folder: when it exists, the run hard-stops directly per the Hard stop section below, and this iteration's build, test, and review stages do not run. Otherwise, before the build gate runs, the surface stages every change in the working tree with `git add -A`, so the worker's output — including any files it created that were never tracked — is in the index for the gates that follow and for the eventual commit.

3. **Build stage.** Run the build gate — the build script, when one exists — per the gate semantics of [.spec/contracts/shared/build-test-validation.md](/.spec/contracts/shared/build-test-validation.md). On a failing gate, capture both stdout and stderr to `error.log` and restart the cycle.

4. **Test stage.** Run the test gate — the test script, when one exists — per the same gate semantics. On a failing gate, capture both stdout and stderr to `error.log` and restart the cycle.

5. **Adversarial review stage.** Run one review round of the reviewers the Flanders configuration holds, per the shared review-round rules: the reviewers run concurrently, one independent invocation each (see [src/commands/.spec/rules/ai/agents.md#reviewers-run-concurrently-one-independent-invocation-each](/src/commands/.spec/rules/ai/agents.md#reviewers-run-concurrently-one-independent-invocation-each)); each reviewer's verdict lives in its own per-reviewer error file, deleted before it runs and inspected after (see [src/commands/.spec/rules/ai/agents.md#the-review-round-orchestrator-decides-each-reviewers-verdict-from-its-own-per-reviewer-error-file--deleted-before-inspected-after](/src/commands/.spec/rules/ai/agents.md#the-review-round-orchestrator-decides-each-reviewers-verdict-from-its-own-per-reviewer-error-file--deleted-before-inspected-after)); the round completes under the weighted-review condition, cancelling any reviewer still in a usage-limit wait (see [src/commands/.spec/rules/ai/agents.md#a-review-round-completes--cancelling-any-still-waiting-reviewers--once-no-reviewer-is-running-every-required-reviewer-has-a-verdict-and-the-minimum-is-met](/src/commands/.spec/rules/ai/agents.md#a-review-round-completes--cancelling-any-still-waiting-reviewers--once-no-reviewer-is-running-every-required-reviewer-has-a-verdict-and-the-minimum-is-met)); and the round's verdict is the trimmed concatenation of the verdict files of the reviewers that ran to a verdict (see [src/commands/.spec/rules/ai/agents.md#the-review-stage-verdict-is-the-trimmed-concatenation-of-every-per-reviewer-error-file-on-one-linear-path](/src/commands/.spec/rules/ai/agents.md#the-review-stage-verdict-is-the-trimmed-concatenation-of-every-per-reviewer-error-file-on-one-linear-path)).

   Every reviewer invocation is fresh, with no continuity from any prior reviewer invocation and none between the reviewers of the same round, and receives the same task text and the same global listings the worker's iteration 1 receives; a surface that consolidates reference content provisions each reviewer its own copy in that reviewer's own folder. Each reviewer is instructed to find why the working-tree changes FAIL to satisfy the task or to honor the obligations that apply, per the shared reviewer methodology of [src/prompts/.spec/rules/ai/review.md](/src/prompts/.spec/rules/ai/review.md). The changes a reviewer judges are the ones produced since the run baseline, and what those changes answer for is the work they perform: the task's stated outcome, plus every obligation the changes themselves trigger. An obligation of the corpus that the changes trigger nothing of is reported as untriggered rather than as a failure, so each iteration's findings are ones the task's own worker can close. The reviewer's corpus stays whole: it consults every contract, rule, and behavior rule in the project.

   - When the round's verdict is **empty** — every reviewer passed — proceed to the commit stage.
   - When it is **non-empty** — at least one reviewer failed — the review failed. The surface writes the verdict into `error.log` so it serves as the next iteration's briefing, then restarts the cycle.

6. **Commit stage.** When the review passed, the surface first performs whatever bookkeeping its own contract defines for an accepted task, then stages every change in the working tree with `git add -A` and creates a commit with `--allow-empty`, so an accepted task always produces a commit even when the tree has nothing to stage. The commit message is the surface's own. Because the bookkeeping precedes this staging, the commit captures it, and the working tree is left clean.

   When `git commit` exits non-zero, this stage is treated as a failing stage: the surface reverts whatever bookkeeping it performed in this stage, the git output is captured into `error.log`, and the cycle restarts, which increments `iteration` and counts toward `MAX_ITER`.

   The cycle ends with success only after the commit has completed.

## Previous-iteration error briefing
The previous-iteration briefing is a generic addendum appended to the worker prompt automatically whenever `iteration` is greater than 1. It identifies the current iteration number, states that the previous iteration produced a problem to review, and points at the `error.log` file inside the temporary folder. Iteration 1 receives no such addendum.

The decision to add the briefing depends only on the iteration counter — there is no separate flag. Failing stages do nothing beyond writing to `error.log`; the counter increment in stage 1 of the next iteration is what makes the briefing appear.

`error.log` holds only the most recent failing iteration's context: the build, test, and commit stages overwrite it with their captured output, and the review stage overwrites it with the round's verdict when the review fails, leaving it untouched when the review passes. The reviewers themselves write only to their own per-reviewer error files; the surface is what writes the round's verdict into the briefing `error.log`. The same fixed `error.log` file name is used regardless of which stage produced the failure, so the briefing wording stays generic.

## Hard stop
Three conditions end the run as a hard stop: exceeding `MAX_ITER` on the task; a worker-declared `hard-stop.log` present in the temporary folder when a worker invocation completes; and a fatal authentication/login failure. The surface reports an outcome that:
- Identifies the task that was being worked.
- On a worker-declared stop, reproduces the content of `hard-stop.log` — the structural cause, the evidence, and the change the worker states would unblock the task.
- Points at the temporary folder so the preserved per-iteration logs and the per-iteration, per-stage error logs the hard stop materializes can be inspected, and — on a worker-declared stop — the `hard-stop.log` itself (see [.spec/contracts/shared/task-workspace.md#hard-stop-per-iteration-error-logs](/.spec/contracts/shared/task-workspace.md#hard-stop-per-iteration-error-logs)).

### Login-failure hard stop
Whenever an AI invocation surfaces a fatal authentication/login failure — the tool reporting that it is not logged in — the run ends as a hard stop. This applies to every invocation the cycle makes — the worker, any reviewer, and the build/test detect agent — and at any point in the run, including before the first iteration and after a session's credentials expire mid-run.

On this failure the surface cancels every AI invocation still in flight, including sibling reviewers running concurrently, and then hard-stops. The reported outcome is task-independent: it states that the configured AI tool is not logged in and instructs the user to log in and re-run, rather than reproducing a `hard-stop.log`. Because the failure may arrive before any iteration has produced a per-stage error, the folder-preservation step materializes whatever per-iteration logs exist and preserves the temporary folder exactly as the other hard-stop conditions do.

This hard stop overrides the ordinary per-role error handling: a login failure from the worker is not written to `error.log` and re-briefed to a next iteration, a login failure from a reviewer does not follow the reviewer-error path that carries its message to the worker, and in neither case does the failure consume an iteration or count toward `MAX_ITER`. The run stops on the spot.

Before preserving the folder, the hard stop materializes each failing iteration's per-stage error log and removes the single briefing `error.log`, so the preserved folder records the error history of every iteration rather than only the last.

## Spec-folder immovability
No AI agent the cycle spawns — the worker, any reviewer, or the build/test detect agent — creates, modifies, deletes, or renames any file inside any `.spec/contracts` folder, any `.spec/rules` folder, any `.spec/flanders` folder, or the `plans/` folder, per [.spec/contracts/shared/spec-folder-write-authority.md](/.spec/contracts/shared/spec-folder-write-authority.md). Writes a surface itself performs to those folders are that surface's own, defined where that surface is defined.

## Out of scope
- What supplies the task, and what a surface does before the cycle starts or after it ends — plan selection, bookkeeping, reporting, and any commit outside the cycle's own — belong to each surface.
- The commit message. Each surface defines the message its commit carries.
- How a surface renders the cycle's progress to the user.
