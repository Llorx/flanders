# The Claude adapter spawns `claude --print --output-format stream-json` and maps its events to the tool interface

The Claude adapter is the per-tool implementation of the generic tool-adapter interface defined in `src/ai/.docs/rules/runner/tool-interface.md`. It is the bridge between the `claude` binary's native `stream-json` event format and the runner's abstract `ToolEvent` stream. This rule pins both how the binary is invoked and how each native event is mapped to a `ToolEvent`.

## Who this applies to

- **Subject:** the Claude adapter module.
- **Not subject:** the AI runner. The runner only consumes the events the adapter emits; it does not know about Claude's native event format.

## Invocation

The adapter spawns `claude` with at least the following arguments:

- `--print` — non-interactive single-turn mode.
- `--output-format stream-json` — line-delimited structured events on stdout.
- `--input-format stream-json` — the input is itself a stream-json message sequence, with the prompt embedded in the first user message.
- `--verbose` — required by Claude Code when `--output-format stream-json` is in use; the additional event types do not affect mapping because the adapter keys event interpretation off `type` plus payload fields.

Per `src/ai/.docs/rules/runner/non-interactive-invocation.md`, the invocation is non-interactive. The Claude adapter realizes this by not passing `--permission-prompt-tool=stdio` or any other approval, permission, or interactive-prompt flag.

The prompt is delivered as a single user message inside the input stream-json on stdin. The adapter closes stdin immediately after writing that message, so Claude knows the single turn has ended and the process terminates on its own once the turn completes; the adapter never keeps stdin open after the prompt, since an open stdin would leave the turn unterminated.

When the configured `model` is non-empty, the adapter appends `--model <model>`. When it is the empty string, the flag is not passed and the Claude default applies.

When the configured `effort` is non-empty, the adapter appends `--effort <effort>` — the Claude Code flag that sets the reasoning-effort level for the launched session — passing the configured value verbatim. When it is the empty string, the flag is not passed and the Claude default applies.

When `resumeSessionId` is supplied, the adapter appends `--resume <resumeSessionId>`. When `forkParentSessionId` is supplied, the adapter uses the Claude flag that forks a session from the given parent. The two flags are mutually exclusive at the interface level (see `src/ai/.docs/rules/runner/tool-interface.md`); the adapter does not emit both.

## Native event format

Claude's `stream-json` output is a sequence of newline-delimited JSON objects. The adapter parses each line and routes the object based on its top-level `type`. The relevant event types and their mapping are listed below; every native event Claude emits is either mapped or filtered as documented here.

## Mapping to `ToolEvent`

### `output` events

| Native shape | Emitted `ToolEvent` |
|---|---|
| `assistant` message with `tool_use` content block | `{ type: "output", title: <tool_use.name>, subtitle: <one-line summary of tool_use.input>, details: "" }` |
| `assistant` message with text content block | `{ type: "output", title: "Assistant", subtitle: "", details: <text> }` |
| `assistant` message with thinking content block | `{ type: "output", title: "Thinking", subtitle: "", details: <thinking text> }` |
| `user` message with `tool_result` content block | `{ type: "output", title: "Result", subtitle: <one-line summary of result>, details: <full result text> }` |
| `system` event other than the initial one | filtered (not emitted) |

The "one-line summary" of a tool's input or result is built by taking the most identifying field (for example, `file_path` for `Read`/`Edit`, `command` for `Bash`, `pattern` for `Grep`) and truncating it to a single line. When no obvious identifying field exists, the subtitle is the empty string.

### `session` event

The Claude `session_id` appears on the initial `system` event (and is repeated on the terminal `result` event). The adapter emits `{ type: "session", id: <session_id> }` the first time it observes a non-empty `session_id`. Subsequent appearances of the same id are silently absorbed and not re-emitted. If Claude ever emits a `session_id` that differs from the previously captured one within the same invocation, the adapter treats the new id as authoritative and emits a single new `session` event with it.

### Terminal events from the `result` event

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

### Control-protocol events

Per `src/ai/.docs/rules/runner/non-interactive-invocation.md`, the adapter neither solicits nor processes Claude's control-protocol traffic. Claude's permission requests, tool-use approval prompts, and any interactive question it could raise are out of scope: the adapter does not write a control response on stdin and does not forward any question to the user. The five `ToolEvent` variants of `src/ai/.docs/rules/runner/tool-interface.md` are the entire surface the adapter produces; soliciting user input is not among them.

## Cancellation

When `abortSignal` triggers, the adapter sends `SIGINT` to the spawned `claude` process, stops consuming the stream, awaits the child's termination, and ends the iterable. The child must not outlive the adapter call — leaking the spawned process is a violation regardless of how the cancellation came in.

## Failure signals

- The adapter spawns `claude` without `--print` or without `--output-format stream-json`, polluting the parser with TUI escapes or with a non-streaming payload.
- The adapter inlines the prompt as an argv argument instead of streaming it through stdin.
- The adapter passes `--permission-prompt-tool=stdio` or any other approval, permission, or interactive-prompt flag, turning a non-interactive call into one that can pause for input.
- The adapter keeps stdin open after writing the prompt — for example to hold a control channel — so the turn never ends and the spawned `claude` process never exits.
- The adapter processes a `control_request` / permission event, writes a `control_response` on stdin, or forwards a question to the user, instead of running the turn to completion without human interaction.
- The adapter passes `--model ""` (empty string) instead of omitting the flag when the configured model is empty. Likewise for `--effort`.
- The adapter drops a non-empty configured effort, or logs it as unsupported, instead of appending `--effort <effort>`.
- The adapter writes Claude's native output to the user's terminal directly, instead of emitting `output` events and letting the runner forward them.
- The adapter classifies the retryable / non-retryable decision by parsing `result.error.message` text instead of the structured `is_error` / `api_error_status` / `subtype` fields.
- The adapter emits a `rate_limit` event without an authoritative `waitUntilMs` parsed from Claude's signal, instead of falling back to a retryable `error`.
- The adapter leaks the spawned `claude` process on cancellation.
- A call site spawns `claude` directly, bypassing the adapter.
