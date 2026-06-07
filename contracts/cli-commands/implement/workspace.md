# `implement` Command Contract — Workspace

## Purpose
Define how the implement command sets up its per-run scratch space and the helper scripts it uses for build and test validation gates.

## Temporary folder
At the start of every implement run, a main temporary folder is created. It directly holds:
- The build script and the test script (see below).
- Per-iteration log files: worker output, build output, test output, each reviewer's streamed output, and `error.log` (a single fixed-name file used to brief subsequent iterations).

Immediately after the main temporary folder is created, the command creates one additional temporary folder for each reviewer configured in the Flanders configuration (see `shared/flanders-config.md`). Each per-reviewer folder is allocated the same way as the main temporary folder — its own independently created temporary folder, never a subfolder of the main temporary folder and never a subfolder of any other reviewer's folder. Each per-reviewer folder holds exactly that reviewer's verdict file, named `error.log`, and holds no other reviewer's verdict. The `error.log` briefing file named above lives in the main temporary folder and is a distinct file from these per-reviewer `error.log` files.

All of these temporary folders — the main folder together with every per-reviewer folder — are removed automatically when the program exits in any way other than the hard stop defined in `cli-commands/implement/iteration-loop.md`. On a hard stop all of them are intentionally preserved on disk so the user can inspect the per-iteration logs, every reviewer's `error.log`, and the briefing `error.log`. If the host platform offers a built-in cleanup-on-exit API, that API is used for the automatic-removal cases; otherwise the program registers an explicit cleanup hook that runs on normal exit and on common termination signals. The hard stop suppresses this cleanup regardless of which mechanism is in use.

## Build and test script detection
Once the temporary folder exists and before the iteration loop starts, the command detects how to build and test the current project:

1. The command itself decides the build and test script paths based on the host platform — `build.bat` and `test.bat` on a Windows host, `build.sh` and `test.sh` on any other host — and stores both paths. The agent is never asked to pick the platform or the extension; that decision belongs to flanders.
2. Spawn an AI agent (via the AI runner — see `cli-commands/implement/ai-runner.md`) with a prompt that asks it to inspect the project, decide the appropriate build and test commands, and write them into the two specific paths supplied in the prompt. The prompt names those paths verbatim. The prompt does not point the agent at any project configuration file or document — the agent is expected to inspect the project on its own and recognize what kind of project it is (Node.js, Rust, C++, etc.).
3. The agent edits the two named files. It does not invent alternative filenames, alternative extensions, or alternative locations.
4. After the agent finishes, the command verifies that each of the two named files exists and is non-empty. The build script and test script are tracked independently — either may be missing while the other is present.

The same two paths are passed downstream to every other AI invocation that may need to read or modify the build or test scripts (for example, the worker agent in the iteration loop when a task changes how the project builds or tests). The orchestrator is the single source of truth for these paths; no other component decides them.

The detect agent must not write to any file outside the two named build/test script paths. In particular, it may not write to `contracts/`, `rules/`, or `plans/` per `shared/spec-folder-write-authority.md`.

## Missing detection
If the agent cannot confidently determine how to build the project, it leaves the build script file absent (or empty) at the path flanders supplied. The same rule applies independently to the test script. The command treats a missing or empty script as "this validation gate is skipped" — it does not invent a fallback.

## Script content
Each script contains whatever native commands are needed to build or test the project on the current host. For example, a Node.js project that exposes a `build` npm script will produce a build script that invokes `npm run build`; a C++ project will produce a script that invokes the appropriate compiler or build system available on the current host. The exact commands are an output of the detection step, not a fixed value of this contract.
