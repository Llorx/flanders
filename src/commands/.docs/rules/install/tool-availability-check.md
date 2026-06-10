# Install verifies tool availability by running `<tool> --version`

Before writing any file, the `install` command verifies that each AI tool the user's answers select for skills, worker, or reviewer is available on the host by spawning that tool's binary with `--version` and checking the exit code. A non-zero exit, or a `spawn` failure (typically `ENOENT`), is treated as "tool not available". The PATH lookup alone is not enough — the runner needs the binary to actually start.

## Who this applies to

- **Subject:** the `install` command, at the start of its execution, after all answers have been collected (interactively or via flags) and before any file is written to `.flanders/` or to any AI-tool skill folder.
- **Not subject:** any later Flanders command (such as `implement`). Those commands assume the configuration on disk reflects a successful availability check at install time and do not re-probe.

## Procedure per tool

For every distinct tool referenced by the user's answers (skills tool, worker tool, reviewer tool — deduplicated):

1. Spawn the tool's binary with the argument list `["--version"]`, redirecting stdout and stderr away from the user's terminal so the probe is silent on success.
2. Wait for the process to exit.
3. Treat the tool as **available** if and only if the process exited with exit code 0.
4. Treat the tool as **not available** if any of the following happens:
   - The spawn fails (e.g., `ENOENT`, "command not found", "is not recognized").
   - The process exits with a non-zero exit code.
   - The process exits via a signal.

Tool-name-to-binary mapping:

- `claude` → binary `claude`.
- `codex` → binary `codex`.

## Aggregation and reporting

The command probes every selected tool before exiting. It does not stop at the first missing tool: the diagnostic must enumerate every missing tool so the user can install them all in one pass instead of running `install` once per missing tool.

When any tool is missing, the command exits non-zero with a diagnostic that names every missing tool (one per line) and does not write to disk. When every tool is available, the command proceeds.

## Why a `--version` probe and not just PATH lookup

A binary on `PATH` may still fail to start (broken shim, missing runtime, mismatched architecture). The `--version` probe is a cheap end-to-end smoke test: it confirms that the process actually starts, parses its own flags, and exits cleanly. The user's install configuration is durable — paying a few hundred milliseconds at install time to avoid persisting a configuration that points to an unrunnable binary is the right trade.

`--version` is also non-destructive and idempotent across every CLI considered (Claude Code, Codex CLI). It will not authenticate, will not write files, will not consume tokens.

## Failure signals

- `install` skips the availability probe and writes `config.json` referencing a binary that is not on `PATH`.
- `install` relies on `which`/`where`/`command -v` alone, accepting a binary that is on `PATH` but fails to spawn.
- `install` stops at the first missing tool and reports only that one, forcing the user to re-run after each fix.
- `install` writes any file to disk while the availability probe is still pending or has reported any tool as missing.
- The probe pipes the tool's stdout or stderr to the user's terminal during the check, making the install output noisy with version banners on success.
