# The Codex adapter spawns `codex exec --json` and maps its events to the tool interface

The Codex adapter is the per-tool implementation of the generic tool-adapter interface defined in `rules/ai/runner/tool-interface.md`. It is the bridge between the OpenAI Codex CLI's native event stream and the runner's abstract `ToolEvent` stream. This rule pins both how the binary is invoked and how each native event is mapped to a `ToolEvent`.

## Who this applies to

- **Subject:** the Codex adapter module.
- **Not subject:** the AI runner. The runner only consumes the events the adapter emits; it does not know about Codex's native event format.

## Invocation

The adapter spawns `codex` with at least the following arguments:

- `exec` — the non-interactive subcommand.
- `--json` — newline-delimited JSON events on stdout (one per state change).
- `-c approval_policy=never` — disable approval prompts; the adapter operates without a human in the loop.
- `-c sandbox_mode=danger-full-access` — Flanders runs the worker in the project's own working tree because that is the artefact `implement` is producing; the sandbox is the working tree itself, not a surrounding host.
- A trailing `-` argument indicating the prompt is to be read from stdin.

The prompt is then written to the spawned process's stdin and the stdin is closed.

When the configured `model` is non-empty, the adapter appends `-m <model>`. When it is the empty string, the flag is not passed.

When the configured `effort` is non-empty, the adapter appends `-c model_reasoning_effort=<effort>`. Values follow what Codex documents at the time of the run (today: `minimal`, `low`, `medium`, `high`, `xhigh`). When the configured `effort` is the empty string, the override is not passed.

When `resumeSessionId` is supplied, the adapter switches the subcommand from `exec` to `codex resume <resumeSessionId>`, applying the same non-interactive overrides (`-c approval_policy=never`, `-c sandbox_mode=danger-full-access`, `--json`). When `forkParentSessionId` is supplied, the adapter uses `codex fork <forkParentSessionId>` with the same overrides. The two are mutually exclusive at the interface level; the adapter does not emit both.

When the Codex CLI on the host does not support `codex resume` or `codex fork` (older version), the adapter falls back to a fresh `codex exec` rather than silently changing semantics. The fallback is surfaced through an `output` event so the user can see that continuity was lost; it does not change the retryability of the call.

`-c` overrides are repeatable. The adapter emits one `-c key=value` per override and never collapses multiple overrides into a single string.

## Native event format

The Codex CLI's `--json` output is a sequence of newline-delimited JSON events that mirror the `ThreadEvent` family exposed by the Codex TypeScript SDK. The adapter parses each line and routes the object based on its top-level `type`. The relevant event types and their mapping are listed below; every native event Codex emits is either mapped or filtered as documented here.

## Mapping to `ToolEvent`

### `output` events

| Native shape | Emitted `ToolEvent` |
|---|---|
| `type: "item.completed"` for an assistant text item | `{ type: "output", title: "Assistant", subtitle: "", details: <text> }` |
| `type: "item.completed"` for a tool-call item | `{ type: "output", title: <tool name>, subtitle: <one-line summary of tool arguments>, details: <tool output or empty> }` |
| `type: "item.completed"` for a reasoning item | `{ type: "output", title: "Thinking", subtitle: "", details: <reasoning text> }` |
| `type: "turn.completed"` | filtered (not emitted; only used as the terminal-event marker) |
| Any other `type` not listed | filtered |

The "one-line summary" of a tool call's arguments is built by taking the most identifying field of the arguments object (for example, `file` for read/write operations, `command` for shell commands, `pattern` for searches) and truncating it to a single line. When no obvious identifying field exists, the subtitle is the empty string.

### `session` event

Codex surfaces the session id either on the initial events emitted at the start of the run or as a field carried by other events. The adapter emits `{ type: "session", id: <session_id> }` the first time it observes a non-empty session id. Subsequent appearances of the same id are silently absorbed. A new id within the same invocation is treated as authoritative and emits a single new `session` event with it.

### Terminal events from `type: "error"` and process exit

Codex's structured error surface is the `ThreadErrorEvent`: `{ type: "error", message: string }`. Unlike Claude, Codex does not expose HTTP status, retry-after, or a discrete subtype as fields. The adapter classifies the failure from a combination of the `message` text and the surrounding process state:

**When `type: "error"` is emitted** — the adapter inspects `message` (case-insensitive, substring match on the trimmed text):

- Message contains any of: `rate limit`, `rate-limit`, `rate_limit`, `quota`, `too many requests`, or the standalone token `429` — this is a rate-limit. The adapter then attempts to parse an authoritative duration from the same message. Patterns the adapter recognizes:
  - `try again in <N> seconds?` / `try again in <N> s`
  - `try again in <N> minutes?` / `try again in <N> m`
  - `retry after <N> seconds?` / `retry after <N> minutes?`
  - `wait <N> seconds?` / `wait <N> minutes?`
  - `retry-after <N>` (interpreted as seconds)
  - When a duration is parsed, emit `{ type: "rate_limit", waitUntilMs: Date.now() + <duration-in-ms> }`. When no duration is parseable, emit `{ type: "error", retryable: true, message }` so the runner falls back to the transient backoff.
- Message contains any three-digit `5xx` token (`500`..`599`) — emit `{ type: "error", retryable: true, message }`.
- Message contains the three-digit tokens `408` or `425` — emit `{ type: "error", retryable: true, message }`.
- Message contains any of: `timeout`, `timed out`, `connection reset`, `connection refused`, `socket hang up`, `temporarily unavailable`, `service unavailable`, `gateway`, `network`, `ECONNRESET`, `ECONNREFUSED`, `ENOTFOUND`, `ETIMEDOUT`, `EAI_AGAIN` — emit `{ type: "error", retryable: true, message }`.
- Anything else — emit `{ type: "error", retryable: false, message }`. Unrecognized error shapes default to non-retryable so unknown failure modes do not silently mask a bug.

**When the child process exits without having emitted `type: "error"` and without having emitted `type: "turn.completed"`** — the adapter treats the failure as a transport-level retryable error and emits `{ type: "error", retryable: true, message: <synthesized message describing the unexpected exit> }`.

**When the child process exits via a signal** — same treatment: emit `{ type: "error", retryable: true, message: <synthesized message naming the signal> }`.

**When `type: "turn.completed"` is emitted and the child then exits with status 0** — emit `{ type: "done" }`.

The adapter never inspects `stderr` or the prompt text to decide retryability; the structured event stream plus the exit shape are authoritative.

### Why substring matching on the message

The Codex SDK's `ThreadErrorEvent` exposes only a `message` string. The adapter cannot inspect a structured HTTP status, a subtype, or a retry-after field because Codex does not surface them. Substring matching on the message text is the surface the SDK leaves to consumers; the patterns above are the closed set the adapter recognizes. Adding a new retryable substring requires updating this rule first; silently expanding the matcher is a violation.

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
- The adapter adds a new retryable substring to its matcher without adding it to this rule first.
- The adapter emits a `rate_limit` event without a parsed duration, instead of falling back to a retryable `error`.
- The adapter parses a duration with a unit other than seconds or minutes (for example, hours) and treats the number as the same unit it expected.
- The adapter leaks the spawned `codex` process on cancellation.
- A call site spawns `codex` directly, bypassing the adapter.
