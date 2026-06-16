# `implement` Command Contract — Workspace

## Purpose
Define how the implement command sets up its per-run scratch space and the helper scripts it uses for build and test validation gates.

## Temporary folder
At the start of every implement run, a main temporary folder is created. It directly holds:
- The build script and the test script (see below).
- Per-iteration log files: worker output, build output, test output, each reviewer's streamed output, and `error.log` (a single fixed-name file used to brief subsequent iterations).

Immediately after the main temporary folder is created, the command creates one additional temporary folder for each reviewer configured in the Flanders configuration (see [.docs/contracts/shared/flanders-config.md](/.docs/contracts/shared/flanders-config.md)). Each per-reviewer folder is allocated the same way as the main temporary folder — its own independently created temporary folder, never a subfolder of the main temporary folder and never a subfolder of any other reviewer's folder. Each per-reviewer folder holds exactly that reviewer's verdict file, named `error.log`, and holds no other reviewer's verdict. The `error.log` briefing file named above lives in the main temporary folder and is a distinct file from these per-reviewer `error.log` files.

All of these temporary folders — the main folder together with every per-reviewer folder — are removed automatically when the program exits in any way other than a hard stop. A hard stop is triggered either by exceeding the per-task iteration cap ([.docs/contracts/cli-commands/implement/iteration-loop.md](/.docs/contracts/cli-commands/implement/iteration-loop.md)) or by an irrecoverable failure of the prep optimization when it runs ([src/commands/.docs/rules/ai/task-context/prep-optimization.md](/src/commands/.docs/rules/ai/task-context/prep-optimization.md)); on a hard stop all of these folders are intentionally preserved on disk so the user can inspect the per-iteration logs, every reviewer's `error.log`, and the briefing `error.log`. If the host platform offers a built-in cleanup-on-exit API, that API is used for the automatic-removal cases; otherwise the program registers an explicit cleanup hook that runs on normal exit and on common termination signals. The hard stop suppresses this cleanup regardless of which mechanism is in use.

## Build and test script detection
Once the temporary folder exists and before the iteration loop starts, the command determines how to build and test the current project. How the build and test commands are determined — by inspecting the project, without asking the user or consulting a configuration file, leaving a command undetermined when it cannot be confidently found — is defined in [.docs/contracts/shared/build-test-validation.md](/.docs/contracts/shared/build-test-validation.md). This section pins only how the `implement` command captures those determined commands:

1. The command itself decides the build and test script paths based on the host platform — `build.bat` and `test.bat` on a Windows host, `build.sh` and `test.sh` on any other host — and stores both paths. The agent is never asked to pick the platform or the extension; that decision belongs to flanders.
2. Spawn an AI agent (via the AI runner — see [src/ai/.docs/contracts/ai-runner.md](/src/ai/.docs/contracts/ai-runner.md)) that determines the build and test commands per [.docs/contracts/shared/build-test-validation.md](/.docs/contracts/shared/build-test-validation.md) and writes them into the two specific paths supplied in the prompt. The prompt names those paths verbatim.
3. The agent edits the two named files. It does not invent alternative filenames, alternative extensions, or alternative locations.
4. After the agent finishes, the command verifies that each of the two named files exists and is non-empty. The build script and test script are tracked independently — either may be missing while the other is present. A command the agent left undetermined per [.docs/contracts/shared/build-test-validation.md](/.docs/contracts/shared/build-test-validation.md) yields an absent or empty script at the path flanders supplied, which the command treats as that validation gate being skipped.

The same two paths are passed downstream to every other AI invocation that may need to read or modify the build or test scripts (for example, the worker agent in the iteration loop when a task changes how the project builds or tests). The orchestrator is the single source of truth for these paths; no other component decides them.

The detect agent must not write to any file outside the two named build/test script paths. In particular, it may not write to any `.spec/contracts` folder, any `.spec/rules` folder, or the `plans/` folder per [.docs/contracts/shared/spec-folder-write-authority.md](/.docs/contracts/shared/spec-folder-write-authority.md).
