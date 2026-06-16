# Autonomous subagent conduct rules

## Autonomous subagents never run commands in the background

Any AI instance (Claude Code, Codex CLI, or any other supported tool) that runs as an autonomous agent inside this project — workers, reviewers, adversarial reviewers, prep, validators, detect, and in general any subagent launched by a skill, by an orchestration, or by the `implement` command — must run every command it executes in the foreground and keep its turn active until that command finishes and its result is in hand. It is forbidden from starting any command in the background and from ending its turn while a command it spawned is still running.

This binds every command without exception: build scripts, test scripts, linters, and any other shell command. A long-running command is still run in the foreground; the subagent waits for it to complete rather than detaching it.

The only exempt instance is the interactive session with the user, which may background commands when the user explicitly asks for it in that same session.

### Who this applies to

- **Subject to the rule:** every subagent launched through the AI tool's subagent mechanism (in Claude Code, the `Agent` tool with any `subagent_type`; in Codex CLI, the equivalent when one exists), every AI-tool process launched by a skill or by the `implement` command as worker/reviewer/prep/validator/detect, and any instance that operates without a human answering turn by turn.
- **Exempt:** the interactive session in which the user is conversing with the AI tool. That session may background a command when the user asks for it explicitly. An order inferred or anticipated by the tool does not count as an explicit order.

A subagent does not inherit permission to background commands just because the session that launched it could. The prohibition is by role, not by invocation chain.

### Why the foreground is mandatory

A Flanders subagent runs as a single non-interactive turn that the orchestrator drives to completion and then awaits (see [src/ai/.spec/rules/runner.md#every-ai-adapter-invokes-its-tool-non-interactively](/src/ai/.spec/rules/runner.md#every-ai-adapter-invokes-its-tool-non-interactively)). When the subagent backgrounds a command, it yields its turn expecting a later notification that the command has finished — but a headless turn has no live channel through which that notification can arrive. The tool then holds the session open waiting for a notification that never comes, never emits its terminal result, and the orchestrator blocks indefinitely. Running every command in the foreground keeps the turn's completion tied to the command's completion, so the result is always reported back before the turn ends.

### What counts as backgrounding (forbidden)

Any mechanism that lets a command keep running after the call that started it returns, or that defers the command's result to a later notification. For example, and without the list being exhaustive:

- A `Bash` tool call (or equivalent) made with `run_in_background: true`.
- A foreground command that, on exceeding its tool timeout, is converted into a background task — the subagent must instead give the command a tool timeout large enough to let it finish in the foreground.
- Shell-level detachment: a trailing `&`, `nohup … &`, `setsid`, `disown`, `start`, PowerShell `Start-Process`/`Start-Job`, or piping a process so it survives the turn.
- Ending the turn with a message along the lines of "the command is running in the background, waiting for it to complete" while a spawned task is still pending.

### Failure signals

An execution violates this rule when, inside a subagent subject to the rule, any of the following appears:

- A `Bash` tool call (or equivalent) carrying a background flag such as `run_in_background: true`.
- A command launched with a shell detachment construct (`&`, `nohup`, `setsid`, `disown`, `start`, `Start-Process`, `Start-Job`).
- A tool result reporting that a command was moved to the background (for example, "Command running in background with ID: …").
- A final message from the subagent stating that work is still running in the background or that it is waiting for a completion notification.

If any of these signals appears, the behavior is incorrect even if the spawned command would eventually have succeeded.

## Autonomous subagents never write to git

Any AI instance (Claude Code, Codex CLI, or any other supported tool) that runs as an autonomous agent inside this project — workers, reviewers, adversarial reviewers, validators, and in general any subagent launched by a skill, by an orchestration, or by the main session — is forbidden from running git commands that modify repository state. It may only read git, and only when its task requires it.

The only exempt instance is the interactive session with the user, which may run git write commands when the user explicitly asks for them in that same session.

### Who this applies to

- **Subject to the rule:** every subagent launched through the AI tool's subagent mechanism (in Claude Code, the `Agent` tool with any `subagent_type`; in Codex CLI, the equivalent when one exists), every AI-tool process launched by a skill or by the `implement` command as worker/reviewer/prep/validator/detect, and any instance that operates without a human answering turn by turn.
- **Exempt:** the interactive session in which the user is conversing with the AI tool. That session may run git write commands when the user asks for them explicitly. An order inferred or anticipated by Claude does not count as an explicit order.

A subagent does not inherit permission to write to git just because the session that launched it had it. The prohibition is by role, not by invocation chain.

### What counts as reading (allowed)

Operations that do not modify the working tree, the index, local refs, the stash, the reflog, hooks, or the repository configuration. For example:

- `git status`, `git diff`, `git log`, `git show`, `git blame`
- `git branch` (list), `git tag` (list), `git worktree list`
- `git ls-files`, `git ls-tree`, `git cat-file`, `git rev-parse`, `git rev-list`
- `git config --get` (read), `git remote -v` (read)

### What counts as writing (forbidden)

Any operation that modifies the repository's local state, even if it does not touch the network. For example, and without the list being exhaustive:

- Staging and index: `git add`, `git rm`, `git mv`, `git restore --staged`, `git reset` (any variant)
- Commits and history rewriting: `git commit`, `git commit --amend`, `git rebase`, `git cherry-pick`, `git revert`, `git merge`
- Refs and branches: `git branch` (create/rename/delete), `git tag` (create/delete), `git switch -c`, `git checkout -b`
- Working tree: `git checkout <path>`, `git restore <path>`, `git clean`
- Stash and worktrees: `git stash` (any subcommand), `git worktree add`, `git worktree remove`
- Configuration and hooks: `git config` (write), editing files under `.git/`
- Any remote command (already forbidden by the user's global rule): `git push`, `git pull`, `git fetch`, `git clone`

Achieving the same effect through alternative means is equally disallowed: editing `.git/HEAD`, `.git/index`, `.git/refs/*`, running `git` through a wrapper, invoking a library's git APIs, or asking another tool to run the command underneath.

### What the subagent does when a git write "would be needed"

When the subagent detects that its task requires a git change (commit, stage, merge, etc.), it must finish its work leaving the modified tree as is and report it to the invoker in its final message. It is the invoker's responsibility — the user's interactive session or an equivalent orchestrator — to decide whether to materialize that change in git.

The subagent must not ask the user for permission to make the commit itself: it simply does not do it.

### Failure signals

An execution violates this rule when, inside a subagent subject to the rule, any of the following appears:

- A call to the `Bash` tool (or equivalent) whose command starts with `git ` and is not in the reading list above.
- A direct edit to any file under `.git/`.
- A commit, stage, branch, tag, stash, or reset done through a library or wrapper instead of the git CLI.
- A message from the subagent to the invoker along the lines of "I committed X" or "I left Y staged".

If any of these signals appears, the behavior is incorrect even if the final result is the expected one.

## Reviewers run concurrently, one independent runner invocation each, and the stage ends when the last finishes

The adversarial review stage launches every configured reviewer concurrently rather than one after another. Each reviewer is its own AI-runner invocation that manages its own retries and rate-limit waits independently of the others, and the stage's reviewer work is complete only when the last reviewer has finished. Reviewers are read-only on the project, so running them at the same time is safe.

### Who this applies to

- **Subject:** the orchestrator of the `implement` inner loop, at the adversarial review stage, when it launches the reviewers configured in the `reviewers` array (see [.spec/contracts/shared/flanders-config.md](/.spec/contracts/shared/flanders-config.md)).
- **Not subject:** the AI runner, which absorbs the retries and rate-limit waits of the single invocation it is given (see [src/ai/.spec/contracts/ai-runner.md](/src/ai/.spec/contracts/ai-runner.md)); it is unaware that sibling reviewer invocations are running alongside it.

### Behavior

1. **One invocation per reviewer, launched concurrently.** The orchestrator issues a separate AI-runner invocation for each configured reviewer and starts them together, without waiting for one reviewer to finish before starting the next. It does not serialize the reviewers into a sequential loop.

2. **Independent retry and rate-limit handling.** Each reviewer's runner invocation absorbs that reviewer's own retryable errors and rate-limit waits per [src/ai/.spec/rules/retry.md#the-runner-retries-retryable-errors-and-rate-limits-via-the-tool-interface-events](/src/ai/.spec/rules/retry.md#the-runner-retries-retryable-errors-and-rate-limits-via-the-tool-interface-events). One reviewer entering a rate-limit wait does not pause, delay, or restart the other reviewers; each proceeds, retries, and waits on its own schedule.

3. **Each writes only its own per-reviewer error file.** Because each reviewer writes exclusively to its own per-reviewer error file (per [src/commands/.spec/rules/ai/agents.md#the-implement-orchestrator-decides-each-reviewers-verdict-from-its-own-per-reviewer-error-file--deleted-before-inspected-after](/src/commands/.spec/rules/ai/agents.md#the-implement-orchestrator-decides-each-reviewers-verdict-from-its-own-per-reviewer-error-file--deleted-before-inspected-after)) and performs no project writes, concurrent execution produces no write contention between reviewers.

4. **The stage completes when the round-completion condition is met.** The stage's reviewer work does not necessarily wait for every reviewer to finish: it completes once no reviewer is running, every required reviewer has a verdict, and at least the configured minimum number of reviewers have a verdict (see [src/commands/.spec/rules/ai/agents.md#a-review-round-completes--cancelling-any-still-waiting-reviewers--once-no-reviewer-is-running-every-required-reviewer-has-a-verdict-and-the-minimum-is-met](/src/commands/.spec/rules/ai/agents.md#a-review-round-completes--cancelling-any-still-waiting-reviewers--once-no-reviewer-is-running-every-required-reviewer-has-a-verdict-and-the-minimum-is-met)). At that instant the orchestrator cancels every reviewer still in a usage-limit wait and forms the stage verdict (per [src/commands/.spec/rules/ai/agents.md#the-review-stage-verdict-is-the-trimmed-concatenation-of-every-per-reviewer-error-file-on-one-linear-path](/src/commands/.spec/rules/ai/agents.md#the-review-stage-verdict-is-the-trimmed-concatenation-of-every-per-reviewer-error-file-on-one-linear-path)) from the reviewers that ran to a verdict, including any per-reviewer re-launches for an absent file.

### Why concurrent

Reviewers are read-only and independent, so serializing them would make the stage's wall-clock time the sum of the reviewers' durations instead of the duration of the slowest one — and rate-limit waits, which can last minutes to hours, would stack. Running them concurrently bounds the stage by the slowest single reviewer and lets each reviewer's rate-limit wait overlap with the others' real work.

### Failure signals

- The orchestrator runs the reviewers in a sequential loop, awaiting each before starting the next.
- One reviewer's rate-limit wait or retry stalls the other reviewers instead of each handling its own independently.
- The orchestrator forms the stage verdict while a reviewer is still running, instead of waiting until the round-completion condition is met.
- A reviewer cancelled at round completion is awaited as though it must still finish, stalling the stage.
- A reviewer is made to share another reviewer's runner invocation or error file, coupling their execution or their output.

## A review round completes — cancelling any still-waiting reviewers — once no reviewer is running, every required reviewer has a verdict, and the minimum is met

The adversarial review stage does not decide, reviewer by reviewer, whether to abandon a usage-limited reviewer. Instead it watches the whole reviewer set and, on every reviewer transition, asks one question: may the round complete now? The round completes when all three of these hold at once:

1. **No reviewer is running** — every reviewer is either finished with a verdict or sitting in a usage-limit wait. A reviewer in a short transient-error backoff counts as running, not waiting (see [.spec/contracts/cli-commands/implement/ui.md](/.spec/contracts/cli-commands/implement/ui.md) and [src/ui/.spec/rules/ui-behavior.md#the-waiting-footer-state-appears-only-for-long-retry-waits](/src/ui/.spec/rules/ui-behavior.md#the-waiting-footer-state-appears-only-for-long-retry-waits)).
2. **Every required reviewer has a verdict** — no required (non-optional) reviewer is still running or in a usage-limit wait. The `optional` flag that distinguishes the two is pinned in [.spec/contracts/shared/flanders-config.md](/.spec/contracts/shared/flanders-config.md).
3. **At least `minimumReviews` reviewers have a verdict** — the count of reviewers that ran to a verdict has reached the configured minimum.

When all three hold, the orchestrator cancels every reviewer still in a usage-limit wait (see [src/ai/.spec/contracts/ai-runner.md](/src/ai/.spec/contracts/ai-runner.md)) and forms the stage verdict from the reviewers that ran to a verdict (see [src/commands/.spec/rules/ai/agents.md#the-review-stage-verdict-is-the-trimmed-concatenation-of-every-per-reviewer-error-file-on-one-linear-path](/src/commands/.spec/rules/ai/agents.md#the-review-stage-verdict-is-the-trimmed-concatenation-of-every-per-reviewer-error-file-on-one-linear-path)). When any one of the three fails, no reviewer is cancelled and the round continues.

### Who this applies to

- **Subject:** the orchestrator of the `implement` inner loop, at the adversarial review stage, while it runs the reviewers configured in `.flanders/config.json`.
- **Not subject:** the AI runner, which absorbs the retries and rate-limit waits of any invocation that is not cancelled (see [src/ai/.spec/rules/retry.md#the-runner-retries-retryable-errors-and-rate-limits-via-the-tool-interface-events](/src/ai/.spec/rules/retry.md#the-runner-retries-retryable-errors-and-rate-limits-via-the-tool-interface-events)); it does not evaluate the round-completion condition. Also not subject: the reviewers themselves, which review identically whether or not they are optional.

### When the condition is evaluated

The orchestrator re-evaluates the condition on every reviewer transition that can newly satisfy it: a reviewer finishing with a verdict, and a reviewer entering a usage-limit wait. The condition is not checked once at a fixed point; it is re-checked each time the global reviewer state changes in one of these two ways, so the round completes at the earliest moment all three conditions hold.

### Why the decision is global, not per-reviewer

A reviewer that has entered a usage-limit wait is never abandoned on its own at the moment it hits the limit. While the round has not yet met its completion condition — for example because a required reviewer is still counting down a multi-hour usage-limit wait — a waiting optional reviewer's own usage limit may clear, and that reviewer may resume and run to a verdict, contributing its review. Cancelling it the instant it hit its limit would throw away a review the round still had time to collect. Only at the instant the round may complete are the reviewers still waiting cancelled, because at that instant their verdicts are no longer needed: every required reviewer is in and the minimum is met.

Because the condition requires every required reviewer to already have a verdict, a reviewer cancelled this way is always an optional one — a required reviewer is never cancelled; its usage-limit wait is always waited out. A cancelled reviewer produces no per-reviewer error file, is never re-launched, and does not contribute to the stage verdict (see [src/commands/.spec/rules/ai/agents.md#the-implement-orchestrator-decides-each-reviewers-verdict-from-its-own-per-reviewer-error-file--deleted-before-inspected-after](/src/commands/.spec/rules/ai/agents.md#the-implement-orchestrator-decides-each-reviewers-verdict-from-its-own-per-reviewer-error-file--deleted-before-inspected-after)).

### Errors are not part of this decision

A reviewer that fails with an error rather than entering a usage-limit wait is not handled here: its error follows the ordinary reviewer-error path — a retryable error is retried by the runner, and a non-retryable error surfaces with its message reaching the worker — regardless of whether the reviewer is optional (see [src/ai/.spec/rules/retry.md#the-runner-retries-retryable-errors-and-rate-limits-via-the-tool-interface-events](/src/ai/.spec/rules/retry.md#the-runner-retries-retryable-errors-and-rate-limits-via-the-tool-interface-events)). The round-completion condition concerns only reviewers that are running, in a usage-limit wait, or finished with a verdict.

### Failure signals

- The orchestrator cancels a reviewer the moment it enters a usage-limit wait, instead of leaving it to run while the round-completion condition is not yet met.
- The orchestrator completes the round while a reviewer is still running, or while a required reviewer has no verdict, or before `minimumReviews` reviewers have a verdict.
- The orchestrator cancels a required reviewer rather than waiting out its usage limit.
- The orchestrator treats a reviewer error as if it were a usage-limit wait, folding it into the round-completion decision instead of letting it reach the worker through the existing error path.
- The orchestrator evaluates the condition only once instead of on each qualifying reviewer transition, so the round fails to complete at the earliest moment all three conditions hold.

## The review-stage verdict is the trimmed concatenation of every per-reviewer error file, on one linear path

The adversarial review stage produces a single verdict from the per-reviewer error files by following one linear path with no per-file presence branching: read the per-reviewer error file of every reviewer that ran to a verdict, concatenate their contents in reviewer order with one newline between files, trim the concatenation, and treat a non-empty result as the failure. Each step has one responsibility — read all, concatenate, trim, test for emptiness — and the test is performed once on the combined string, never as a per-file "does this one have content?" branch. A reviewer cancelled at round completion (see [src/commands/.spec/rules/ai/agents.md#a-review-round-completes--cancelling-any-still-waiting-reviewers--once-no-reviewer-is-running-every-required-reviewer-has-a-verdict-and-the-minimum-is-met](/src/commands/.spec/rules/ai/agents.md#a-review-round-completes--cancelling-any-still-waiting-reviewers--once-no-reviewer-is-running-every-required-reviewer-has-a-verdict-and-the-minimum-is-met)) produced no per-reviewer error file and takes no part in the concatenation.

### Who this applies to

- **Subject:** the orchestrator of the `implement` inner loop, at the adversarial review stage, once the review round has completed (see [src/commands/.spec/rules/ai/agents.md#a-review-round-completes--cancelling-any-still-waiting-reviewers--once-no-reviewer-is-running-every-required-reviewer-has-a-verdict-and-the-minimum-is-met](/src/commands/.spec/rules/ai/agents.md#a-review-round-completes--cancelling-any-still-waiting-reviewers--once-no-reviewer-is-running-every-required-reviewer-has-a-verdict-and-the-minimum-is-met)) and the orchestrator has cancelled any reviewers still in a usage-limit wait, so that every reviewer that ran to a verdict has its per-reviewer error file present (per [src/commands/.spec/rules/ai/agents.md#the-implement-orchestrator-decides-each-reviewers-verdict-from-its-own-per-reviewer-error-file--deleted-before-inspected-after](/src/commands/.spec/rules/ai/agents.md#the-implement-orchestrator-decides-each-reviewers-verdict-from-its-own-per-reviewer-error-file--deleted-before-inspected-after)).
- **Not subject:** the reviewers themselves and the AI runner. The reviewers each write their own per-reviewer error file; this rule governs only how the orchestrator combines those files into the stage verdict.

### Behavior

After the round has completed and any waiting reviewers have been cancelled, the orchestrator forms the stage verdict in this fixed order:

1. **Read all.** Read the contents of the verdict file of every reviewer that ran to a verdict — the `error.log` inside that reviewer's own temporary folder, taken in reviewer order (the first such reviewer first) through the last. A reviewer that found no violation left its file empty; that empty content is read like any other, with no special-casing. A reviewer cancelled at round completion produced no verdict file and is not among the files read.

2. **Concatenate.** Join the contents in reviewer order with exactly one newline (`\n`) between consecutive files. The join does not inspect whether a given file is empty before adding it — every such verdict file is concatenated unconditionally.

3. **Trim.** Trim surrounding whitespace, including blank lines and newlines, from the concatenated string.

4. **Test once.** The trimmed string is the verdict signal:
   - **Empty** — every reviewer passed; the review stage passed.
   - **Non-empty** — at least one reviewer recorded violations; the review stage failed, and the trimmed (or full) concatenation is the next iteration's briefing.

Before the review round runs, the orchestrator deletes the aggregate `error.log` briefing file, so a stale briefing written by an earlier stage never survives into the review round. On a failed review, the orchestrator then writes the concatenated reviewer violations into that same `error.log` briefing file inside the temporary folder (the same file the build, test, and commit stages use), so the next worker iteration is briefed through the single generic briefing path.

### Why one linear path

Branching per file — "if this reviewer's file has content, mark a failure; otherwise skip it" — multiplies the decision points and invites bugs where one path forgets to trim, or treats an empty-but-present file differently from an absent one. Because every passing reviewer contributes the empty string, an unconditional read-concatenate-trim-test collapses the entire stage decision into a single emptiness check on one combined string: no reviewer needs to be inspected individually, and the same code handles one reviewer or many identically.

### Failure signals

- The orchestrator decides the stage verdict by checking each per-reviewer error file individually ("any file non-empty ⇒ fail") instead of concatenating first and testing the combined string once.
- The orchestrator skips a reviewer's per-reviewer error file from the concatenation because it looks empty, instead of concatenating every produced verdict file unconditionally.
- The orchestrator includes a reviewer cancelled at round completion in the concatenation, or treats its absent verdict file as a violation.
- The concatenation omits the single-newline separator between files, so adjacent reviewers' violations run together on one line.
- The orchestrator tests the concatenation for emptiness without trimming first, so a stray newline from an otherwise-clean round is misread as a failure.
- A failed review does not write the aggregated violations into the `error.log` briefing file, leaving the next worker iteration without the combined reviewer findings.
- The orchestrator leaves a stale `error.log` in place before the review round instead of deleting it, so a briefing from an earlier stage can be mistaken for a review result.

## The `implement` orchestrator decides each reviewer's verdict from its own per-reviewer error file — deleted before, inspected after

The orchestrator of the `implement` inner loop gives each configured adversarial reviewer its own verdict file — the `error.log` inside that reviewer's own temporary folder, a folder created independently of the main temporary folder and of every other reviewer's folder (see [.spec/contracts/cli-commands/implement/workspace.md](/.spec/contracts/cli-commands/implement/workspace.md)). The orchestrator deletes that file before the reviewer runs, requires the reviewer to produce it again, and decides that reviewer's outcome solely from whether the file is present and what it holds — never from anything the reviewer printed to its output and never from a process exit code. The reviewer's own obligation to write the file (append violations, create it empty when there are none, never write non-violation content) is the shared [src/prompts/.spec/rules/ai/review.md#every-flanders-adversarial-reviewer-records-its-verdict-by-writing-violations-into-its-error-log-file-never-via-its-output-or-exit-code](/src/prompts/.spec/rules/ai/review.md#every-flanders-adversarial-reviewer-records-its-verdict-by-writing-violations-into-its-error-log-file-never-via-its-output-or-exit-code); how the per-reviewer files combine into the stage verdict is [src/commands/.spec/rules/ai/agents.md#the-review-stage-verdict-is-the-trimmed-concatenation-of-every-per-reviewer-error-file-on-one-linear-path](/src/commands/.spec/rules/ai/agents.md#the-review-stage-verdict-is-the-trimmed-concatenation-of-every-per-reviewer-error-file-on-one-linear-path).

### Who this applies to

- **Subject:** the orchestrator of the `implement` inner loop at its adversarial review stage — the per-reviewer delete-before / inspect-after / re-launch protocol and the per-reviewer folder isolation. Each statement below applies independently to every configured reviewer and that reviewer's own per-reviewer error file. The delete-before of point 1 applies to every reviewer; the inspect-after and re-launch of points 2 and 5 apply to a reviewer that completes its invocation — a reviewer cancelled at round completion (see [src/commands/.spec/rules/ai/agents.md#a-review-round-completes--cancelling-any-still-waiting-reviewers--once-no-reviewer-is-running-every-required-reviewer-has-a-verdict-and-the-minimum-is-met](/src/commands/.spec/rules/ai/agents.md#a-review-round-completes--cancelling-any-still-waiting-reviewers--once-no-reviewer-is-running-every-required-reviewer-has-a-verdict-and-the-minimum-is-met)) never completes, so they never apply to it.
- **Not subject:** the AI runner, which only streams each reviewer's events and surfaces a successful completion or an error; it does not read any per-reviewer error file and does not decide any verdict. Also not subject: the construction of the reviewer prompt's instruction to write the file, which is the shared rule named above.

### Behavior

1. **Delete before.** The orchestrator deletes the reviewer's `error.log` before launching that reviewer — leaving the reviewer's own temporary folder itself in place — so the file does not exist when the reviewer starts. The orchestrator does not leave behind an emptied file: the file is absent, so the reviewer recreating it is observable.

2. **A present file means the reviewer ran to a verdict.** After a reviewer invocation completes successfully, the orchestrator inspects that reviewer's per-reviewer error file:
   - **Absent** — the reviewer did not produce the file it was required to produce, so it did not run to a verdict. The orchestrator re-launches that same reviewer (see point 5); an absent file is never read as a pass and never contributes to the stage verdict.
   - **Present** — the reviewer ran to a verdict, and the file's contents (empty or not) are what the stage aggregation consumes.

3. **Exit code is never the signal.** The orchestrator does not use a reviewer process's exit code to decide its result. A successful single-turn agent invocation exits zero regardless of whether the reviewer found violations, so the exit code carries no verdict.

4. **Errors are not passes.** The inspection in point 2 is reached only after a successful reviewer completion. A reviewer invocation that ends in an error is handled by the runner's retry policy ([src/ai/.spec/rules/retry.md#the-runner-retries-retryable-errors-and-rate-limits-via-the-tool-interface-events](/src/ai/.spec/rules/retry.md#the-runner-retries-retryable-errors-and-rate-limits-via-the-tool-interface-events)) and never reaches the inspection, so a reviewer that fails before writing cannot be mistaken for a passing review.

5. **A missing file re-launches that reviewer, unbounded.** When point 2 finds a reviewer's file absent, the orchestrator launches a fresh invocation of that same reviewer — there is no reviewer-to-reviewer continuity, so the re-launch starts clean like any other reviewer invocation. The re-launch repeats every time the file is still absent, with no maximum count, mirroring the runner retry policy's absorption of transient failures. A missing file never consumes a worker iteration and never restarts the worker; only the affected reviewer is re-run. This re-launch applies only to a reviewer that completed its invocation: a reviewer cancelled at round completion (see [src/commands/.spec/rules/ai/agents.md#a-review-round-completes--cancelling-any-still-waiting-reviewers--once-no-reviewer-is-running-every-required-reviewer-has-a-verdict-and-the-minimum-is-met](/src/commands/.spec/rules/ai/agents.md#a-review-round-completes--cancelling-any-still-waiting-reviewers--once-no-reviewer-is-running-every-required-reviewer-has-a-verdict-and-the-minimum-is-met)) never completes, so the re-launch never applies and its absent file is simply left unread.

6. **Per-reviewer folder isolation.** Each reviewer's verdict file lives in that reviewer's own independently created temporary folder, never in a folder shared with another reviewer. The reviewers run concurrently (see [src/commands/.spec/rules/ai/agents.md#reviewers-run-concurrently-one-independent-runner-invocation-each-and-the-stage-ends-when-the-last-finishes](/src/commands/.spec/rules/ai/agents.md#reviewers-run-concurrently-one-independent-runner-invocation-each-and-the-stage-ends-when-the-last-finishes)), so a per-reviewer file means no reviewer's writes race against another's and each verdict survives on its own; allocating each folder independently means a reviewer that inspects the directory holding its own verdict file finds only its own verdict there and cannot derive a sibling reviewer's verdict location from the path it was given.

### Why

An LLM reviewer does not reliably end with a single bare `PASS`/`FAIL` line, and a completed agent turn exits zero whether it passed or failed the work — so neither the streamed output nor the exit code is a trustworthy verdict (the reviewer-side rationale is in the shared rule named above). A file the orchestrator controls — deleted before, inspected after — turns the verdict into the presence and content of a file, which does not depend on the reviewer phrasing anything a particular way.

Deleting the file rather than emptying it closes a further hole: if the orchestrator merely emptied the file, a reviewer that silently did nothing — never inspected the changes, never wrote anything — would leave the file empty and be misread as a clean pass. By requiring the reviewer to recreate the file as its proof of having run to a verdict, an empty file means "the reviewer looked and found nothing," while an absent file means "the reviewer never reached a verdict" and is re-run instead of trusted.

### Failure signals

- The orchestrator parses a reviewer's streamed or final output for a `PASS`/`FAIL` token, or any other verdict marker, to decide that reviewer's outcome.
- The orchestrator uses a reviewer process's exit code as its verdict.
- Two reviewers are pointed at the same error file, or at `error.log` files that share a common folder, instead of one `error.log` in each reviewer's own independently created temporary folder.
- The orchestrator empties a reviewer's per-reviewer error file before that reviewer runs instead of deleting it, so a reviewer that silently does nothing leaves an empty file that is misread as a pass.
- The orchestrator reads an absent per-reviewer error file after a successful reviewer completion as a pass instead of re-launching that reviewer.
- The orchestrator re-launches a reviewer that was cancelled at round completion, instead of leaving its absent file unread and uncounted.
- The orchestrator inspects a per-reviewer error file after a reviewer invocation that errored rather than completed, producing a false pass from an absent or empty file.
