# `update` Command Contract

## Purpose
Refresh the Flanders skills already delivered to the user's AI-tool environment(s), rewriting each installed skill artifact with the current version's content so that an upgraded Flanders package republishes its `/flanders-spec`, `/flanders-plan`, `/flanders-work`, and `/flanders-hard-stop-review` skills without the user re-answering any configuration question. The command republishes skills only; it leaves the persistent `.flanders/` configuration exactly as it was.

## Invocation
    npx flanders update

The command takes no flags. It determines what to refresh, and where, entirely by inspecting the destinations `install` writes skills to.

## What it refreshes
The command scans the skill destinations defined by [.spec/contracts/cli-commands/install.md](/.spec/contracts/cli-commands/install.md#skills-produced) — for each supported AI tool, the project-scope skill folder and the user-scope skill folder — and treats a destination as an existing installation when at least one Flanders skill artifact is present there. At every such destination it rewrites the full set of Flanders skill artifacts (`/flanders-spec`, `/flanders-plan`, `/flanders-work`, `/flanders-hard-stop-review`), so a destination that held only some of them ends the run holding the complete, current set. A destination with no Flanders skill artifact is left untouched: `update` refreshes installations the user already has and never creates one where the user had none.

The skill artifacts `update` writes for a given tool and scope are identical to those a fresh `install` writes. What is pinned is that after a successful `update` run, every AI-tool environment that already had Flanders skills can invoke `/flanders-spec`, `/flanders-plan`, `/flanders-work`, and `/flanders-hard-stop-review` at their current version.

## Configuration left untouched
`update` neither reads nor writes any `.flanders/config.json`. The worker and reviewer configuration that a previous `install` persisted is preserved exactly, at every scope, across an `update` run (the configuration surface is pinned in [.spec/contracts/shared/flanders-config.md](/.spec/contracts/shared/flanders-config.md)).

## Overwrite behavior
Existing skill artifacts at the refreshed destinations are overwritten silently, the same way `install` overwrites them (see [.spec/contracts/cli-commands/install.md#overwrite-behavior](/.spec/contracts/cli-commands/install.md#overwrite-behavior)). The command does not back up, version, or prompt about the files it replaces. Preserving prior versions is the user's responsibility, typically through version control.

## Output
On success, the command prints to standard output the list of skill artifact files it wrote, one path per line. The list is exhaustive — every file the command created or overwrote across every refreshed destination is included.

## Voice
The command's status writes carry the Flanders voice defined in [.spec/contracts/shared/flanders-voice.md](/.spec/contracts/shared/flanders-voice.md). The voice seasons that prose only; the printed file paths are reported exactly as they are, untouched by the flavor.

## Errors
- No existing Flanders skill installation is found at any scanned destination: exits non-zero with a diagnostic that directs the user to `npx flanders install`.
- A destination folder that holds an existing installation cannot be written to (permissions, read-only filesystem, etc.): exits non-zero with a diagnostic that names the offending path.
- Unable to produce a skill artifact (e.g., the source content for a skill is missing): exits non-zero with a diagnostic that names the affected skill.

## Out of scope
- The internal contents of each skill artifact (frontmatter fields, body shape) are implementation choices, exactly as for `install` (see [.spec/contracts/cli-commands/install.md#out-of-scope](/.spec/contracts/cli-commands/install.md#out-of-scope)).
- Changing the set of tools or scopes a user has skills installed for: `update` refreshes existing installations, and growing or relocating an installation is the job of `install`.
- The `.flanders/` configuration surface, which is owned by `install` and read by consuming commands (see [.spec/contracts/shared/flanders-config.md](/.spec/contracts/shared/flanders-config.md)).
