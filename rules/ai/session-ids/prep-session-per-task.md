# Each task is preceded by a prep session that pre-loads its reference material

Before the worker is launched on a task for the first time, `implement` runs a dedicated **prep** Claude session whose only job is to read the task's reference material and end in a clean state suitable to be forked. The prep's `session_id` is captured and becomes the parent session for every subsequent fork that operates on that task — the worker's first iteration and every reviewer invocation.

## Who this applies to

- **Subject:** the orchestrator of `implement` (the code that decides which agent to launch and with what `session_id`).
- **Not subject:** the runner, the worker itself, or the reviewer itself. Those receive the prep's `session_id` as their fork parent but do not decide when or how to create it.

## What the prep reads

The prep is given:

1. The identity of the task (plan path, task line, task title).
2. The full global list of available contracts (every file under `contracts/`).
3. The full global list of available rules (every file under `rules/`).

Its obligations on those inputs are:

1. Read the full content of the task — its description, acceptance criteria, and any explicit link from the task to a contract or rule file.
2. Read the full content of every contract file the task references.
3. Read the full content of every rule file the task references.
4. From the global lists, read the full content of every additional contract or rule the prep judges relevant to the task even though the task does not explicitly link it. The judgment is the prep's own; the prep is expected to err on the side of loading material that might be needed rather than skipping it.

The prep does not implement, modify, or write anything in the project. It is a read-only context-loading agent.

## End state

The prep ends with a short acknowledgement (for example, "READY") and no pending tool calls. The session must be in a state where appending a new user message and forking will not collide with unfinished work from the prep itself.

The prep is forbidden from any git-modifying command (same prohibition as workers and reviewers — see `rules/ai/agents/no-git-writes.md`). Read-only git inspection is allowed if the prep judges it useful to understand the task.

## Lifecycle

- **Creation.** The prep is created at the moment the orchestrator picks up an open task and before the first worker iteration of that task.
- **Reuse window.** The prep's `session_id` is the fork parent for: the worker's first iteration on the task, and every reviewer invocation across every iteration of the task.
- **Discard.** The prep's `session_id` is discarded when the task closes (successfully or by hard stop via `MAX_ITER`) or when the orchestrator advances to a different task. Each task gets its own prep.

A failure to create the prep, or a prep that does not end in a forkable state, blocks the worker and reviewer launches that depend on it — the orchestrator must not silently fall back to a non-forked session for those calls.

## When this rule does not apply

- **Build/test detection.** The agent that fills `build.bat` / `test.bat` at the start of an `implement` run is not task-scoped and does not produce a prep. It runs as today.
- **Worker iterations n>1.** Subsequent worker iterations on the same task do not refork from the prep; they continue from the worker's own session per `rules/ai/session-ids/worker-session-across-iterations.md`.

## Failure signals

- The orchestrator launches the worker's first iteration without a prep parent session.
- The orchestrator launches a reviewer without a prep parent session.
- The prep performs implementation work (Edits, Writes, Bash commands that mutate the project, git writes) instead of staying read-only.
- The prep is reused across tasks rather than being recreated per task.
- The prep skips reading material the task explicitly references on the grounds that it "looks unrelated" — the explicit task links are mandatory; only the global-judgment additions are at the prep's discretion.
- The orchestrator continues with worker/reviewer launches after the prep failed to produce a usable `session_id`, instead of treating the failure as a blocker.
