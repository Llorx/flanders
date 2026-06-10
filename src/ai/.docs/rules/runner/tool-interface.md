# All AI tools implement the same generic tool-adapter interface

The AI runner (see `src/ai/.docs/contracts/ai-runner.md`) does not contain Claude- or Codex-specific code. It consumes one abstract interface that every per-tool adapter implements. Each adapter is the bridge between a single AI tool's native CLI surface and the runner's event-driven world: it spawns the binary, parses the binary's output, and emits a stream of events whose shape is fixed by this rule. The runner reacts only to those events, never to the underlying tool's native event format.

Adding a new AI tool to Flanders is a matter of writing a new adapter that implements this interface; it must not require changes inside the runner, inside the retry rules, inside the UI rules, or inside the implement orchestration.

## Who this applies to

- **Subject:** every per-tool adapter. Today: the Claude adapter (see `src/ai/.docs/rules/runner/claude-invocation.md`) and the Codex adapter (see `src/ai/.docs/rules/runner/codex-invocation.md`). Any future adapter falls under this rule the moment it is added.
- **Subject:** the AI runner, which consumes the interface and is forbidden from branching on the underlying tool.
- **Not subject:** the call sites of the runner (worker stage, reviewer stage, detect agent, prep). They see only the runner's high-level result (success or non-retryable error), not the events.

## Adapter signature

Every adapter exposes one invocation function. Its signature, abstractly:

    invoke({ prompt, model, effort, resumeSessionId?, forkParentSessionId?, abortSignal }) → AsyncIterable<ToolEvent>

Arguments:

- `prompt` — the prompt text to send. The adapter is responsible for delivering it to the binary in whatever way that binary requires (stdin, argv, file); the runner does not care.
- `model` — the model identifier persisted in `.flanders/config.json` per `src/.docs/rules/flanders-config/file-format.md`. An empty string means "default configured model" and the adapter must not pass an explicit model flag to its binary.
- `effort` — the effort identifier persisted in `.flanders/config.json`. An empty string means "default configured effort" and the adapter must not pass an explicit effort flag.
- `resumeSessionId` — when set, the adapter resumes the previous session with that id (used by `src/commands/.docs/rules/ai/task-context/worker-continuity.md`). When unset, the adapter starts a fresh invocation.
- `forkParentSessionId` — when set, the adapter forks from that parent session (used by the branch-A case in `src/commands/.docs/rules/ai/task-context/prep-optimization.md`). When unset, no fork happens.
- `abortSignal` — when the signal triggers, the adapter sends the appropriate termination signal to its spawned process, drains any remaining buffered output, and ends the iterable promptly. The runner waits for the iterable to close; the adapter does not return until the child process has exited.

`resumeSessionId` and `forkParentSessionId` are mutually exclusive: at most one is set per invocation.

The return value is an async iterable of `ToolEvent`. The runner consumes events as they arrive and reacts to each one according to its type.

## Event types

There are exactly five `ToolEvent` variants. Adapters must not invent additional variants; the runner must not handle anything outside this set.

### `{ type: "output", title, subtitle, details }`

A surface-able piece of tool activity that the runner forwards to the UI region defined in `.docs/contracts/cli-commands/implement/ui.md`. Field shape:

- `title` — short label (1–2 words). For example: `"Read"`, `"Edit"`, `"Bash"`, `"Assistant"`, `"Result"`, `"Thinking"`. The adapter chooses titles that read naturally for that tool.
- `subtitle` — one-line qualifier. For example: the file path of a `Read`, the command of a `Bash`, an empty string when no qualifier applies. May be empty.
- `details` — free-form text body, possibly multi-line, possibly containing ANSI escape sequences. The runner passes ANSI through unchanged per the UI rules. May be empty.

The runner renders the three fields into the output region without applying its own per-tool styling — the structure is what is pinned, the on-screen format belongs to the UI layer.

`output` events are non-terminal. A single invocation may emit zero, one, or many of them, in any order, before the terminal event.

### `{ type: "session", id }`

The adapter has observed the tool's `session_id` for this invocation and surfaces it to the runner. The runner captures it for later reuse per `src/ai/.docs/rules/retry/retry-reuses-session.md` (within-call retry continuity) and per `src/commands/.docs/rules/ai/task-context/worker-continuity.md` (cross-iteration worker continuity). Field shape:

- `id` — the opaque session identifier string the tool exposed. Never empty.

`session` events are non-terminal. A single invocation emits zero or one `session` event total — once the id is captured, subsequent appearances of the same id by the tool are silently absorbed by the adapter and not re-emitted.

### `{ type: "error", retryable, message }`

The invocation failed. Field shape:

- `retryable` — boolean. `true` means the runner must retry per `src/ai/.docs/rules/retry/retry-on-errors-and-rate-limits.md` and `src/ai/.docs/rules/retry/transient-error-backoff.md`. `false` means the failure propagates to the caller as a non-retryable error.
- `message` — short, human-readable reason. Used for surfacing to the user (UI region) and for logging to `error.log`. The runner never inspects `message` to decide retryability — the `retryable` boolean is authoritative.

`error` is a terminal event: when an adapter emits an `error`, the invocation has ended and no further events follow. The iterable closes after the `error` event has been yielded.

The decision of whether a given failure is retryable lives entirely in the adapter. The runner does not second-guess it. Adapters classify their tool's native error surface into retryable / non-retryable according to the rule that pins each tool's adapter (see `src/ai/.docs/rules/runner/claude-invocation.md`, `src/ai/.docs/rules/runner/codex-invocation.md`).

### `{ type: "rate_limit", waitUntilMs }`

The invocation hit a rate-limit signalled by the tool. Field shape:

- `waitUntilMs` — Unix timestamp in milliseconds: the wall-clock instant the runner waits until before re-invoking. It is the tool's authoritative reset instant when the tool's signal carries one; when the tool signals a rate-limit or quota/credit exhaustion without an end time, it is an estimate the adapter synthesizes for that signal. Either way the runner waits until this point per `src/ai/.docs/rules/retry/long-wait-chunked-timer.md` (chunking the wait when it exceeds an hour) and then re-invokes the same adapter with the same arguments.

`rate_limit` is a terminal event: when an adapter emits it, the invocation has ended.

`waitUntilMs` is always in the future relative to the moment the event is emitted. How an adapter derives it — reading the tool's reset field, or synthesizing an estimate when the tool reports a rate-limit without an end time — is pinned by that adapter's own rule (see `src/ai/.docs/rules/runner/claude-invocation.md`, `src/ai/.docs/rules/runner/codex-invocation.md`).

### `{ type: "done" }`

The invocation finished successfully. No payload — success is conveyed by reaching this event without an `error` or `rate_limit` first.

`done` is a terminal event. The iterable closes after `done` has been yielded.

## Terminal event invariant

Every invocation produces exactly one terminal event: one of `error`, `rate_limit`, or `done`. The iterable closes after the terminal event yields. An adapter that closes the iterable without emitting a terminal event is in violation; the runner does not have to handle that case and may assume it never happens.

## Output channel discipline

Adapters do NOT write to `process.stdout` or `process.stderr` directly. Anything the user sees on the terminal comes through the runner, which routes `output` events to the UI region. Adapters that "let the binary's stdout pass through" defeat the structural guarantees the interface provides and break the UI's redraw / scroll-region invariants.

Spawned children may inherit a piped stdout/stderr that the adapter reads — that is allowed (and necessary) — but the adapter parses what the child emits and turns it into events, never relays it untranslated to the user's terminal.

## Why this interface specifically

- The five event types map directly to the five concerns the runner has: display the tool's work (`output`), capture session continuity (`session`), decide retry vs propagate (`error`), schedule an authoritative wait (`rate_limit`), and end the call (`done`).
- The interface contains no tool-specific fields. The runner branches on `type`, never on which adapter produced the event.
- Errors and rate-limits are first-class events, not out-of-band exceptions. The runner has a single event loop, not an event loop plus a separate error channel plus a signal handler.
- The shape forces adapters to do the work the runner does not want to do (parsing the tool's native event stream, classifying errors, extracting rate-limit durations). The runner stays thin.

## Failure signals

- The runner branches on which tool is configured (`if (tool === "claude") ...`) to decide retry behavior, format output, capture session, or schedule waits. The interface is the only contract; per-tool branches inside the runner mean the abstraction leaked.
- An adapter writes directly to `process.stdout` or `process.stderr` instead of emitting `output` events.
- An adapter emits more than one terminal event per invocation, or emits a non-terminal event after the terminal one.
- An adapter emits more than one `session` event per invocation with distinct ids (the tool changed its session id mid-call — the adapter must surface only the latest captured id once, not narrate the change).
- An adapter emits a `rate_limit` event with a `waitUntilMs` in the past, defeating the long-wait timer.
- An adapter emits an `error` whose `retryable` field is decided by re-parsing the `message` from outside the adapter — `retryable` must reflect the adapter's own classification, not the runner's or any caller's.
- An adapter ignores `abortSignal` and continues consuming the child's output (or leaks the child process) after the runner has cancelled.
- A new adapter is added that introduces a new event variant beyond the five listed here, instead of mapping its tool's native events onto the existing five.
