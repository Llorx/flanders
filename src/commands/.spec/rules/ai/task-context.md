# Worker and reviewer context rules

## The worker's first iteration receives the task and reference content by deterministic script injection

When the orchestrator launches the worker for iteration 1 on a task, it delivers the task's material by deterministic script-side provisioning: the orchestrator itself reads the plan and the referenced files, injects the task text into the prompt, and consolidates the referenced contract and rule content into a single `spec.md` file in the worker's temporary folder that the prompt directs the worker to read in full. The worker is not expected to open the plan file to read the task, nor to locate and open the referenced contract and rule files one by one — the task arrives in the prompt and the reference content arrives consolidated in `spec.md`.

### Who this applies to

- **Subject:** the orchestrator of `implement`'s inner loop, at the moment it launches iteration 1 for a task.
- **Not subject:** the AI runner. The runner is told to start a fresh invocation; it does not assemble the prompt and does not read the plan, the contracts, or the rules.

### Behavior

The orchestrator invokes the worker through the AI runner as a **fresh** invocation: no session is resumed. The worker prompt is the standard worker prompt defined by [.spec/contracts/cli-commands/implement/iteration-loop.md](/.spec/contracts/cli-commands/implement/iteration-loop.md), and the orchestrator provisions the worker's material, deterministically and without any AI call, as follows:

1. **The full task text, injected into the prompt** — the verbatim region of the plan file that holds the task: its task line plus its body (description, acceptance criteria, and the contract and rule reference links), from the task line down to, but not including, the next task line or the end of the file. The boundary is detected per [.spec/contracts/shared/plan-file-format.md](/.spec/contracts/shared/plan-file-format.md) and [src/plan/.spec/rules/plan-parsing/task-body-extraction.md](/src/plan/.spec/rules/plan-parsing/task-body-extraction.md). The region is injected into the prompt verbatim, with no summarization or rewriting.
2. **The referenced contract and rule content, consolidated into a single `spec.md` file in the worker's temporary folder** — the orchestrator resolves the markdown links in the task body that point at a file under a `.spec/contracts` or `.spec/rules` folder (per [.spec/contracts/shared/cross-file-reference-links.md](/.spec/contracts/shared/cross-file-reference-links.md)) and writes the referenced content, verbatim, into one `spec.md` file inside the main temporary folder (see [.spec/contracts/cli-commands/implement/workspace.md](/.spec/contracts/cli-commands/implement/workspace.md)); this content is not placed in the prompt. When a link's target carries a section (heading) anchor, only that section is written — from its heading line down to, but not including, the next heading at the same or higher level, or the end of the file. When a link carries no anchor, or an anchor that resolves to no heading in the file, the whole file is written. Each distinct file or section is written once: when any reference to a file targets the whole file, that whole file is written once and its separately-anchored sections are not duplicated; otherwise each distinct referenced section is written once. The worker prompt directs the worker to read `spec.md` in full, from beginning to end, in as few passes as possible — ideally a single read.
3. **The global listing, injected into the prompt** — every contract and rule path in the project (each by its project-root-relative namespace), so the worker may consult any additional file at its discretion. The global listing is passed as paths only, in the prompt; the orchestrator writes neither the content of files the task does not reference into `spec.md` nor that content into the prompt.

### Session capture

The orchestrator captures the worker's `session_id` from the runner's event stream as iteration 1 progresses. That captured `session_id` is what [src/commands/.spec/rules/ai/task-context.md#the-worker-resumes-its-captured-session_id-across-iterations-of-the-same-task](/src/commands/.spec/rules/ai/task-context.md#the-worker-resumes-its-captured-session_id-across-iterations-of-the-same-task) uses to continue the worker across iterations n>1.

### Why this delivery

Reading the plan and the referenced files is deterministic work the orchestrator can do in code, at no token cost. Consolidating the referenced obligations into a single `spec.md` the worker reads once — rather than inlining them into the prompt — keeps the prompt itself small while still sparing the worker from locating and opening each referenced file separately, a sequence of reads whose cost grows with every file as the worker's context accumulates. Narrowing by section anchor keeps `spec.md` to the obligations the task actually points at, rather than whole files when only a section applies. The task text stays in the prompt because the worker needs it immediately to know what to build, and the global listing is kept as paths because it is cheap and lets the worker reach any file the task did not reference without bloating either the prompt or `spec.md` with content nothing asked for.

### Failure signals

- The orchestrator launches iteration 1 by resuming a session instead of as a fresh invocation.
- The orchestrator passes the worker only the task line number and title and expects it to open the plan file, instead of injecting the full task text into the prompt.
- The orchestrator inlines the referenced contract and rule content into the prompt instead of consolidating it into the `spec.md` file the worker reads.
- The orchestrator writes only the referenced file paths into `spec.md`, or omits `spec.md` entirely, leaving the worker to locate and open each referenced file itself.
- The orchestrator writes the whole of a referenced file into `spec.md` when the task's link to it carries a section anchor, instead of narrowing to that section.
- The orchestrator writes the content of every contract and rule in the global listing into `spec.md`, instead of only the files or sections the task references.
- The worker prompt does not direct the worker to read `spec.md` in full.
- The orchestrator omits the global path listing, leaving the worker unable to consult files the task did not reference.

## The worker resumes its captured session_id across iterations of the same task

For iterations n>1 on the same task, the orchestrator launches the worker by resuming the `session_id` captured during iteration 1 (per [src/commands/.spec/rules/ai/task-context.md#the-workers-first-iteration-receives-the-task-and-reference-content-by-deterministic-script-injection](/src/commands/.spec/rules/ai/task-context.md#the-workers-first-iteration-receives-the-task-and-reference-content-by-deterministic-script-injection)). The worker arrives at iteration n>1 knowing what it itself tried in previous iterations — not as a brand-new conversation. The task text and the contracts/rules content are not re-injected; the previous-iteration briefing and the worker's continuity from iteration 1 are what carry the necessary context forward.

### Who this applies to

- **Subject:** the orchestrator of `implement`'s inner loop, at the moment it launches an iteration n>1 of the current task.
- **Not subject:** the AI runner. The runner only knows that the caller asked it to resume a given `session_id`.

### Behavior

For each iteration n>1 of a task:

1. The orchestrator looks up the worker `session_id` captured during the task's iteration 1 (or updated by a previous iteration n>1 per "Defensive capture" below).
2. The orchestrator invokes the worker through the AI runner with that `session_id` for resumption, and supplies the worker session's running token totals — the input and output tokens already attributed to that session across its prior iterations — as the resume baseline. The runner passes the `session_id` to the selected adapter as `resumeSessionId`; that adapter translates it into the tool-specific resume invocation (Claude: `--resume <session_id>`; Codex: `codex exec resume <session_id>` per [src/ai/.spec/rules/runner.md#the-claude-adapter-spawns-claude---print---output-format-stream-json-and-maps-its-events-to-the-tool-interface](/src/ai/.spec/rules/runner.md#the-claude-adapter-spawns-claude---print---output-format-stream-json-and-maps-its-events-to-the-tool-interface) and [src/ai/.spec/rules/runner.md#the-codex-adapter-spawns-codex-exec---json-and-maps-its-events-to-the-tool-interface](/src/ai/.spec/rules/runner.md#the-codex-adapter-spawns-codex-exec---json-and-maps-its-events-to-the-tool-interface)). The runner also passes the baseline to the adapter as `priorSessionUsage` per [src/ai/.spec/rules/runner.md#all-ai-tools-implement-the-same-generic-tool-adapter-interface](/src/ai/.spec/rules/runner.md#all-ai-tools-implement-the-same-generic-tool-adapter-interface). The baseline keeps the task's `it`/`ot` metrics (see [.spec/contracts/shared/plan-file-format.md](/.spec/contracts/shared/plan-file-format.md)) at real consumption when the resumed tool reports session-cumulative usage: the adapter reports only the new iteration's own consumption, never re-counting the tokens of prior iterations.
3. The worker prompt is the standard worker prompt for the iteration plus the previous-iteration briefing defined in the inner-loop contract. The orchestrator does NOT re-inject the task text or the contents of referenced contracts/rules into the prompt for iteration n>1.
4. **Defensive capture.** If, during iteration n>1, the worker returns a `session_id` different from the stored one (renegotiation, regeneration, etc.), the orchestrator updates the stored value for subsequent iterations.

### When resume is not available

When the worker's previous iteration did not yield a capturable `session_id` (the runner did not surface one in the event stream, or the call was interrupted before any session id was emitted), iteration n>1 is launched as a **fresh** invocation — no resume.

In that fresh-invocation branch, the orchestrator does NOT re-inject the task text into the worker prompt, nor regenerate the consolidated `spec.md`. The worker is told what to implement, given the global listing of contract/rule paths, and given the previous-iteration briefing pointing at `error.log`. The worker re-reads whatever it needs from disk — the consolidated `spec.md` from the task's iteration 1 is still present in the main temporary folder, so it can reread that single file instead of reopening each referenced project file. The cost of re-reading is real but bounded; replaying the full task text and the full reference content on every iteration would burn far more tokens for a marginal gain on the iteration's first turn.

### Discard

The worker's `session_id` is valid only within the current task. It is discarded in the following moments:

- **Task change.** When moving on to the next task, the previous task's `session_id` is discarded. Each task has its own conversation.
- **Hard stop by `MAX_ITER`.** When the limit is exceeded and the run ends, no future reuse is appropriate.
- **Successful task closure.** Once the task is marked done after a valid commit/check, its `session_id` is obsolete.

### Failure signals

- The orchestrator launches iteration n>1 without passing the captured `session_id` when one is available.
- The orchestrator resumes the worker without supplying the session's accumulated usage as the resume baseline, so a tool that reports session-cumulative usage makes the task's `it`/`ot` re-count the tokens of prior iterations.
- The orchestrator re-injects the task text or the referenced contract/rule content into the iteration n>1 prompt, replaying material the worker already has access to (via session resume, via the consolidated `spec.md` still in the temporary folder, or via the working-tree files).
- The orchestrator keeps the worker's `session_id` across a task change, across a hard stop, or after a successful task closure.
- The orchestrator updates the stored `session_id` from a reviewer's response — only the worker's response can update the worker session id.

## Every reviewer invocation is fresh and receives the deterministic script injection

Each configured adversarial reviewer is launched fresh on every call, and the orchestrator delivers its task material by the same deterministic script-side injection the worker's first iteration receives. There is no reviewer-to-reviewer continuity — neither across iterations of the same reviewer nor between the distinct reviewers of a single review round: the orchestrator never stores a reviewer's `session_id` and never resumes a previous reviewer. Each reviewer is invoked through the AI runner with its own configured tool, model, and effort (see [.spec/contracts/shared/flanders-config.md](/.spec/contracts/shared/flanders-config.md)).

### Who this applies to

- **Subject:** the orchestrator of `implement`'s inner loop, at the moment it launches each reviewer invocation, for every configured reviewer.
- **Not subject:** the AI runner. It is told to start a fresh invocation.

### Behavior

For every reviewer invocation, across every iteration of every task, the orchestrator invokes the reviewer through the AI runner as a **fresh** invocation: no session resumed, and no reviewer session is ever reused. The reviewer prompt is the standard reviewer prompt defined by [.spec/contracts/cli-commands/implement/iteration-loop.md](/.spec/contracts/cli-commands/implement/iteration-loop.md), and the orchestrator provisions the reviewer's material the same way it does for the worker's first iteration:

1. The full task text, injected into the prompt (the verbatim region per [.spec/contracts/shared/plan-file-format.md](/.spec/contracts/shared/plan-file-format.md) and [src/plan/.spec/rules/plan-parsing/task-body-extraction.md](/src/plan/.spec/rules/plan-parsing/task-body-extraction.md)).
2. The referenced contract and rule content, consolidated into a `spec.md` file inside that reviewer's own temporary folder — the per-reviewer folder that also holds its `error.log` (see [.spec/contracts/cli-commands/implement/workspace.md](/.spec/contracts/cli-commands/implement/workspace.md)) — resolved from the task body's markdown links per [.spec/contracts/shared/cross-file-reference-links.md](/.spec/contracts/shared/cross-file-reference-links.md), with the same section-anchor narrowing the worker's `spec.md` uses: the linked section when the reference carries a heading anchor, the whole file when it does not, each distinct file or section written once. This content is not placed in the prompt. The reviewer prompt directs the reviewer to read its `spec.md` in full, from beginning to end, in as few passes as possible. Each reviewer's `spec.md` lives in that reviewer's own temporary folder, never one shared with another reviewer.
3. The global listing of every contract and rule path, as paths only in the prompt, so the reviewer can consult any additional file at its discretion — which is what lets the reviewer flag a contract or rule that should have applied but was not referenced by the task.

The orchestrator does NOT capture any reviewer's `session_id` for any later use. A second invocation of any reviewer on the same task is a brand-new call, repeating this same provisioning against the same task state.

### Why fresh on every call

The reviewer's value depends on independent judgment: it must evaluate the worker's changes against the task, contracts, and rules without inheriting the worker's reasoning, the worker's rationalizations, or another reviewer's prior verdict on the same task. Reusing a reviewer's session across calls would mean the next reviewer inherits opinions formed against a different version of the working tree, which defeats the adversarial-review point. The injected material is neutral — the task text, the referenced contracts and rules, and the global path listing — so injecting it does not compromise the reviewer's independence.

### Why inject rather than have the reviewer read

The reviewer is launched fresh on every iteration with the same single-call lifetime as the worker it reviews. Giving the reviewer the task text in its prompt and the referenced obligations consolidated in a single `spec.md` it reads once gives the reviewer access to the obligations it must check without forcing each reviewer to locate and open every referenced file at the start of its work — the same saving the worker's first iteration gets, and without inflating the reviewer prompt with the full reference content. The global listing's content is not consolidated; only paths are passed, in the prompt, just like the worker prompt.

### Relationship with neighbouring rules

- The worker's symmetric companion is [src/commands/.spec/rules/ai/task-context.md#the-workers-first-iteration-receives-the-task-and-reference-content-by-deterministic-script-injection](/src/commands/.spec/rules/ai/task-context.md#the-workers-first-iteration-receives-the-task-and-reference-content-by-deterministic-script-injection).
- The worker continuity rule [src/commands/.spec/rules/ai/task-context.md#the-worker-resumes-its-captured-session_id-across-iterations-of-the-same-task](/src/commands/.spec/rules/ai/task-context.md#the-worker-resumes-its-captured-session_id-across-iterations-of-the-same-task) is explicitly disjoint from this rule. The reviewer is never given the worker's `session_id` and never stores one of its own.

### Failure signals

- The orchestrator stores a reviewer's `session_id` and passes it to the next reviewer call on the same task.
- The orchestrator resumes any session for a reviewer instead of launching it fresh.
- The orchestrator inlines the referenced contract and rule content into the reviewer prompt instead of consolidating it into the reviewer's `spec.md`.
- The orchestrator writes only the referenced file paths into the reviewer's `spec.md`, or omits it, leaving the reviewer to locate and open each referenced file itself.
- The orchestrator writes the whole of a referenced file into the reviewer's `spec.md` when the task's link to it carries a section anchor, instead of narrowing to that section.
- The reviewer prompt does not direct the reviewer to read its `spec.md` in full.
- A reviewer's `spec.md` is placed in a folder shared with another reviewer instead of that reviewer's own temporary folder.
- A reviewer prompt omits the full task text, leaving the reviewer to locate the task in the plan file itself.
- The orchestrator writes the content of every contract and rule in the global listing into the reviewer's `spec.md`, instead of only the files or sections the task references.
