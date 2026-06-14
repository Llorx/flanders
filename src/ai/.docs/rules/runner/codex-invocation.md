# The Codex adapter spawns `codex exec --json` and maps its events to the tool interface

The Codex adapter is the per-tool implementation of the generic tool-adapter interface defined in [src/ai/.docs/rules/runner/tool-interface.md](/src/ai/.docs/rules/runner/tool-interface.md). It is the bridge between the OpenAI Codex CLI's native event stream and the runner's abstract `ToolEvent` stream. This rule pins both how the binary is invoked and how each native event is mapped to a `ToolEvent`.

## Who this applies to

- **Subject:** the Codex adapter module.
- **Not subject:** the AI runner. The runner only consumes the events the adapter emits; it does not know about Codex's native event format.

## Invocation

The adapter spawns `codex` with at least the following arguments:

- `exec` — the non-interactive subcommand.
- `--json` — newline-delimited JSON events on stdout (one per state change).
- `-c approval_policy=never` — disable approval prompts, realizing the non-interactive invocation required by [src/ai/.docs/rules/runner/non-interactive-invocation.md](/src/ai/.docs/rules/runner/non-interactive-invocation.md).
- `-c sandbox_mode=danger-full-access` — Flanders runs the worker in the project's own working tree because that is the artefact `implement` is producing; the sandbox is the working tree itself, not a surrounding host.
- A trailing `-` argument indicating the prompt is to be read from stdin.

The prompt is then written to the spawned process's stdin and the stdin is closed.

When the configured `model` is non-empty, the adapter appends `-m <model>`. When it is the empty string, the flag is not passed.

When the configured `effort` is non-empty, the adapter appends `-c model_reasoning_effort=<effort>`. Values follow what Codex documents at the time of the run (today: `minimal`, `low`, `medium`, `high`, `xhigh`). When the configured `effort` is the empty string, the override is not passed.

When `resumeSessionId` is supplied, the adapter switches the subcommand from `exec` to `codex resume <resumeSessionId>`, applying the same non-interactive overrides (`-c approval_policy=never`, `-c sandbox_mode=danger-full-access`, `--json`). When `forkParentSessionId` is supplied, the adapter uses `codex fork <forkParentSessionId>` with the same overrides. The two are mutually exclusive at the interface level; the adapter does not emit both.

When the Codex CLI on the host does not support `codex resume` or `codex fork` (older version), the adapter falls back to a fresh `codex exec` rather than silently changing semantics. The fallback is surfaced through an `output` event so the user can see that continuity was lost; it does not change the retryability of the call.

`-c` overrides are repeatable. The adapter emits one `-c key=value` per override and never collapses multiple overrides into a single string.

## Native event format

The Codex CLI's `exec --json` output is a sequence of newline-delimited JSON events from the `ThreadEvent` family exposed by the Codex TypeScript SDK. The adapter parses each line and routes the object based on its top-level `type`. The event types it acts on are:

- `thread.started` — carries the run's `thread_id` string. This is the session identifier the adapter surfaces and the value reused for `codex resume` / `codex fork`.
- `turn.started` — turn boundary marker; filtered.
- `item.started` — an item that is still in progress (its `status` is `in_progress`); filtered. Only `item.completed` items map to output.
- `item.completed` — carries a completed `item`; the item's own `type` drives the output mapping below.
- `turn.completed` — carries a `usage` object and marks the end of the turn (see Token usage and the terminal-event rules below).
- `error` — carries a `message` string (see the error classification below).
- `turn.failed` — carries a nested `error` object whose `message` string describes the failure (see the error classification below). When a turn fails, Codex emits a top-level `error` event and then a `turn.failed` event, in that order, both carrying the same text.

Every native event Codex emits is either mapped or filtered as documented here. Any `type` not listed above is filtered.

## Mapping to `ToolEvent`

### `output` events

The adapter inspects each `item.completed` event's `item.type` and maps it as follows:

| `item.type` | Emitted `ToolEvent` |
|---|---|
| `agent_message` | `{ type: "output", title: "Assistant", subtitle: "", details: <item.text> }` |
| `command_execution` | `{ type: "output", title: "command", subtitle: <one-line summary of item.command>, details: <item.aggregated_output> }` |
| `reasoning` | `{ type: "output", title: "Thinking", subtitle: "", details: <reasoning text> }` |
| any other `item.type` | filtered |

The assistant text is the flat `item.text` string on the `agent_message` item; the adapter does not look for a `content` array of role-tagged blocks. A `command_execution` item carries the executed `command`, its `aggregated_output`, an `exit_code`, and a `status`; the adapter renders `aggregated_output` as the details and never relays it to the terminal directly.

The "one-line summary" of a `command_execution` is built by taking its `command` string and truncating it to a single line. When the field is absent or empty, the subtitle is the empty string.

### `session` event

The session id is the `thread_id` string carried by the `thread.started` event. The adapter emits `{ type: "session", id: <thread_id> }` the first time it observes a non-empty `thread_id`. Subsequent appearances of the same id are silently absorbed. A new id within the same invocation is treated as authoritative and emits a single new `session` event with it.

### Token usage

The `turn.completed` event carries a `usage` object with the integer fields `input_tokens`, `cached_input_tokens`, `output_tokens`, and `reasoning_output_tokens`. The adapter reports the invocation's token usage to the runner as `inputTokens = input_tokens` and `outputTokens = output_tokens`. `cached_input_tokens` and `reasoning_output_tokens` are informational sub-counts already contained within `input_tokens` and `output_tokens` respectively; the adapter does not add them to the totals, so no token is counted twice.

### Terminal events from failure events and process exit

Codex's failure surface in the `exec --json` stream is two events that each carry a human-readable message and no other structured field: the top-level `{ type: "error", message: string }` and the `{ type: "turn.failed", error: { message: string } }` that follows it. When a turn fails, Codex emits both, in that order, carrying the same text. Unlike Claude, Codex exposes in this stream neither an HTTP status, nor a retry-after, nor a reset timestamp, nor a discrete error code — the structured `rate_limits` snapshot and the `codex_error_info` code that Codex records in its on-disk session rollout do not appear in the `exec --json` stdout stream. The adapter therefore classifies the failure from the message text alone, plus the surrounding process state.

The adapter acts on whichever of the two failure events arrives first, emits exactly one terminal `ToolEvent` for it, and absorbs the duplicate that follows — preserving the single-terminal-event invariant of [src/ai/.docs/rules/runner/tool-interface.md](/src/ai/.docs/rules/runner/tool-interface.md). The message it classifies is the `message` field for a `type: "error"` event and the nested `error.message` field for a `type: "turn.failed"` event.

**Classification of a failure message** — the adapter inspects the trimmed message (case-insensitive, literal substring search):

- Message contains any of: `out of credits`, `refill`, `usage limit`, `rate limit`, `rate-limit`, `rate_limit`, `quota`, `too many requests`, or the standalone token `429` — this is a rate-limit or a quota/credit exhaustion. The `exec --json` stream carries no reset time for it, so the adapter synthesizes one: it emits `{ type: "rate_limit", waitUntilMs: <now> + R }`, where `R` is a duration drawn uniformly at random from the closed interval of 8 minutes to 12 minutes. Both the current time and the random draw are obtained through the injected contexts per [src/.docs/rules/external-access-through-contexts.md](/src/.docs/rules/external-access-through-contexts.md); the adapter never calls `Date.now()` or `Math.random()` directly.
- Message contains any three-digit `5xx` token (`500`..`599`) — emit `{ type: "error", retryable: true, message }`.
- Message contains the three-digit tokens `408` or `425` — emit `{ type: "error", retryable: true, message }`.
- Message contains any of: `timeout`, `timed out`, `connection reset`, `connection refused`, `socket hang up`, `temporarily unavailable`, `service unavailable`, `gateway`, `network`, `ECONNRESET`, `ECONNREFUSED`, `ENOTFOUND`, `ETIMEDOUT`, `EAI_AGAIN` — emit `{ type: "error", retryable: true, message }`.
- Anything else — emit `{ type: "error", retryable: false, message }`. Unrecognized error shapes default to non-retryable so unknown failure modes do not silently mask a bug.

**When the child process exits without having emitted a failure event (`type: "error"` or `type: "turn.failed"`) and without having emitted `type: "turn.completed"`** — the adapter treats the failure as a transport-level retryable error and emits `{ type: "error", retryable: true, message: <synthesized message describing the unexpected exit> }`.

**When the child process exits via a signal** — same treatment: emit `{ type: "error", retryable: true, message: <synthesized message naming the signal> }`.

**When `type: "turn.completed"` is emitted and the child then exits with status 0** — emit `{ type: "done" }`.

The adapter never inspects `stderr` or the prompt text to decide retryability; the structured event stream plus the exit shape are authoritative.

### Why substring matching on the message

Codex's `exec --json` failure events expose only a `message` string — `message` on the `error` event, `error.message` on the `turn.failed` event. The adapter cannot inspect a structured HTTP status, a subtype, a retry-after, a reset timestamp, or an error code because the stdout stream does not surface them. Substring matching on the message text is the only surface the stream leaves to consumers; the patterns above are the closed set the adapter recognizes. Adding a new recognized substring requires updating this rule first; silently expanding the matcher is a violation.

The matching is literal substring search, case-insensitive, on the trimmed message. The adapter does NOT use a natural-language classifier and does not infer "nearby" variants.

## Cancellation

When `abortSignal` triggers, the adapter sends `SIGINT` to the spawned `codex` process, stops consuming the stream, awaits the child's termination, and ends the iterable. The child must not outlive the adapter call.

## Failure signals

- The adapter uses an interactive subcommand (`codex` without `exec`) or drops `--json`, polluting the parser with TUI escapes or with non-streaming output.
- The adapter inlines the prompt as the `codex exec "<prompt>"` argument instead of streaming through stdin, exposing the prompt to argv length limits and to shell-quoting bugs.
- The adapter drops `-c approval_policy=never` or `-c sandbox_mode=danger-full-access`, allowing Codex to pause for approval or to refuse access to the working tree.
- The adapter passes `-m ""` or `-c model_reasoning_effort=` with an empty value, instead of omitting the flag.
- The adapter collapses multiple `-c` overrides into a single string or reuses the same `-c` for multiple keys.
- The adapter retries on a message whose text does not contain any of the explicit retryable substrings above and whose process did not exit by signal or unexpectedly mid-turn.
- The adapter writes Codex's native output to the user's terminal directly, instead of emitting `output` events.
- The adapter reads the session id from a field other than `thread.started`'s `thread_id`, so no `session` event is emitted and continuity (resume / fork) is lost.
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
