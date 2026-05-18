# `install` Command Contract

## Purpose
Deliver the Flanders skills (`/flanders-contract`, `/flanders-plan`, and `/flanders-rule`) to the user's Claude Code environment so the user can invoke them from inside a Claude Code session. This subcommand is the only way the library publishes those skills to disk.

## Invocation
    npx flanders install [--global | --project]

## Flags
- `--project` — install the skills into the project's `.claude/skills/` folder, resolved relative to the current working directory.
- `--global` — install the skills into the user's home-level `~/.claude/skills/` folder.
- Neither flag — the command prompts the user interactively to pick one of the two destinations before installing anything. The interactive prompt offers exactly those two destinations.

The flags are mutually exclusive; supplying both is a usage error.

## Skills produced
The command writes one Claude Code skill directory per Flanders skill. At minimum:
- A skill directory for `/flanders-contract`, whose obligations are defined in `ai-skills/contract.md`.
- A skill directory for `/flanders-plan`, whose obligations are defined in `ai-skills/plan.md`.
- A skill directory for `/flanders-rule`, whose obligations are defined in `ai-skills/rule.md`.

Each skill is materialized in the form Claude Code requires for user-installed skills: a directory named after the slash command, containing a `SKILL.md` file with the skill body and any frontmatter the Claude Code skill format requires. The textual obligations a user sees when invoking a skill are pinned by the contract files in `contracts/ai-skills/`.

## Overwrite behavior
Existing files at the destination paths are overwritten silently. The command does not back up, version, or prompt about pre-existing files. Preserving prior versions of installed skill files is the user's responsibility, typically through version control.

## Output
On success, the command prints to standard output the list of files it wrote, one path per line. Each path identifies an installed skill file unambiguously. The list is exhaustive — every file the command created or overwrote is included.

## Errors
- `--global` and `--project` supplied together: exits non-zero with a diagnostic naming the conflict.
- Destination folder cannot be created or written to (permissions, read-only filesystem, etc.): exits non-zero with a diagnostic that names the offending path.
- Unable to produce a skill file (e.g., the source content for a skill is missing): exits non-zero with a diagnostic that names the affected skill.

## Out of scope
- The exact internal contents of each `SKILL.md` (frontmatter fields, body shape) are implementation choices and are not pinned by this contract. What is pinned is that after a successful `install` run, the user is able to invoke `/flanders-contract`, `/flanders-plan`, and `/flanders-rule` from inside a Claude Code session whose skills root is the chosen destination.
- Uninstallation: this contract does not define a `flanders uninstall` subcommand. The user removes installed skills manually if needed.
