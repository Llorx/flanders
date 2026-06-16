# Worker and reviewer context rules

## The prep agent runs when at least one reviewer shares the worker's tool, model and effort

The "prep" agent — a read-only AI call that loads the task's contracts and rules into a session whose `session_id` is then reused by the worker (iter 1) and by every reviewer whose configuration matches the worker's — is an optimization, not a mandatory stage. The contract [.spec/contracts/cli-commands/implement/iteration-loop.md](/.spec/contracts/cli-commands/implement/iteration-loop.md) does not require it; this rule pins exactly when the optimization runs, who forks the prep session, and when it is skipped.

### Who this applies to

- **Subject:** the orchestrator of `implement`'s outer loop, at the moment it picks a new task and before it enters the inner loop.
- **Not subject:** the AI runner, which only knows whether the caller passed it a parent `session_id` to fork from. The runner does not decide whether the prep ran.

### The condition

The prep agent is always built with the worker's tool, model, and effort. The orchestrator launches a prep agent for a task if and only if **at least one** reviewer in the `reviewers` array matches the worker on **all three** of the following, by exact string equality on the values read from `.flanders/config.json` per [src/workspace/.spec/rules/flanders-config/file-format.md](/src/workspace/.spec/rules/flanders-config/file-format.md). A reviewer `r` matches the worker when:

1. `worker.tool == r.tool`
2. `worker.model == r.model` (including both being the empty string `""`)
3. `worker.effort == r.effort` (including both being the empty string `""`)

A reviewer that differs from the worker on any of the three does not match. The prep is launched when one or more reviewers match; it is skipped only when no reviewer matches. Partial reuse is the model: when the prep runs, it is forked by the worker's first iteration and by the matching reviewers, while non-matching reviewers receive their context inline and never fork the prep. A reviewer's `session_id` reuse is only sound when that reviewer's invocation parameters equal the prep's exactly, because cross-tool, cross-model, and cross-effort context reuse is not supported (or not stable) on the underlying CLIs — so each consumer is judged for fork-eligibility on its own against the worker's triple.

The condition is re-evaluated only when the configuration changes (in practice, never within a single `implement` run, because `.flanders/config.json` is loaded once at startup). It does not depend on per-task data.

### When the prep runs

When at least one reviewer matches the worker:

1. The orchestrator spawns a prep agent through the AI runner, using `worker.tool`, `worker.model`, and `worker.effort`.
2. The prep prompt instructs the agent to read the full content of the task line, every contract and rule referenced by the task, and any additional file from the global lists the prep judges relevant, then to end with a short acknowledgement (for example `READY`) and no pending tool calls.
3. The orchestrator captures the prep's `session_id` from the runner's stream.
4. That `session_id` becomes the **fork parent** for:
   - The worker's first iteration on the task (per [src/commands/.spec/rules/ai/task-context.md#the-workers-first-iteration-receives-its-context-per-the-prep-optimization-branch](/src/commands/.spec/rules/ai/task-context.md#the-workers-first-iteration-receives-its-context-per-the-prep-optimization-branch)). The worker always forks the prep when the prep ran, because the prep carries the worker's own triple.
   - Every reviewer invocation, across every iteration of the task, whose tool, model, and effort match the worker's triple (per [src/commands/.spec/rules/ai/task-context.md#every-reviewer-invocation-is-fresh-with-context-delivered-per-the-prep-optimization-branch](/src/commands/.spec/rules/ai/task-context.md#every-reviewer-invocation-is-fresh-with-context-delivered-per-the-prep-optimization-branch)). A reviewer whose triple differs from the worker's never forks the prep.
5. The prep's `session_id` is discarded when the task closes (success, hard stop, or task change).

The prep is read-only on the project: it does not edit, write, rename, or delete any file, and it does not write to git (subject to [src/commands/.spec/rules/ai/agents.md#autonomous-subagents-never-write-to-git](/src/commands/.spec/rules/ai/agents.md#autonomous-subagents-never-write-to-git)).

If the prep fails to produce a usable forkable `session_id` — the runner surfaces a non-retryable error, or the prep does not end in a state suitable for forking — the orchestrator hard-stops the run. The failure mode mirrors `MAX_ITER`: the run prints an error naming the task, preserves the temporary folder on disk (suppressing automatic cleanup), and exits non-zero. The orchestrator must not silently fall back to "skip prep, run without it" — the condition for running the prep is fixed, and a prep failure while the condition holds is a hard error.

### When the prep is skipped

When no reviewer matches the worker on all three checks:

1. The orchestrator does not spawn a prep agent.
2. The worker and every reviewer invocation on the task receive the contracts/rules content reconstituted in their own prompts (per [src/commands/.spec/rules/ai/task-context.md#the-workers-first-iteration-receives-its-context-per-the-prep-optimization-branch](/src/commands/.spec/rules/ai/task-context.md#the-workers-first-iteration-receives-its-context-per-the-prep-optimization-branch) and [src/commands/.spec/rules/ai/task-context.md#every-reviewer-invocation-is-fresh-with-context-delivered-per-the-prep-optimization-branch](/src/commands/.spec/rules/ai/task-context.md#every-reviewer-invocation-is-fresh-with-context-delivered-per-the-prep-optimization-branch)), not via session fork.
3. No fork-parent `session_id` is captured for the task.

Skipping the prep is a routine, silent path; it does not produce a diagnostic and does not affect the run's success.

### Why this condition specifically

Both Claude Code and Codex CLI support session resumption and forking, but the cached internal state inside a session is bound to the model and effort that produced it. Forking a session produced by `model=A effort=high` into a call that requests `model=B effort=low` either re-tokenizes the entire conversation (negating the savings) or is rejected by the underlying CLI. Building the prep with the worker's triple makes the worker's first iteration always able to fork it; launching the prep as soon as at least one reviewer also shares that triple means the prep's loaded context is amortized across the worker and every matching reviewer. Reviewers that differ are simply not fork-eligible and take the inline path, so the per-consumer exact-equality requirement is preserved while still capturing the savings whenever any reviewer can share the worker's prep.

### Failure signals

- The orchestrator launches a prep agent when no reviewer matches the worker on all three checks.
- The orchestrator skips the prep when at least one reviewer matches the worker, and instead inlines the full reference content in the worker prompt and in the matching reviewers' prompts.
- The orchestrator forks the prep into a reviewer whose tool, model, or effort differs from the worker's, instead of giving that reviewer the inline path.
- The orchestrator builds the prep with a tool/model/effort triple other than the worker's, or forks it into the worker's first iteration when the prep was not launched.
- The orchestrator decides fork-eligibility based on something other than exact equality of all three values against the worker — for example, "fork when tools match but effort differs" or "treat empty models on both sides as 'sort of the same' even when efforts differ".
- The orchestrator continues with worker or reviewer launches after a prep failure under the holding condition, instead of hard-stopping.
- The orchestrator persists the prep's `session_id` across tasks instead of discarding it on task change.

## The worker's first iteration receives its context per the prep-optimization branch

When the orchestrator launches the worker for iteration 1 on a task, the way the task's reference material reaches the worker depends on whether the prep optimization is active for the task (see [src/commands/.spec/rules/ai/task-context.md#the-prep-agent-runs-when-at-least-one-reviewer-shares-the-workers-tool-model-and-effort](/src/commands/.spec/rules/ai/task-context.md#the-prep-agent-runs-when-at-least-one-reviewer-shares-the-workers-tool-model-and-effort)).

### Who this applies to

- **Subject:** the orchestrator of `implement`'s inner loop, at the moment it launches iteration 1 for a task.
- **Not subject:** the AI runner. The runner is told whether to fork from a parent `session_id` or to start a fresh invocation; it does not reason about iteration count.

### Behavior

**Branch A — prep optimization is active for the task.** The orchestrator invokes the worker through the AI runner as a **fork** of the task's prep `session_id` captured per [src/commands/.spec/rules/ai/task-context.md#the-prep-agent-runs-when-at-least-one-reviewer-shares-the-workers-tool-model-and-effort](/src/commands/.spec/rules/ai/task-context.md#the-prep-agent-runs-when-at-least-one-reviewer-shares-the-workers-tool-model-and-effort). The worker prompt is the standard worker prompt defined by the inner-loop contract (plan path, task line/title verbatim, instructions, contract and rule lists, build/test script paths). The worker arrives at iteration 1 with the contracts and rules referenced by the task already in its loaded context, because the prep that produced the fork parent already read them.

The worker prompt does NOT additionally inline the full content of those contracts and rules; doing so would duplicate the loaded context and inflate the prompt for no gain. The worker is still bound by its own prompt instructions to respect every linked contract and rule — that obligation is independent of how the content reached the context.

**Branch B — prep optimization is skipped for the task.** The orchestrator invokes the worker through the AI runner as a **fresh** invocation (no fork parent, no resume). The worker prompt is the same standard worker prompt as above, with one addition: it inlines the full text of every contract file and every rule file the task explicitly links. The worker arrives at iteration 1 with that content present in the prompt itself.

The orchestrator does NOT, in either branch, inject the global contracts/rules listings' contents — only the explicitly linked ones. The global listings (relative paths) are passed in both branches so the worker can consult any additional file at its discretion.

### Session capture

In both branches, the orchestrator captures the worker's `session_id` from the runner's event stream as iteration 1 progresses. That captured `session_id` is what [src/commands/.spec/rules/ai/task-context.md#the-worker-resumes-its-captured-session_id-across-iterations-of-the-same-task](/src/commands/.spec/rules/ai/task-context.md#the-worker-resumes-its-captured-session_id-across-iterations-of-the-same-task) uses to continue the worker across iterations n>1.

In branch A, the captured `session_id` represents the fork — distinct from the prep's `session_id` — not the prep itself.

### Why this split

The prep is built with the worker's own tool, model, and effort, so whenever the prep ran the worker's first iteration can always fork it. The prep runs when at least one reviewer also shares the worker's triple, so its loaded context is reused by the worker and by every matching reviewer (per [src/commands/.spec/rules/ai/task-context.md#the-prep-agent-runs-when-at-least-one-reviewer-shares-the-workers-tool-model-and-effort](/src/commands/.spec/rules/ai/task-context.md#the-prep-agent-runs-when-at-least-one-reviewer-shares-the-workers-tool-model-and-effort)). When no reviewer matches the worker, the prep is not launched at all, and inlining the linked content into the worker prompt is the cheapest way to give the worker access to it without paying for an in-context load that no caller would reuse.

### Failure signals

- Branch A is taken and the worker prompt also inlines the full content of the linked contracts and rules, duplicating what is already in the forked context.
- Branch B is taken and the worker prompt does not inline the linked contracts and rules, leaving the worker without access to the obligations it is told to respect.
- The orchestrator confuses the prep's `session_id` with the worker's: stores the prep's id as the worker session for n>1 reuse, or stores the worker's id as the fork parent for the reviewer.
- The orchestrator selects branch A or B based on something other than the active state of the prep optimization (for example, "always branch A because the worker tool is `claude`").
- The orchestrator inlines the full content of every global contract and rule in either branch, instead of only the task-linked ones.

## The worker resumes its captured session_id across iterations of the same task

For iterations n>1 on the same task, the orchestrator launches the worker by resuming the `session_id` captured during iteration 1 (per [src/commands/.spec/rules/ai/task-context.md#the-workers-first-iteration-receives-its-context-per-the-prep-optimization-branch](/src/commands/.spec/rules/ai/task-context.md#the-workers-first-iteration-receives-its-context-per-the-prep-optimization-branch)). The worker arrives at iteration n>1 knowing what it itself tried in previous iterations — not as a brand-new conversation. The contracts/rules content is not re-injected; the previous-iteration briefing and the worker's continuity from iteration 1 are what carry the necessary context forward.

### Who this applies to

- **Subject:** the orchestrator of `implement`'s inner loop, at the moment it launches an iteration n>1 of the current task.
- **Not subject:** the AI runner. The runner only knows that the caller asked it to resume a given `session_id`.

### Behavior

For each iteration n>1 of a task:

1. The orchestrator looks up the worker `session_id` captured during the task's iteration 1 (or updated by a previous iteration n>1 per "Defensive capture" below).
2. The orchestrator invokes the worker through the AI runner with that `session_id` for resumption. The runner translates this to the tool-specific resume invocation (Claude: `--resume <session_id>`; Codex: `codex resume <session_id>` per [src/ai/.spec/rules/runner.md#the-claude-adapter-spawns-claude---print---output-format-stream-json-and-maps-its-events-to-the-tool-interface](/src/ai/.spec/rules/runner.md#the-claude-adapter-spawns-claude---print---output-format-stream-json-and-maps-its-events-to-the-tool-interface) and [src/ai/.spec/rules/runner.md#the-codex-adapter-spawns-codex-exec---json-and-maps-its-events-to-the-tool-interface](/src/ai/.spec/rules/runner.md#the-codex-adapter-spawns-codex-exec---json-and-maps-its-events-to-the-tool-interface)).
3. The worker prompt is the standard worker prompt for the iteration plus the previous-iteration briefing defined in the inner-loop contract. The orchestrator does NOT re-inject the contents of linked contracts/rules into the prompt for iteration n>1, regardless of how iteration 1 received them.
4. **Defensive capture.** If, during iteration n>1, the worker returns a `session_id` different from the stored one (renegotiation, regeneration, etc.), the orchestrator updates the stored value for subsequent iterations.

### When resume is not available

When the worker's previous iteration did not yield a capturable `session_id` (the runner did not surface one in the event stream, or the call was interrupted before any session id was emitted), iteration n>1 is launched as a **fresh** invocation — no resume, no fork.

In that fresh-invocation branch, the orchestrator does NOT re-inject the contents of linked contracts/rules into the worker prompt either. The worker is told what to implement, told where to find the plan, given the global lists of contracts/rules, and given the previous-iteration briefing pointing at `error.log`. The worker re-reads whatever files it needs from disk. The cost of re-reading is real but bounded; replaying full contract/rule content on every iteration would burn far more tokens for a marginal gain on the iteration's first turn.

This behavior holds even when the tool theoretically supports forking from the prep's `session_id`. Iteration n>1 must not refork from the prep — the lessons the worker accumulated during iterations 1..n-1 would be discarded.

### Discard

The worker's `session_id` is valid only within the current task. It is discarded in the following moments:

- **Task change.** When moving on to the next task, the previous task's `session_id` is discarded. Each task has its own conversation.
- **Hard stop by `MAX_ITER`.** When the limit is exceeded and the run ends, no future reuse is appropriate.
- **Successful task closure.** Once the task is marked done after a valid commit/check, its `session_id` is obsolete.

### Why no context replay

Re-injecting the contents of linked contracts/rules on every iteration would:

- Multiply token cost on every iteration past the first, with no qualitative benefit when the session is already loaded.
- Make the prompt's size proportional to the number of linked files even when the worker already has them in context.

The previous-iteration briefing alone is enough to direct the worker to the latest failure; the rest comes either from the resumed session (when available) or from the worker re-reading the project files it needs. This is the policy this rule pins.

### Failure signals

- The orchestrator launches iteration n>1 without passing the captured `session_id` when one is available.
- The orchestrator re-injects the contents of linked contracts/rules into the iteration n>1 prompt, replaying material the worker already has access to (either via session resume or via the working-tree files).
- Iteration n>1 reforks from the prep instead of resuming the worker's own session, discarding the worker's accumulated reasoning across iterations.
- The orchestrator keeps the worker's `session_id` across a task change, across a hard stop, or after a successful task closure.
- The orchestrator updates the stored `session_id` from a reviewer's response — only the worker's response can update the worker session id.

## Every reviewer invocation is fresh, with context delivered per the prep-optimization branch

Each configured adversarial reviewer is launched fresh on every call. There is no reviewer-to-reviewer continuity — neither across iterations of the same reviewer nor between the distinct reviewers of a single review round: the orchestrator never stores a reviewer's `session_id` and never resumes a previous reviewer. Each reviewer is invoked through the AI runner with its own configured tool, model, and effort (see [.spec/contracts/shared/flanders-config.md](/.spec/contracts/shared/flanders-config.md)). How a reviewer receives the task's reference material on each fresh call depends on whether, for that specific reviewer, the prep optimization applies — that is, whether the prep ran for the task and this reviewer's tool, model, and effort match the worker's triple (see [src/commands/.spec/rules/ai/task-context.md#the-prep-agent-runs-when-at-least-one-reviewer-shares-the-workers-tool-model-and-effort](/src/commands/.spec/rules/ai/task-context.md#the-prep-agent-runs-when-at-least-one-reviewer-shares-the-workers-tool-model-and-effort)).

### Who this applies to

- **Subject:** the orchestrator of `implement`'s inner loop, at the moment it launches each reviewer invocation, for every configured reviewer.
- **Not subject:** the AI runner. It is told whether to fork from a parent `session_id` or to start a fresh invocation.

### Behavior

The branch is decided per reviewer, for every configured reviewer, across every iteration of every task:

**Branch A — the prep ran and this reviewer matches the worker's triple.** This branch applies to a reviewer only when the prep was launched for the task (at least one reviewer matched the worker, per [src/commands/.spec/rules/ai/task-context.md#the-prep-agent-runs-when-at-least-one-reviewer-shares-the-workers-tool-model-and-effort](/src/commands/.spec/rules/ai/task-context.md#the-prep-agent-runs-when-at-least-one-reviewer-shares-the-workers-tool-model-and-effort)) and this particular reviewer's tool, model, and effort all equal the worker's. The orchestrator invokes the reviewer through the AI runner as a **fork** of the task's prep `session_id`. Each matching reviewer call on the task forks from the same prep — there is no reviewer-to-reviewer continuity even though forks share a common ancestor. The reviewer prompt is the standard reviewer prompt (global contract/rule lists, instructions on the FAIL conditions, verdict format). The prompt does not inline the contents of the linked contracts/rules because the forked context already carries them.

**Branch B — the prep did not run, or this reviewer does not match the worker's triple.** This branch applies to a reviewer when the prep was skipped for the task, and also to any reviewer whose tool, model, or effort differs from the worker's even though the prep ran for other reviewers. The orchestrator invokes the reviewer through the AI runner as a **fresh** invocation (no fork parent, no resume). The reviewer prompt is the standard reviewer prompt plus the inlined full content of every contract file and every rule file the task explicitly links. The global listings (relative paths) are also passed so the reviewer can consult any additional file at its discretion.

The two branches can coexist within a single review round: when the prep ran, the matching reviewers take branch A while any non-matching reviewers take branch B. In both branches, the orchestrator does NOT capture any reviewer's `session_id` for any later use. A second invocation of any reviewer on the same task is a brand-new call, repeating the appropriate branch above against the same task state.

### Why fresh on every call

The reviewer's value depends on independent judgment: it must evaluate the worker's changes against the task, contracts, and rules without inheriting the worker's reasoning, the worker's rationalizations, or another reviewer's prior verdict on the same task. Reusing a reviewer's session across calls would mean the next reviewer inherits opinions formed against a different version of the working tree, which defeats the adversarial-review point.

Branch A is still adversarial because the prep is neutral: it contains the task description, the contracts and rules referenced by the task, and the global contracts and rules the prep judged relevant — it does not contain any worker implementation, any worker reasoning, or any prior reviewer reasoning. Forking from a neutral parent preserves independence at every call.

### Why no context replay in branch B

In branch B, the reviewer receives the linked contracts/rules inlined in its prompt because there is no shared loaded context to draw from. Unlike the worker (whose iter n>1 can re-read files from disk because the worker is a long-running role over multiple iterations and re-reads are bounded), the reviewer is launched fresh on every iteration with the same single-call lifetime as the workers it reviews. Inlining the linked content once per call gives the reviewer access to the obligations it must check without forcing each reviewer to re-read every linked file at the start of its work.

The global listings' contents are not inlined; only relative paths, just like the worker prompt.

### Relationship with neighbouring rules

- The prep optimization that decides branch A vs branch B is [src/commands/.spec/rules/ai/task-context.md#the-prep-agent-runs-when-at-least-one-reviewer-shares-the-workers-tool-model-and-effort](/src/commands/.spec/rules/ai/task-context.md#the-prep-agent-runs-when-at-least-one-reviewer-shares-the-workers-tool-model-and-effort).
- The worker's context for iteration 1 — the symmetric companion of this rule for the worker side — is [src/commands/.spec/rules/ai/task-context.md#the-workers-first-iteration-receives-its-context-per-the-prep-optimization-branch](/src/commands/.spec/rules/ai/task-context.md#the-workers-first-iteration-receives-its-context-per-the-prep-optimization-branch).
- The worker continuity rule [src/commands/.spec/rules/ai/task-context.md#the-worker-resumes-its-captured-session_id-across-iterations-of-the-same-task](/src/commands/.spec/rules/ai/task-context.md#the-worker-resumes-its-captured-session_id-across-iterations-of-the-same-task) is explicitly disjoint from this rule. The reviewer is never given the worker's `session_id` and never stores one of its own.

### Failure signals

- The orchestrator stores a reviewer's `session_id` and passes it to the next reviewer call on the same task.
- The orchestrator hands the worker's `session_id` to the reviewer instead of (in branch A) the prep's, contaminating the reviewer with the worker's reasoning.
- Branch A is taken and the reviewer prompt also inlines the linked contracts/rules content, duplicating what is already in the forked context.
- Branch B is taken and the reviewer prompt does not inline the linked contracts/rules, leaving the reviewer to FAIL the worker on obligations it has no way to consult.
- A reviewer whose tool, model, or effort differs from the worker's is forked from the prep (branch A) instead of taking branch B, or a reviewer that matches the worker is forced onto branch B even though the prep ran.
- The orchestrator selects a reviewer's branch based on something other than the combination of "the prep ran for the task" and "this reviewer's triple equals the worker's".
- The orchestrator launches the reviewer after a prep failure under the holding condition, instead of hard-stopping per [src/commands/.spec/rules/ai/task-context.md#the-prep-agent-runs-when-at-least-one-reviewer-shares-the-workers-tool-model-and-effort](/src/commands/.spec/rules/ai/task-context.md#the-prep-agent-runs-when-at-least-one-reviewer-shares-the-workers-tool-model-and-effort).
