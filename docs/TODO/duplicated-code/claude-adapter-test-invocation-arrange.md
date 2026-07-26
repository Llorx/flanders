# Duplicated: ClaudeAdapter test invocation ARRANGE boilerplate
Date: 2026-07-26

## What
The four-line `ARRANGE` preamble that builds a driveable adapter — `makeContexts()`, `new ClaudeAdapter(contexts)`, `baseArgs()`, then returning `{ adapter, args, claude }` — is repeated verbatim across the non-classification tests in `src/ai/ClaudeAdapter.test.ts`. The terminal-event classification family in the same file now shares one core (`classificationSubject` + `emittedEventsOf`), so the remaining copies are the tests whose `ACT` drives something other than "emit result events, read back the emitted events". Each location below is the `makeContexts()` line that opens one copy of the preamble.

## Where
- `src/ai/ClaudeAdapter.test.ts:161` — spawn-argv test: empty model and empty effort.
- `src/ai/ClaudeAdapter.test.ts:188` — spawn-argv test: `--dangerously-skip-permissions` is present.
- `src/ai/ClaudeAdapter.test.ts:208` — spawn-argv test: model `claude-opus-4-6`.
- `src/ai/ClaudeAdapter.test.ts:228` — spawn-argv test: effort `high` appends `--effort`.
- `src/ai/ClaudeAdapter.test.ts:255` — spawn-argv test: model then effort ordering.
- `src/ai/ClaudeAdapter.test.ts:275` — spawn-argv test: `fast` true appends the `fastMode` `--settings`.
- `src/ai/ClaudeAdapter.test.ts:295` — spawn-argv test: `fast` false passes no `--settings`.
- `src/ai/ClaudeAdapter.test.ts:315` — spawn-argv test: effort and fast together.
- `src/ai/ClaudeAdapter.test.ts:335` — spawn-argv test: model, effort and fast together.
- `src/ai/ClaudeAdapter.test.ts:355` — spawn-argv test: `--resume <id>` on a resumed invocation.
- `src/ai/ClaudeAdapter.test.ts:375` — stdin test: stdin closed immediately after the prompt.
- `src/ai/ClaudeAdapter.test.ts:400` — output-mapping test: assistant text block.
- `src/ai/ClaudeAdapter.test.ts:422` — output-mapping test: assistant thinking block.
- `src/ai/ClaudeAdapter.test.ts:444` — output-mapping test: assistant `tool_use` block.
- `src/ai/ClaudeAdapter.test.ts:466` — output-mapping test: user `tool_result` block.
- `src/ai/ClaudeAdapter.test.ts:488` — session test: `session_id` on the initial system event.
- `src/ai/ClaudeAdapter.test.ts:510` — session test: a repeated identical `session_id` is absorbed.
- `src/ai/ClaudeAdapter.test.ts:532` — session test: a differing `session_id` emits a new session event.
- `src/ai/ClaudeAdapter.test.ts:1068` — cancellation test: abort mid-stream sends `SIGINT`.
- `src/ai/ClaudeAdapter.test.ts:1103` — cancellation test: post-abort stdout and stderr are ignored.
- `src/ai/ClaudeAdapter.test.ts:1133` — stderr test: stderr is forwarded as an output event.
- `src/ai/ClaudeAdapter.test.ts:1156` — stdin test: the prompt is delivered as a stream-json user message.
- `src/ai/ClaudeAdapter.test.ts:1176` — usage test: token counts from the result event.
- `src/ai/ClaudeAdapter.test.ts:1196` — parse test: malformed JSON lines are ignored.
- `src/ai/ClaudeAdapter.test.ts:1218` — process test: an `error` event emits a non-retryable tool error.
- `src/ai/ClaudeAdapter.test.ts:1240` — process test: `ENOENT` emits "claude binary not found".
- `src/ai/ClaudeAdapter.test.ts:1282` — output-mapping test: non-initial system events are filtered.
- `src/ai/ClaudeAdapter.test.ts:1319` — cancellation test: a pre-aborted signal sends `SIGINT` immediately.
- `src/ai/ClaudeAdapter.test.ts:1339` — output-mapping test: `tool_result` array content extracts text blocks.
- `src/ai/ClaudeAdapter.test.ts:1364` — output-mapping test: non-string non-array `tool_result` content.
- `src/ai/ClaudeAdapter.test.ts:1389` — output-mapping test: non-text blocks inside `tool_result` content.
- `src/ai/ClaudeAdapter.test.ts:1414` — process test: a non-`Error` payload on the `error` event.
- `src/ai/ClaudeAdapter.test.ts:1436` — process test: exit without a result event is retryable.
- `src/ai/ClaudeAdapter.test.ts:1458` — process test: termination by signal is retryable.
- `src/ai/ClaudeAdapter.test.ts:1480` — parse test: a JSON `null` line is ignored.
- `src/ai/ClaudeAdapter.test.ts:1502` — usage test: absent cache fields default to zero.
- `src/ai/ClaudeAdapter.test.ts:1522` — session test: `session_id` first observed on the result event.
- `src/ai/ClaudeAdapter.test.ts:1548` — iteration test: events emitted after iteration starts.
- `src/ai/ClaudeAdapter.test.ts:1573` — iteration test: `break` triggers `return()` and kills the process.
- `src/ai/ClaudeAdapter.test.ts:1603` — usage test: absent `input_tokens` defaults to zero.
- `src/ai/ClaudeAdapter.test.ts:1623` — cancellation test: the iterable stays open until the child exits.

## Why It Matters
Every copy hardcodes how an adapter under test is constructed, so a change to the adapter's constructor shape or to the invoke arguments has to be applied in forty-one places. A shared `invocation()` helper returning `{ adapter, args, claude }` — the piece `classificationSubject` already wraps — would give the construction one authoritative source, leaving each test's `ARRANGE` to name only what makes it different.

Consolidation is deferred here rather than done inline: these tests exercise spawn arguments, output/session mapping, cancellation, usage accounting, and process lifecycle, none of which the authentication-classification change that surfaced this pattern touches. Rewriting forty-one unrelated `ARRANGE` blocks would be scope creep, so the pattern is recorded for a dedicated pass.
