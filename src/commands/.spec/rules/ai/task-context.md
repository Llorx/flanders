# Worker and reviewer context rules

## The worker's first iteration receives the task and reference content by deterministic script injection

When the orchestrator launches the worker for iteration 1 on a task, it delivers the task's material by deterministic script-side injection: the orchestrator itself reads the files and places their content in the prompt. The worker is not expected to open the plan file to read the task, nor to open the referenced contract and rule files — they arrive already inlined. This is what spares the worker the token cost of reading them.

### Who this applies to

- **Subject:** the orchestrator of `implement`'s inner loop, at the moment it launches iteration 1 for a task.
- **Not subject:** the AI runner. The runner is told to start a fresh invocation; it does not assemble the prompt and does not read the plan, the contracts, or the rules.

### Behavior

The orchestrator invokes the worker through the AI runner as a **fresh** invocation: no session is resumed. The worker prompt is the standard worker prompt defined by [.spec/contracts/cli-commands/implement/iteration-loop.md](/.spec/contracts/cli-commands/implement/iteration-loop.md), and the orchestrator injects into it, deterministically and without any AI call:

1. **The full task text** — the verbatim region of the plan file that holds the task: its task line plus its body (description, acceptance criteria, and the contract and rule reference links), from the task line down to, but not including, the next task line or the end of the file. The boundary is detected per [.spec/contracts/shared/plan-file-format.md](/.spec/contracts/shared/plan-file-format.md) and [src/plan/.spec/rules/plan-parsing/task-body-extraction.md](/src/plan/.spec/rules/plan-parsing/task-body-extraction.md). The region is injected verbatim, with no summarization or rewriting.
2. **The full content of every contract and rule file the task references** — the orchestrator resolves the markdown links in the task body that point at a file under a `.spec/contracts` or `.spec/rules` folder (per [.spec/contracts/shared/cross-file-reference-links.md](/.spec/contracts/shared/cross-file-reference-links.md)), reads each distinct file once, and injects its full content verbatim. A link that targets a specific section or line range still contributes its whole file; the section anchor does not narrow what is injected.
3. **The global listing** of every contract and rule path in the project (each by its project-root-relative namespace), so the worker may consult any additional file at its discretion. The global listing is passed as paths only; the orchestrator does not inject the content of files the task does not reference.

### Session capture

The orchestrator captures the worker's `session_id` from the runner's event stream as iteration 1 progresses. That captured `session_id` is what [src/commands/.spec/rules/ai/task-context.md#the-worker-resumes-its-captured-session_id-across-iterations-of-the-same-task](/src/commands/.spec/rules/ai/task-context.md#the-worker-resumes-its-captured-session_id-across-iterations-of-the-same-task) uses to continue the worker across iterations n>1.

### Why this delivery

Reading the plan and the referenced files is deterministic work the orchestrator can do in code, at no token cost. Doing it once and inlining the result means the worker arrives at iteration 1 with the task and its obligations already present, instead of spending its own turns — and tokens — opening files. The global listing is kept as paths because it is cheap and lets the worker reach any file the task did not reference without inflating the prompt with content nothing asked for.

### Failure signals

- The orchestrator launches iteration 1 by resuming a session instead of as a fresh invocation.
- The orchestrator passes the worker only the task line number and title and expects it to open the plan file, instead of injecting the full task text.
- The orchestrator injects only the paths of the referenced contracts and rules instead of their full content.
- The orchestrator injects the full content of every contract and rule in the global listing, instead of only the files the task references.
- The orchestrator omits the global path listing, leaving the worker unable to consult files the task did not reference.

## The worker resumes its captured session_id across iterations of the same task

For iterations n>1 on the same task, the orchestrator launches the worker by resuming the `session_id` captured during iteration 1 (per [src/commands/.spec/rules/ai/task-context.md#the-workers-first-iteration-receives-the-task-and-reference-content-by-deterministic-script-injection](/src/commands/.spec/rules/ai/task-context.md#the-workers-first-iteration-receives-the-task-and-reference-content-by-deterministic-script-injection)). The worker arrives at iteration n>1 knowing what it itself tried in previous iterations — not as a brand-new conversation. The task text and the contracts/rules content are not re-injected; the previous-iteration briefing and the worker's continuity from iteration 1 are what carry the necessary context forward.

### Who this applies to

- **Subject:** the orchestrator of `implement`'s inner loop, at the moment it launches an iteration n>1 of the current task.
- **Not subject:** the AI runner. The runner only knows that the caller asked it to resume a given `session_id`.

### Behavior

For each iteration n>1 of a task:

1. The orchestrator looks up the worker `session_id` captured during the task's iteration 1 (or updated by a previous iteration n>1 per "Defensive capture" below).
2. The orchestrator invokes the worker through the AI runner with that `session_id` for resumption. The runner translates this to the tool-specific resume invocation (Claude: `--resume <session_id>`; Codex: `codex resume <session_id>` per [src/ai/.spec/rules/runner.md#the-claude-adapter-spawns-claude---print---output-format-stream-json-and-maps-its-events-to-the-tool-interface](/src/ai/.spec/rules/runner.md#the-claude-adapter-spawns-claude---print---output-format-stream-json-and-maps-its-events-to-the-tool-interface) and [src/ai/.spec/rules/runner.md#the-codex-adapter-spawns-codex-exec---json-and-maps-its-events-to-the-tool-interface](/src/ai/.spec/rules/runner.md#the-codex-adapter-spawns-codex-exec---json-and-maps-its-events-to-the-tool-interface)).
3. The worker prompt is the standard worker prompt for the iteration plus the previous-iteration briefing defined in the inner-loop contract. The orchestrator does NOT re-inject the task text or the contents of referenced contracts/rules into the prompt for iteration n>1.
4. **Defensive capture.** If, during iteration n>1, the worker returns a `session_id` different from the stored one (renegotiation, regeneration, etc.), the orchestrator updates the stored value for subsequent iterations.

### When resume is not available

When the worker's previous iteration did not yield a capturable `session_id` (the runner did not surface one in the event stream, or the call was interrupted before any session id was emitted), iteration n>1 is launched as a **fresh** invocation — no resume.

In that fresh-invocation branch, the orchestrator does NOT re-inject the task text or the contents of referenced contracts/rules into the worker prompt either. The worker is told what to implement, given the global listing of contract/rule paths, and given the previous-iteration briefing pointing at `error.log`. The worker re-reads whatever files it needs from disk. The cost of re-reading is real but bounded; replaying the full task text and the full contract/rule content on every iteration would burn far more tokens for a marginal gain on the iteration's first turn.

### Discard

The worker's `session_id` is valid only within the current task. It is discarded in the following moments:

- **Task change.** When moving on to the next task, the previous task's `session_id` is discarded. Each task has its own conversation.
- **Hard stop by `MAX_ITER`.** When the limit is exceeded and the run ends, no future reuse is appropriate.
- **Successful task closure.** Once the task is marked done after a valid commit/check, its `session_id` is obsolete.

### Why no context replay

Re-injecting the task text and the contents of referenced contracts/rules on every iteration would:

- Multiply token cost on every iteration past the first, with no qualitative benefit when the session is already loaded.
- Make the prompt's size proportional to the task text and the number of referenced files even when the worker already has them in context.

The previous-iteration briefing alone is enough to direct the worker to the latest failure; the rest comes either from the resumed session (when available) or from the worker re-reading the project files it needs. This is the policy this rule pins.

### Failure signals

- The orchestrator launches iteration n>1 without passing the captured `session_id` when one is available.
- The orchestrator re-injects the task text or the contents of referenced contracts/rules into the iteration n>1 prompt, replaying material the worker already has access to (either via session resume or via the working-tree files).
- The orchestrator keeps the worker's `session_id` across a task change, across a hard stop, or after a successful task closure.
- The orchestrator updates the stored `session_id` from a reviewer's response — only the worker's response can update the worker session id.

## Every reviewer invocation is fresh and receives the deterministic script injection

Each configured adversarial reviewer is launched fresh on every call, and the orchestrator delivers its task material by the same deterministic script-side injection the worker's first iteration receives. There is no reviewer-to-reviewer continuity — neither across iterations of the same reviewer nor between the distinct reviewers of a single review round: the orchestrator never stores a reviewer's `session_id` and never resumes a previous reviewer. Each reviewer is invoked through the AI runner with its own configured tool, model, and effort (see [.spec/contracts/shared/flanders-config.md](/.spec/contracts/shared/flanders-config.md)).

### Who this applies to

- **Subject:** the orchestrator of `implement`'s inner loop, at the moment it launches each reviewer invocation, for every configured reviewer.
- **Not subject:** the AI runner. It is told to start a fresh invocation.

### Behavior

For every reviewer invocation, across every iteration of every task, the orchestrator invokes the reviewer through the AI runner as a **fresh** invocation: no session resumed, and no reviewer session is ever reused. The reviewer prompt is the standard reviewer prompt defined by [.spec/contracts/cli-commands/implement/iteration-loop.md](/.spec/contracts/cli-commands/implement/iteration-loop.md), into which the orchestrator injects the same material it injects for the worker's first iteration:

1. The full task text (the verbatim region per [.spec/contracts/shared/plan-file-format.md](/.spec/contracts/shared/plan-file-format.md) and [src/plan/.spec/rules/plan-parsing/task-body-extraction.md](/src/plan/.spec/rules/plan-parsing/task-body-extraction.md)).
2. The full content of every contract and rule file the task references, each distinct file injected once, in full (resolved from the task body's markdown links per [.spec/contracts/shared/cross-file-reference-links.md](/.spec/contracts/shared/cross-file-reference-links.md)).
3. The global listing of every contract and rule path, as paths only, so the reviewer can consult any additional file at its discretion — which is what lets the reviewer flag a contract or rule that should have applied but was not referenced by the task.

The orchestrator does NOT capture any reviewer's `session_id` for any later use. A second invocation of any reviewer on the same task is a brand-new call, repeating this same injection against the same task state.

### Why fresh on every call

The reviewer's value depends on independent judgment: it must evaluate the worker's changes against the task, contracts, and rules without inheriting the worker's reasoning, the worker's rationalizations, or another reviewer's prior verdict on the same task. Reusing a reviewer's session across calls would mean the next reviewer inherits opinions formed against a different version of the working tree, which defeats the adversarial-review point. The injected material is neutral — the task text, the referenced contracts and rules, and the global path listing — so injecting it does not compromise the reviewer's independence.

### Why inject rather than have the reviewer read

The reviewer is launched fresh on every iteration with the same single-call lifetime as the worker it reviews. Injecting the task text and the referenced content once per call gives the reviewer access to the obligations it must check without forcing each reviewer to open and read every referenced file at the start of its work, the same token saving the worker's first iteration gets. The global listing's contents are not injected; only paths, just like the worker prompt.

### Relationship with neighbouring rules

- The worker's symmetric companion is [src/commands/.spec/rules/ai/task-context.md#the-workers-first-iteration-receives-the-task-and-reference-content-by-deterministic-script-injection](/src/commands/.spec/rules/ai/task-context.md#the-workers-first-iteration-receives-the-task-and-reference-content-by-deterministic-script-injection).
- The worker continuity rule [src/commands/.spec/rules/ai/task-context.md#the-worker-resumes-its-captured-session_id-across-iterations-of-the-same-task](/src/commands/.spec/rules/ai/task-context.md#the-worker-resumes-its-captured-session_id-across-iterations-of-the-same-task) is explicitly disjoint from this rule. The reviewer is never given the worker's `session_id` and never stores one of its own.

### Failure signals

- The orchestrator stores a reviewer's `session_id` and passes it to the next reviewer call on the same task.
- The orchestrator resumes any session for a reviewer instead of launching it fresh.
- A reviewer prompt is given only the paths of the referenced contracts and rules instead of their full content, leaving the reviewer to FAIL the worker on obligations it has no way to consult without opening files.
- A reviewer prompt omits the full task text, leaving the reviewer to locate the task in the plan file itself.
- The orchestrator injects the full content of every contract and rule in the global listing into a reviewer prompt, instead of only the files the task references.
