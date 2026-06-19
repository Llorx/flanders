# AI tool adapter rules

## All AI tools implement the same generic tool-adapter interface

The AI runner (see [src/ai/.spec/contracts/ai-runner.md](/src/ai/.spec/contracts/ai-runner.md)) does not contain Claude- or Codex-specific code. It consumes one abstract interface that every per-tool adapter implements. Each adapter is the bridge between a single AI tool's native CLI surface and the runner's event-driven world: it spawns the binary, parses the binary's output, and emits a stream of events whose shape is fixed by this rule. The runner reacts only to those events, never to the underlying tool's native event format.

Adding a new AI tool to Flanders is a matter of writing a new adapter that implements this interface; it must not require changes inside the runner, inside the retry rules, inside the UI rules, or inside the implement orchestration.

### Who this applies to

- **Subject:** every per-tool adapter. Today: the Claude adapter (see [src/ai/.spec/rules/runner.md#the-claude-adapter-spawns-claude---print---output-format-stream-json-and-maps-its-events-to-the-tool-interface](/src/ai/.spec/rules/runner.md#the-claude-adapter-spawns-claude---print---output-format-stream-json-and-maps-its-events-to-the-tool-interface)) and the Codex adapter (see [src/ai/.spec/rules/runner.md#the-codex-adapter-spawns-codex-exec---json-and-maps-its-events-to-the-tool-interface](/src/ai/.spec/rules/runner.md#the-codex-adapter-spawns-codex-exec---json-and-maps-its-events-to-the-tool-interface)). Any future adapter falls under this rule the moment it is added.
- **Subject:** the AI runner, which consumes the interface and is forbidden from branching on the underlying tool.
- **Not subject:** the call sites of the runner (worker stage, reviewer stage, detect agent). They see only the runner's high-level result (success or non-retryable error), not the events.

### Adapter signature

Every adapter exposes one invocation function. Its signature, abstractly:

    invoke({ prompt, model, effort, resumeSessionId?, abortSignal }) → AsyncIterable<ToolEvent>

Arguments:

- `prompt` — the prompt text to send. The adapter is responsible for delivering it to the binary in whatever way that binary requires (stdin, argv, file); the runner does not care.
- `model` — the model identifier persisted in `.flanders/config.json` per [src/workspace/.spec/rules/flanders-config/file-format.md](/src/workspace/.spec/rules/flanders-config/file-format.md). An empty string means "default configured model" and the adapter must not pass an explicit model flag to its binary.
- `effort` — the effort identifier persisted in `.flanders/config.json`. An empty string means "default configured effort" and the adapter must not pass an explicit effort flag.
- `resumeSessionId` — when set, the adapter resumes the previous session with that id (used by [src/commands/.spec/rules/ai/task-context.md#the-worker-resumes-its-captured-session_id-across-iterations-of-the-same-task](/src/commands/.spec/rules/ai/task-context.md#the-worker-resumes-its-captured-session_id-across-iterations-of-the-same-task)). When unset, the adapter starts a fresh invocation.
- `abortSignal` — when the signal triggers, the adapter sends the appropriate termination signal to its spawned process, drains any remaining buffered output, and ends the iterable promptly. The runner waits for the iterable to close; the adapter does not return until the child process has exited.

The return value is an async iterable of `ToolEvent`. The runner consumes events as they arrive and reacts to each one according to its type.

### Event types

There are exactly five `ToolEvent` variants. Adapters must not invent additional variants; the runner must not handle anything outside this set.

#### `{ type: "output", title, subtitle, details }`

A surface-able piece of tool activity that the runner forwards to the UI region defined in [.spec/contracts/cli-commands/implement/ui.md](/.spec/contracts/cli-commands/implement/ui.md). Field shape:

- `title` — short label (1–2 words). For example: `"Read"`, `"Edit"`, `"Bash"`, `"Assistant"`, `"Result"`, `"Thinking"`. The adapter chooses titles that read naturally for that tool.
- `subtitle` — one-line qualifier. For example: the file path of a `Read`, the command of a `Bash`, an empty string when no qualifier applies. May be empty.
- `details` — free-form text body, possibly multi-line, possibly containing ANSI escape sequences. The runner passes ANSI through unchanged per the UI rules. May be empty.

The runner renders the three fields into the output region without applying its own per-tool styling — the structure is what is pinned, the on-screen format belongs to the UI layer.

`output` events are non-terminal. A single invocation may emit zero, one, or many of them, in any order, before the terminal event.

#### `{ type: "session", id }`

The adapter has observed the tool's `session_id` for this invocation and surfaces it to the runner. The runner captures it for later reuse per [src/ai/.spec/rules/retry.md#retries-reuse-the-interrupted-calls-session_id](/src/ai/.spec/rules/retry.md#retries-reuse-the-interrupted-calls-session_id) (within-call retry continuity) and per [src/commands/.spec/rules/ai/task-context.md#the-worker-resumes-its-captured-session_id-across-iterations-of-the-same-task](/src/commands/.spec/rules/ai/task-context.md#the-worker-resumes-its-captured-session_id-across-iterations-of-the-same-task) (cross-iteration worker continuity). Field shape:

- `id` — the opaque session identifier string the tool exposed. Never empty.

`session` events are non-terminal. A single invocation emits zero or one `session` event total — once the id is captured, subsequent appearances of the same id by the tool are silently absorbed by the adapter and not re-emitted.

#### `{ type: "error", retryable, message }`

The invocation failed. Field shape:

- `retryable` — boolean. `true` means the runner must retry per [src/ai/.spec/rules/retry.md#the-runner-retries-retryable-errors-and-rate-limits-via-the-tool-interface-events](/src/ai/.spec/rules/retry.md#the-runner-retries-retryable-errors-and-rate-limits-via-the-tool-interface-events) and [src/ai/.spec/rules/retry.md#transient-retries-use-exponential-backoff-capped-at-one-minute](/src/ai/.spec/rules/retry.md#transient-retries-use-exponential-backoff-capped-at-one-minute). `false` means the failure propagates to the caller as a non-retryable error.
- `message` — short, human-readable reason. Used for surfacing to the user (UI region) and for logging to `error.log`. The runner never inspects `message` to decide retryability — the `retryable` boolean is authoritative.

`error` is a terminal event: when an adapter emits an `error`, the invocation has ended and no further events follow. The iterable closes after the `error` event has been yielded.

The decision of whether a given failure is retryable lives entirely in the adapter. The runner does not second-guess it. Adapters classify their tool's native error surface into retryable / non-retryable according to the rule that pins each tool's adapter (see [src/ai/.spec/rules/runner.md#the-claude-adapter-spawns-claude---print---output-format-stream-json-and-maps-its-events-to-the-tool-interface](/src/ai/.spec/rules/runner.md#the-claude-adapter-spawns-claude---print---output-format-stream-json-and-maps-its-events-to-the-tool-interface), [src/ai/.spec/rules/runner.md#the-codex-adapter-spawns-codex-exec---json-and-maps-its-events-to-the-tool-interface](/src/ai/.spec/rules/runner.md#the-codex-adapter-spawns-codex-exec---json-and-maps-its-events-to-the-tool-interface)).

#### `{ type: "rate_limit", waitUntilMs }`

The invocation hit a rate-limit signalled by the tool. Field shape:

- `waitUntilMs` — Unix timestamp in milliseconds: the wall-clock instant the runner waits until before re-invoking. It is the tool's authoritative reset instant when the tool's signal carries one; when the tool signals a rate-limit or quota/credit exhaustion without an end time, it is an estimate the adapter synthesizes for that signal. Either way the runner waits until this point per [src/ai/.spec/rules/retry.md#long-waits-run-as-a-loop-of-bounded-chunks](/src/ai/.spec/rules/retry.md#long-waits-run-as-a-loop-of-bounded-chunks) (chunking the wait when it exceeds an hour) and then re-invokes the same adapter with the same arguments.

`rate_limit` is a terminal event: when an adapter emits it, the invocation has ended.

`waitUntilMs` is always in the future relative to the moment the event is emitted. How an adapter derives it — reading the tool's reset field, or synthesizing an estimate when the tool reports a rate-limit without an end time — is pinned by that adapter's own rule (see [src/ai/.spec/rules/runner.md#the-claude-adapter-spawns-claude---print---output-format-stream-json-and-maps-its-events-to-the-tool-interface](/src/ai/.spec/rules/runner.md#the-claude-adapter-spawns-claude---print---output-format-stream-json-and-maps-its-events-to-the-tool-interface), [src/ai/.spec/rules/runner.md#the-codex-adapter-spawns-codex-exec---json-and-maps-its-events-to-the-tool-interface](/src/ai/.spec/rules/runner.md#the-codex-adapter-spawns-codex-exec---json-and-maps-its-events-to-the-tool-interface)).

#### `{ type: "done" }`

The invocation finished successfully. No payload — success is conveyed by reaching this event without an `error` or `rate_limit` first.

`done` is a terminal event. The iterable closes after `done` has been yielded.

### Terminal event invariant

Every invocation produces exactly one terminal event: one of `error`, `rate_limit`, or `done`. The iterable closes after the terminal event yields. An adapter that closes the iterable without emitting a terminal event is in violation; the runner does not have to handle that case and may assume it never happens.

### Output channel discipline

Adapters do NOT write to `process.stdout` or `process.stderr` directly. Anything the user sees on the terminal comes through the runner, which routes `output` events to the UI region. Adapters that "let the binary's stdout pass through" defeat the structural guarantees the interface provides and break the UI's redraw / scroll-region invariants.

Spawned children may inherit a piped stdout/stderr that the adapter reads — that is allowed (and necessary) — but the adapter parses what the child emits and turns it into events, never relays it untranslated to the user's terminal.

### Why this interface specifically

- The five event types map directly to the five concerns the runner has: display the tool's work (`output`), capture session continuity (`session`), decide retry vs propagate (`error`), schedule an authoritative wait (`rate_limit`), and end the call (`done`).
- The interface contains no tool-specific fields. The runner branches on `type`, never on which adapter produced the event.
- Errors and rate-limits are first-class events, not out-of-band exceptions. The runner has a single event loop, not an event loop plus a separate error channel plus a signal handler.
- The shape forces adapters to do the work the runner does not want to do (parsing the tool's native event stream, classifying errors, extracting rate-limit durations). The runner stays thin.

### Failure signals

- The runner branches on which tool is configured (`if (tool === "claude") ...`) to decide retry behavior, format output, capture session, or schedule waits. The interface is the only contract; per-tool branches inside the runner mean the abstraction leaked.
- An adapter writes directly to `process.stdout` or `process.stderr` instead of emitting `output` events.
- An adapter emits more than one terminal event per invocation, or emits a non-terminal event after the terminal one.
- An adapter emits more than one `session` event per invocation with distinct ids (the tool changed its session id mid-call — the adapter must surface only the latest captured id once, not narrate the change).
- An adapter emits a `rate_limit` event with a `waitUntilMs` in the past, defeating the long-wait timer.
- An adapter emits an `error` whose `retryable` field is decided by re-parsing the `message` from outside the adapter — `retryable` must reflect the adapter's own classification, not the runner's or any caller's.
- An adapter ignores `abortSignal` and continues consuming the child's output (or leaks the child process) after the runner has cancelled.
- A new adapter is added that introduces a new event variant beyond the five listed here, instead of mapping its tool's native events onto the existing five.

## The detect agent inherits tool, model and effort from the worker

The build/test detection agent spawned by `implement` at workspace setup time (see [.spec/contracts/cli-commands/implement/workspace.md](/.spec/contracts/cli-commands/implement/workspace.md)) is not separately configured in `.flanders/config.json`. It runs through the AI runner with the same `tool`, `model`, and `effort` the runner uses for the worker.

### Who this applies to

- **Subject:** the workspace-setup code path in `implement` that spawns the detect agent.
- **Not subject:** the AI runner itself. The runner receives tool/model/effort as arguments and does not know the call is a detect call.

### Behavior

When the workspace setup spawns the detect agent:

1. The orchestrator reads `.flanders/config.json` per [src/workspace/.spec/rules/flanders-config/file-format.md](/src/workspace/.spec/rules/flanders-config/file-format.md).
2. It takes the `worker.tool`, `worker.model`, and `worker.effort` values verbatim and passes them to the AI runner along with the detect prompt and the two target script paths (`build.bat`/`test.bat` on Windows, `build.sh`/`test.sh` elsewhere).
3. The runner invokes the resulting tool with that model and effort, per [src/ai/.spec/rules/runner.md#the-claude-adapter-spawns-claude---print---output-format-stream-json-and-maps-its-events-to-the-tool-interface](/src/ai/.spec/rules/runner.md#the-claude-adapter-spawns-claude---print---output-format-stream-json-and-maps-its-events-to-the-tool-interface) or [src/ai/.spec/rules/runner.md#the-codex-adapter-spawns-codex-exec---json-and-maps-its-events-to-the-tool-interface](/src/ai/.spec/rules/runner.md#the-codex-adapter-spawns-codex-exec---json-and-maps-its-events-to-the-tool-interface).

The orchestrator does not consult `reviewer.*` for the detect agent, and does not invent a third "detect" set of fields.

### Why inherit from worker

- The detect agent writes scripts in the project's working tree — same shape of write as the worker. Inheriting the worker's `tool`/`model`/`effort` keeps the detect quality coherent with the implementation quality.
- Adding a separate set of fields just for detect would expand `.flanders/config.json` to satisfy a role that runs once per `implement` run and never gets adversarially reviewed.

### Failure signals

- The orchestrator passes the reviewer's tool/model/effort (or any mix) to the detect agent.
- The orchestrator hardcodes a tool/model/effort for the detect agent instead of reading the worker's values from `.flanders/config.json`.
- The orchestrator introduces a `detect.*` section in `.flanders/config.json` and consumes it.
- The orchestrator bypasses the AI runner to spawn the detect agent directly.

## Every AI adapter invokes its tool non-interactively

A Flanders AI invocation runs a single turn to completion with no human in the loop. Each per-tool adapter must drive its binary in a mode where the tool never pauses mid-turn to obtain a tool-use approval, never requests a permission, and never raises a question to the user. The adapter holds no live input channel through which the tool could solicit input: after delivering the prompt it closes the binary's input stream so the turn terminates on its own, and it neither writes a control or approval response back to the tool nor forwards any question the tool could raise to the user.

### Who this applies to

- **Subject:** every per-tool adapter — today the Claude adapter ([src/ai/.spec/rules/runner.md#the-claude-adapter-spawns-claude---print---output-format-stream-json-and-maps-its-events-to-the-tool-interface](/src/ai/.spec/rules/runner.md#the-claude-adapter-spawns-claude---print---output-format-stream-json-and-maps-its-events-to-the-tool-interface)) and the Codex adapter ([src/ai/.spec/rules/runner.md#the-codex-adapter-spawns-codex-exec---json-and-maps-its-events-to-the-tool-interface](/src/ai/.spec/rules/runner.md#the-codex-adapter-spawns-codex-exec---json-and-maps-its-events-to-the-tool-interface)), and any adapter added later. Each adapter realizes this obligation through the specific flags and input handling of its own binary, pinned in that adapter's rule.
- **Not subject:** the AI runner and the runner's call sites (worker stage, reviewer stage, detect-agent), which never touch a tool's invocation surface directly.

The user-visible consequence of this rule — that an implement run never pauses for the AI to ask the user anything — is stated in [.spec/contracts/cli-commands/implement/non-interactive.md](/.spec/contracts/cli-commands/implement/non-interactive.md).

## Every AI adapter grants its tool the maximum access its CLI offers

A Flanders AI invocation runs the configured tool in the most permissive access mode its CLI exposes, so the tool can read, write, and execute freely across the project's working tree and reach the resources it needs to complete the task, with no access gate narrowing or denying an operation mid-turn. Each per-tool adapter passes the flag(s) that put its binary in that mode. Flanders runs the worker in the project's own working tree because that tree is the artefact `implement` is producing; the access the adapter grants is full access to that tree, not confinement to a narrower sandbox or to an allow-list of operations.

This obligation is distinct from non-interactivity (see [src/ai/.spec/rules/runner.md#every-ai-adapter-invokes-its-tool-non-interactively](/src/ai/.spec/rules/runner.md#every-ai-adapter-invokes-its-tool-non-interactively)): non-interactivity removes the human-in-the-loop pause, while maximum access removes the gate that would otherwise restrict what the tool may do once it is running. An adapter that is non-interactive but access-restricted lets an operation the task needs be silently denied instead of running it; granting maximum access is what lets every such operation run to completion.

### Who this applies to

- **Subject:** every per-tool adapter — today the Claude adapter (see [src/ai/.spec/rules/runner.md#the-claude-adapter-spawns-claude---print---output-format-stream-json-and-maps-its-events-to-the-tool-interface](/src/ai/.spec/rules/runner.md#the-claude-adapter-spawns-claude---print---output-format-stream-json-and-maps-its-events-to-the-tool-interface)) and the Codex adapter (see [src/ai/.spec/rules/runner.md#the-codex-adapter-spawns-codex-exec---json-and-maps-its-events-to-the-tool-interface](/src/ai/.spec/rules/runner.md#the-codex-adapter-spawns-codex-exec---json-and-maps-its-events-to-the-tool-interface)), and any adapter added later. Each adapter realizes this obligation through the specific access flag(s) of its own binary, pinned in that adapter's rule.
- **Not subject:** the AI runner and the runner's call sites (worker stage, reviewer stage, detect agent), which never touch a tool's invocation surface directly.

## The Claude adapter spawns `claude --print --output-format stream-json` and maps its events to the tool interface

The Claude adapter is the per-tool implementation of the generic tool-adapter interface defined in [src/ai/.spec/rules/runner.md#all-ai-tools-implement-the-same-generic-tool-adapter-interface](/src/ai/.spec/rules/runner.md#all-ai-tools-implement-the-same-generic-tool-adapter-interface). It is the bridge between the `claude` binary's native `stream-json` event format and the runner's abstract `ToolEvent` stream. This rule pins both how the binary is invoked and how each native event is mapped to a `ToolEvent`.

### Who this applies to

- **Subject:** the Claude adapter module.
- **Not subject:** the AI runner. The runner only consumes the events the adapter emits; it does not know about Claude's native event format.

### Invocation

The adapter spawns `claude` with at least the following arguments:

- `--print` — non-interactive single-turn mode.
- `--output-format stream-json` — line-delimited structured events on stdout.
- `--input-format stream-json` — the input is itself a stream-json message sequence, with the prompt embedded in the first user message.
- `--verbose` — required by Claude Code when `--output-format stream-json` is in use; the additional event types do not affect mapping because the adapter keys event interpretation off `type` plus payload fields.
- `--dangerously-skip-permissions` — puts Claude in its most permissive access mode, realizing [src/ai/.spec/rules/runner.md#every-ai-adapter-grants-its-tool-the-maximum-access-its-cli-offers](/src/ai/.spec/rules/runner.md#every-ai-adapter-grants-its-tool-the-maximum-access-its-cli-offers): every tool use runs without a permission gate.

Per [src/ai/.spec/rules/runner.md#every-ai-adapter-invokes-its-tool-non-interactively](/src/ai/.spec/rules/runner.md#every-ai-adapter-invokes-its-tool-non-interactively), the invocation is non-interactive. The Claude adapter realizes this by not passing `--permission-prompt-tool=stdio` or any other flag that opens an approval or interactive-prompt channel; `--dangerously-skip-permissions` opens no such channel — it suppresses permission prompts rather than soliciting input — so it is consistent with the non-interactive invocation.

The prompt is delivered as a single user message inside the input stream-json on stdin. The adapter closes stdin immediately after writing that message, so Claude knows the single turn has ended and the process terminates on its own once the turn completes; the adapter never keeps stdin open after the prompt, since an open stdin would leave the turn unterminated.

When the configured `model` is non-empty, the adapter appends `--model <model>`. When it is the empty string, the flag is not passed and the Claude default applies.

When the configured `effort` is non-empty, the adapter appends `--effort <effort>` — the Claude Code flag that sets the reasoning-effort level for the launched session — passing the configured value verbatim. When it is the empty string, the flag is not passed and the Claude default applies.

When `resumeSessionId` is supplied, the adapter appends `--resume <resumeSessionId>`. When it is unset, no resume flag is passed and the invocation starts fresh.

### Native event format

Claude's `stream-json` output is a sequence of newline-delimited JSON objects. The adapter parses each line and routes the object based on its top-level `type`. The relevant event types and their mapping are listed below; every native event Claude emits is either mapped or filtered as documented here.

### Mapping to `ToolEvent`

#### `output` events

| Native shape | Emitted `ToolEvent` |
|---|---|
| `assistant` message with `tool_use` content block | `{ type: "output", title: <tool_use.name>, subtitle: <one-line summary of tool_use.input>, details: "" }` |
| `assistant` message with text content block | `{ type: "output", title: "Assistant", subtitle: "", details: <text> }` |
| `assistant` message with thinking content block | `{ type: "output", title: "Thinking", subtitle: "", details: <thinking text> }` |
| `user` message with `tool_result` content block | `{ type: "output", title: "Result", subtitle: <one-line summary of result>, details: <full result text> }` |
| `system` event other than the initial one | filtered (not emitted) |

The "one-line summary" of a tool's input or result is built by taking the most identifying field (for example, `file_path` for `Read`/`Edit`, `command` for `Bash`, `pattern` for `Grep`) and truncating it to a single line. When no obvious identifying field exists, the subtitle is the empty string.

#### `session` event

The Claude `session_id` appears on the initial `system` event (and is repeated on the terminal `result` event). The adapter emits `{ type: "session", id: <session_id> }` the first time it observes a non-empty `session_id`. Subsequent appearances of the same id are silently absorbed and not re-emitted. If Claude ever emits a `session_id` that differs from the previously captured one within the same invocation, the adapter treats the new id as authoritative and emits a single new `session` event with it.

#### Terminal events from the `result` event

Every Claude invocation ends with exactly one `result` event. The adapter maps it as follows:

**When `result.is_error === false`** — emit `{ type: "done" }`.

**When `result.is_error === true`** — the adapter consults `api_error_status` and `subtype`:

- `api_error_status === 429` — the adapter parses the rate-limit signal Claude emitted (on the same `result` event or on an adjacent rate-limit field) for an authoritative window-end timestamp. If a timestamp is parseable, emit `{ type: "rate_limit", waitUntilMs: <window-end> }`. If no timestamp is parseable, emit `{ type: "error", retryable: true, message: <result.error.message> }` so the runner falls back to the transient backoff.
- `api_error_status` is a 5xx number — emit `{ type: "error", retryable: true, message: <result.error.message> }`.
- `api_error_status === 408` or `api_error_status === 425` — emit `{ type: "error", retryable: true, message: <result.error.message> }`.
- `api_error_status === null` (transport error / no HTTP response) — emit `{ type: "error", retryable: true, message: <result.error.message> }`.
- `subtype === "error_during_execution"` — emit `{ type: "error", retryable: true, message: <result.error.message> }`.
- `subtype === "error_max_turns"` — emit `{ type: "error", retryable: false, message: <result.error.message> }`.
- `subtype === "error_max_budget_usd"` — emit `{ type: "error", retryable: false, message: <result.error.message> }`.
- `subtype === "error_max_structured_output_retries"` — emit `{ type: "error", retryable: false, message: <result.error.message> }`.
- Any other shape — emit `{ type: "error", retryable: false, message: <result.error.message> }`. Unknown shapes default to non-retryable so an unrecognized failure mode does not silently mask a bug.

The adapter never inspects `stderr` or the prompt text to decide retryability; the structured `result` event is authoritative.

#### Control-protocol events

Per [src/ai/.spec/rules/runner.md#every-ai-adapter-invokes-its-tool-non-interactively](/src/ai/.spec/rules/runner.md#every-ai-adapter-invokes-its-tool-non-interactively), the adapter neither solicits nor processes Claude's control-protocol traffic. Claude's permission requests, tool-use approval prompts, and any interactive question it could raise are out of scope: the adapter does not write a control response on stdin and does not forward any question to the user. The five `ToolEvent` variants of [src/ai/.spec/rules/runner.md#all-ai-tools-implement-the-same-generic-tool-adapter-interface](/src/ai/.spec/rules/runner.md#all-ai-tools-implement-the-same-generic-tool-adapter-interface) are the entire surface the adapter produces; soliciting user input is not among them.

### Cancellation

When `abortSignal` triggers, the adapter sends `SIGINT` to the spawned `claude` process, stops consuming the stream, awaits the child's termination, and ends the iterable. The child must not outlive the adapter call — leaking the spawned process is a violation regardless of how the cancellation came in.

### Failure signals

- The adapter spawns `claude` without `--print` or without `--output-format stream-json`, polluting the parser with TUI escapes or with a non-streaming payload.
- The adapter inlines the prompt as an argv argument instead of streaming it through stdin.
- The adapter passes `--permission-prompt-tool=stdio` or any other flag that opens an approval or interactive-prompt channel, turning a non-interactive call into one that can pause for input.
- The adapter drops `--dangerously-skip-permissions`, so Claude's tool uses are gated or denied instead of running with the full access the maximum-access rule requires.
- The adapter keeps stdin open after writing the prompt — for example to hold a control channel — so the turn never ends and the spawned `claude` process never exits.
- The adapter processes a `control_request` / permission event, writes a `control_response` on stdin, or forwards a question to the user, instead of running the turn to completion without human interaction.
- The adapter passes `--model ""` (empty string) instead of omitting the flag when the configured model is empty. Likewise for `--effort`.
- The adapter drops a non-empty configured effort, or logs it as unsupported, instead of appending `--effort <effort>`.
- The adapter writes Claude's native output to the user's terminal directly, instead of emitting `output` events and letting the runner forward them.
- The adapter classifies the retryable / non-retryable decision by parsing `result.error.message` text instead of the structured `is_error` / `api_error_status` / `subtype` fields.
- The adapter emits a `rate_limit` event without an authoritative `waitUntilMs` parsed from Claude's signal, instead of falling back to a retryable `error`.
- The adapter leaks the spawned `claude` process on cancellation.
- A call site spawns `claude` directly, bypassing the adapter.

## The Codex adapter spawns `codex exec --json` and maps its events to the tool interface

The Codex adapter is the per-tool implementation of the generic tool-adapter interface defined in [src/ai/.spec/rules/runner.md#all-ai-tools-implement-the-same-generic-tool-adapter-interface](/src/ai/.spec/rules/runner.md#all-ai-tools-implement-the-same-generic-tool-adapter-interface). It is the bridge between the OpenAI Codex CLI's native event stream and the runner's abstract `ToolEvent` stream. This rule pins both how the binary is invoked and how each native event is mapped to a `ToolEvent`.

### Who this applies to

- **Subject:** the Codex adapter module.
- **Not subject:** the AI runner. The runner only consumes the events the adapter emits; it does not know about Codex's native event format.

### Invocation

The adapter spawns `codex` with at least the following arguments:

- `exec` — the non-interactive subcommand.
- `--json` — newline-delimited JSON events on stdout (one per state change).
- `-c approval_policy=never` — disable approval prompts, realizing the non-interactive invocation required by [src/ai/.spec/rules/runner.md#every-ai-adapter-invokes-its-tool-non-interactively](/src/ai/.spec/rules/runner.md#every-ai-adapter-invokes-its-tool-non-interactively).
- `-c sandbox_mode=danger-full-access` — puts Codex in its most permissive access mode, realizing [src/ai/.spec/rules/runner.md#every-ai-adapter-grants-its-tool-the-maximum-access-its-cli-offers](/src/ai/.spec/rules/runner.md#every-ai-adapter-grants-its-tool-the-maximum-access-its-cli-offers); the sandbox is the working tree itself, not a surrounding host.
- A trailing `-` argument indicating the prompt is to be read from stdin.

The prompt is then written to the spawned process's stdin and the stdin is closed.

When the configured `model` is non-empty, the adapter appends `-m <model>`. When it is the empty string, the flag is not passed.

When the configured `effort` is non-empty, the adapter appends `-c model_reasoning_effort=<effort>`. Values follow what Codex documents at the time of the run (today: `minimal`, `low`, `medium`, `high`, `xhigh`). When the configured `effort` is the empty string, the override is not passed.

When `resumeSessionId` is supplied, the adapter switches the subcommand from `exec` to `codex resume <resumeSessionId>`, applying the same non-interactive overrides (`-c approval_policy=never`, `-c sandbox_mode=danger-full-access`, `--json`).

When the Codex CLI on the host does not support `codex resume` (older version), the adapter falls back to a fresh `codex exec` rather than silently changing semantics. The fallback is surfaced through an `output` event so the user can see that continuity was lost; it does not change the retryability of the call.

`-c` overrides are repeatable. The adapter emits one `-c key=value` per override and never collapses multiple overrides into a single string.

### Native event format

The Codex CLI's `exec --json` output is a sequence of newline-delimited JSON events from the `ThreadEvent` family exposed by the Codex TypeScript SDK. The adapter parses each line and routes the object based on its top-level `type`. The event types it acts on are:

- `thread.started` — carries the run's `thread_id` string. This is the session identifier the adapter surfaces and the value reused for `codex resume`.
- `turn.started` — turn boundary marker; filtered.
- `item.started` — an item that is still in progress (its `status` is `in_progress`); filtered. Only `item.completed` items map to output.
- `item.completed` — carries a completed `item`; the item's own `type` drives the output mapping below.
- `turn.completed` — carries a `usage` object and marks the end of the turn (see Token usage and the terminal-event rules below).
- `error` — carries a `message` string (see the error classification below).
- `turn.failed` — carries a nested `error` object whose `message` string describes the failure (see the error classification below). When a turn fails, Codex emits a top-level `error` event and then a `turn.failed` event, in that order, both carrying the same text.

Every native event Codex emits is either mapped or filtered as documented here. Any `type` not listed above is filtered.

### Mapping to `ToolEvent`

#### `output` events

The adapter inspects each `item.completed` event's `item.type` and maps it as follows:

| `item.type` | Emitted `ToolEvent` |
|---|---|
| `agent_message` | `{ type: "output", title: "Assistant", subtitle: "", details: <item.text> }` |
| `command_execution` | `{ type: "output", title: "command", subtitle: <one-line summary of item.command>, details: <item.aggregated_output> }` |
| `reasoning` | `{ type: "output", title: "Thinking", subtitle: "", details: <reasoning text> }` |
| any other `item.type` | filtered |

The assistant text is the flat `item.text` string on the `agent_message` item; the adapter does not look for a `content` array of role-tagged blocks. A `command_execution` item carries the executed `command`, its `aggregated_output`, an `exit_code`, and a `status`; the adapter renders `aggregated_output` as the details and never relays it to the terminal directly.

The "one-line summary" of a `command_execution` is built by taking its `command` string and truncating it to a single line. When the field is absent or empty, the subtitle is the empty string.

#### `session` event

The session id is the `thread_id` string carried by the `thread.started` event. The adapter emits `{ type: "session", id: <thread_id> }` the first time it observes a non-empty `thread_id`. Subsequent appearances of the same id are silently absorbed. A new id within the same invocation is treated as authoritative and emits a single new `session` event with it.

#### Token usage

The `turn.completed` event carries a `usage` object with the integer fields `input_tokens`, `cached_input_tokens`, `output_tokens`, and `reasoning_output_tokens`. The adapter reports the invocation's token usage to the runner as `inputTokens = input_tokens` and `outputTokens = output_tokens`. `cached_input_tokens` and `reasoning_output_tokens` are informational sub-counts already contained within `input_tokens` and `output_tokens` respectively; the adapter does not add them to the totals, so no token is counted twice.

#### Terminal events from failure events and process exit

Codex's failure surface in the `exec --json` stream is two events that each carry a human-readable message and no other structured field: the top-level `{ type: "error", message: string }` and the `{ type: "turn.failed", error: { message: string } }` that follows it. When a turn fails, Codex emits both, in that order, carrying the same text. Unlike Claude, Codex exposes in this stream neither an HTTP status, nor a retry-after, nor a reset timestamp, nor a discrete error code — the structured `rate_limits` snapshot and the `codex_error_info` code that Codex records in its on-disk session rollout do not appear in the `exec --json` stdout stream. The adapter therefore classifies the failure from the message text alone, plus the surrounding process state.

The adapter acts on whichever of the two failure events arrives first, emits exactly one terminal `ToolEvent` for it, and absorbs the duplicate that follows — preserving the single-terminal-event invariant of [src/ai/.spec/rules/runner.md#all-ai-tools-implement-the-same-generic-tool-adapter-interface](/src/ai/.spec/rules/runner.md#all-ai-tools-implement-the-same-generic-tool-adapter-interface). The message it classifies is the `message` field for a `type: "error"` event and the nested `error.message` field for a `type: "turn.failed"` event.

**Classification of a failure message** — the adapter inspects the trimmed message (case-insensitive, literal substring search):

- Message contains any of: `out of credits`, `refill`, `usage limit`, `rate limit`, `rate-limit`, `rate_limit`, `quota`, `too many requests`, or the standalone token `429` — this is a rate-limit or a quota/credit exhaustion. The `exec --json` stream carries no reset time for it, so the adapter synthesizes one: it emits `{ type: "rate_limit", waitUntilMs: <now> + R }`, where `R` is a duration drawn uniformly at random from the closed interval of 8 minutes to 12 minutes. Both the current time and the random draw are obtained through the injected contexts per [src/.spec/rules/external-access-through-contexts.md](/src/.spec/rules/external-access-through-contexts.md); the adapter never calls `Date.now()` or `Math.random()` directly.
- Message contains any three-digit `5xx` token (`500`..`599`) — emit `{ type: "error", retryable: true, message }`.
- Message contains the three-digit tokens `408` or `425` — emit `{ type: "error", retryable: true, message }`.
- Message contains any of: `timeout`, `timed out`, `connection reset`, `connection refused`, `socket hang up`, `temporarily unavailable`, `service unavailable`, `gateway`, `network`, `ECONNRESET`, `ECONNREFUSED`, `ENOTFOUND`, `ETIMEDOUT`, `EAI_AGAIN` — emit `{ type: "error", retryable: true, message }`.
- Anything else — emit `{ type: "error", retryable: false, message }`. Unrecognized error shapes default to non-retryable so unknown failure modes do not silently mask a bug.

**When the child process exits without having emitted a failure event (`type: "error"` or `type: "turn.failed"`) and without having emitted `type: "turn.completed"`** — the adapter treats the failure as a transport-level retryable error and emits `{ type: "error", retryable: true, message: <synthesized message describing the unexpected exit> }`.

**When the child process exits via a signal** — same treatment: emit `{ type: "error", retryable: true, message: <synthesized message naming the signal> }`.

**When `type: "turn.completed"` is emitted and the child then exits with status 0** — emit `{ type: "done" }`.

The adapter never inspects `stderr` or the prompt text to decide retryability; the structured event stream plus the exit shape are authoritative.

#### Why substring matching on the message

Codex's `exec --json` failure events expose only a `message` string — `message` on the `error` event, `error.message` on the `turn.failed` event. The adapter cannot inspect a structured HTTP status, a subtype, a retry-after, a reset timestamp, or an error code because the stdout stream does not surface them. Substring matching on the message text is the only surface the stream leaves to consumers; the patterns above are the closed set the adapter recognizes. Adding a new recognized substring requires updating this rule first; silently expanding the matcher is a violation.

The matching is literal substring search, case-insensitive, on the trimmed message. The adapter does NOT use a natural-language classifier and does not infer "nearby" variants.

### Cancellation

When `abortSignal` triggers, the adapter sends `SIGINT` to the spawned `codex` process, stops consuming the stream, awaits the child's termination, and ends the iterable. The child must not outlive the adapter call.

### Failure signals

- The adapter uses an interactive subcommand (`codex` without `exec`) or drops `--json`, polluting the parser with TUI escapes or with non-streaming output.
- The adapter inlines the prompt as the `codex exec "<prompt>"` argument instead of streaming through stdin, exposing the prompt to argv length limits and to shell-quoting bugs.
- The adapter drops `-c approval_policy=never` or `-c sandbox_mode=danger-full-access`, allowing Codex to pause for approval or to refuse access to the working tree.
- The adapter passes `-m ""` or `-c model_reasoning_effort=` with an empty value, instead of omitting the flag.
- The adapter collapses multiple `-c` overrides into a single string or reuses the same `-c` for multiple keys.
- The adapter retries on a message whose text does not contain any of the explicit retryable substrings above and whose process did not exit by signal or unexpectedly mid-turn.
- The adapter writes Codex's native output to the user's terminal directly, instead of emitting `output` events.
- The adapter reads the session id from a field other than `thread.started`'s `thread_id`, so no `session` event is emitted and continuity (resume) is lost.
- The adapter looks for the assistant text in a `content` array of role-tagged blocks instead of the flat `item.text` on the `agent_message` item, capturing nothing.
- The adapter emits an `output` event for an `item.started` event instead of filtering it and emitting only on `item.completed`.
- The adapter ignores the `usage` object on `turn.completed` and reports no token usage to the runner, so the displayed token figures stay at zero.
- The adapter adds `cached_input_tokens` to `input_tokens` or `reasoning_output_tokens` to `output_tokens`, double-counting the sub-totals into the reported figures.
- The adapter adds a new recognized substring to its matcher without adding it to this rule first.
- The adapter classifies a rate-limit or quota/credit-exhaustion message (for example `out of credits` or `usage limit`) as a non-retryable `error` because that message was not in the recognized substring set.
- The adapter emits the rate-limit `rate_limit` event with a `waitUntilMs` whose wait falls outside the 8-to-12-minute interval, or computed by calling `Date.now()` / `Math.random()` directly instead of through the injected contexts.
- The adapter ignores the `turn.failed` event and classifies only `type: "error"`, so a failure surfaced through `turn.failed` is dropped.
- The adapter emits two terminal events when Codex emits both `error` and `turn.failed` for the same failure, instead of acting on the first and absorbing the second.
- The adapter leaks the spawned `codex` process on cancellation.
- A call site spawns `codex` directly, bypassing the adapter.
