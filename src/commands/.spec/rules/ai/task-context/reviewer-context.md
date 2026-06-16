# Every reviewer invocation is fresh, with context delivered per the prep-optimization branch

Each configured adversarial reviewer is launched fresh on every call. There is no reviewer-to-reviewer continuity — neither across iterations of the same reviewer nor between the distinct reviewers of a single review round: the orchestrator never stores a reviewer's `session_id` and never resumes a previous reviewer. Each reviewer is invoked through the AI runner with its own configured tool, model, and effort (see [.spec/contracts/shared/flanders-config.md](/.spec/contracts/shared/flanders-config.md)). How a reviewer receives the task's reference material on each fresh call depends on whether, for that specific reviewer, the prep optimization applies — that is, whether the prep ran for the task and this reviewer's tool, model, and effort match the worker's triple (see [src/commands/.spec/rules/ai/task-context/prep-optimization.md](/src/commands/.spec/rules/ai/task-context/prep-optimization.md)).

## Who this applies to

- **Subject:** the orchestrator of `implement`'s inner loop, at the moment it launches each reviewer invocation, for every configured reviewer.
- **Not subject:** the AI runner. It is told whether to fork from a parent `session_id` or to start a fresh invocation.

## Behavior

The branch is decided per reviewer, for every configured reviewer, across every iteration of every task:

**Branch A — the prep ran and this reviewer matches the worker's triple.** This branch applies to a reviewer only when the prep was launched for the task (at least one reviewer matched the worker, per [src/commands/.spec/rules/ai/task-context/prep-optimization.md](/src/commands/.spec/rules/ai/task-context/prep-optimization.md)) and this particular reviewer's tool, model, and effort all equal the worker's. The orchestrator invokes the reviewer through the AI runner as a **fork** of the task's prep `session_id`. Each matching reviewer call on the task forks from the same prep — there is no reviewer-to-reviewer continuity even though forks share a common ancestor. The reviewer prompt is the standard reviewer prompt (global contract/rule lists, instructions on the FAIL conditions, verdict format). The prompt does not inline the contents of the linked contracts/rules because the forked context already carries them.

**Branch B — the prep did not run, or this reviewer does not match the worker's triple.** This branch applies to a reviewer when the prep was skipped for the task, and also to any reviewer whose tool, model, or effort differs from the worker's even though the prep ran for other reviewers. The orchestrator invokes the reviewer through the AI runner as a **fresh** invocation (no fork parent, no resume). The reviewer prompt is the standard reviewer prompt plus the inlined full content of every contract file and every rule file the task explicitly links. The global listings (relative paths) are also passed so the reviewer can consult any additional file at its discretion.

The two branches can coexist within a single review round: when the prep ran, the matching reviewers take branch A while any non-matching reviewers take branch B. In both branches, the orchestrator does NOT capture any reviewer's `session_id` for any later use. A second invocation of any reviewer on the same task is a brand-new call, repeating the appropriate branch above against the same task state.

## Why fresh on every call

The reviewer's value depends on independent judgment: it must evaluate the worker's changes against the task, contracts, and rules without inheriting the worker's reasoning, the worker's rationalizations, or another reviewer's prior verdict on the same task. Reusing a reviewer's session across calls would mean the next reviewer inherits opinions formed against a different version of the working tree, which defeats the adversarial-review point.

Branch A is still adversarial because the prep is neutral: it contains the task description, the contracts and rules referenced by the task, and the global contracts and rules the prep judged relevant — it does not contain any worker implementation, any worker reasoning, or any prior reviewer reasoning. Forking from a neutral parent preserves independence at every call.

## Why no context replay in branch B

In branch B, the reviewer receives the linked contracts/rules inlined in its prompt because there is no shared loaded context to draw from. Unlike the worker (whose iter n>1 can re-read files from disk because the worker is a long-running role over multiple iterations and re-reads are bounded), the reviewer is launched fresh on every iteration with the same single-call lifetime as the workers it reviews. Inlining the linked content once per call gives the reviewer access to the obligations it must check without forcing each reviewer to re-read every linked file at the start of its work.

The global listings' contents are not inlined; only relative paths, just like the worker prompt.

## Relationship with neighbouring rules

- The prep optimization that decides branch A vs branch B is [src/commands/.spec/rules/ai/task-context/prep-optimization.md](/src/commands/.spec/rules/ai/task-context/prep-optimization.md).
- The worker's context for iteration 1 — the symmetric companion of this rule for the worker side — is [src/commands/.spec/rules/ai/task-context/worker-iter1-context.md](/src/commands/.spec/rules/ai/task-context/worker-iter1-context.md).
- The worker continuity rule [src/commands/.spec/rules/ai/task-context/worker-continuity.md](/src/commands/.spec/rules/ai/task-context/worker-continuity.md) is explicitly disjoint from this rule. The reviewer is never given the worker's `session_id` and never stores one of its own.

## Failure signals

- The orchestrator stores a reviewer's `session_id` and passes it to the next reviewer call on the same task.
- The orchestrator hands the worker's `session_id` to the reviewer instead of (in branch A) the prep's, contaminating the reviewer with the worker's reasoning.
- Branch A is taken and the reviewer prompt also inlines the linked contracts/rules content, duplicating what is already in the forked context.
- Branch B is taken and the reviewer prompt does not inline the linked contracts/rules, leaving the reviewer to FAIL the worker on obligations it has no way to consult.
- A reviewer whose tool, model, or effort differs from the worker's is forked from the prep (branch A) instead of taking branch B, or a reviewer that matches the worker is forced onto branch B even though the prep ran.
- The orchestrator selects a reviewer's branch based on something other than the combination of "the prep ran for the task" and "this reviewer's triple equals the worker's".
- The orchestrator launches the reviewer after a prep failure under the holding condition, instead of hard-stopping per [src/commands/.spec/rules/ai/task-context/prep-optimization.md](/src/commands/.spec/rules/ai/task-context/prep-optimization.md).
