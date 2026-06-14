# The detect agent inherits tool, model and effort from the worker

The build/test detection agent spawned by `implement` at workspace setup time (see [.docs/contracts/cli-commands/implement/workspace.md](/.docs/contracts/cli-commands/implement/workspace.md)) is not separately configured in `.flanders/config.json`. It runs through the AI runner with the same `tool`, `model`, and `effort` the runner uses for the worker.

## Who this applies to

- **Subject:** the workspace-setup code path in `implement` that spawns the detect agent.
- **Not subject:** the AI runner itself. The runner receives tool/model/effort as arguments and does not know the call is a detect call.

## Behavior

When the workspace setup spawns the detect agent:

1. The orchestrator reads `.flanders/config.json` per [src/workspace/.docs/rules/flanders-config/file-format.md](/src/workspace/.docs/rules/flanders-config/file-format.md).
2. It takes the `worker.tool`, `worker.model`, and `worker.effort` values verbatim and passes them to the AI runner along with the detect prompt and the two target script paths (`build.bat`/`test.bat` on Windows, `build.sh`/`test.sh` elsewhere).
3. The runner invokes the resulting tool with that model and effort, per [src/ai/.docs/rules/runner/claude-invocation.md](/src/ai/.docs/rules/runner/claude-invocation.md) or [src/ai/.docs/rules/runner/codex-invocation.md](/src/ai/.docs/rules/runner/codex-invocation.md).

The orchestrator does not consult `reviewer.*` for the detect agent, and does not invent a third "detect" set of fields.

## Why inherit from worker

- Install only verified availability for the tools persisted in `.flanders/config.json`. Borrowing the worker's tool guarantees the binary is on `PATH` and runnable; introducing a third tool here would re-introduce the availability question Flanders solved at install time.
- The detect agent writes scripts in the project's working tree — same shape of write as the worker. Inheriting the worker's `tool`/`model`/`effort` keeps the detect quality coherent with the implementation quality.
- Adding a separate set of fields just for detect would expand `.flanders/config.json` to satisfy a role that runs once per `implement` run and never gets adversarially reviewed.

## Failure signals

- The orchestrator passes the reviewer's tool/model/effort (or any mix) to the detect agent.
- The orchestrator hardcodes a tool/model/effort for the detect agent instead of reading the worker's values from `.flanders/config.json`.
- The orchestrator introduces a `detect.*` section in `.flanders/config.json` and consumes it.
- The orchestrator bypasses the AI runner to spawn the detect agent directly.
