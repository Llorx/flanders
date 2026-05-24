# Flanders Overview Contract

## Purpose
Flanders is a Node.js library that helps users create contracts, derive work plans from those contracts, and implement those plans through a mix of plain code and AI orchestration.

## Surfaces
Flanders ships two user-facing surfaces:

- A **CLI**, invoked via `npx flanders <command> [arguments...]`. Each command owns its own contract under `cli-commands/`:
  - `install` — see `cli-commands/install.md`.
  - `implement [plan]` — see `cli-commands/implement/overview.md`.
- Three **AI-tool skills**, invoked from inside an AI-coding-tool session. Each skill owns its own contract under `ai-skills/`:
  - `/flanders-contract` — see `ai-skills/contract-skill.md`.
  - `/flanders-plan` — see `ai-skills/plan-skill.md`.
  - `/flanders-rule` — see `ai-skills/rule-skill.md`.

The skills are delivered to the user's AI-tool environment by the `install` subcommand. The set of supported AI tools is currently Claude Code and OpenAI Codex CLI.

## CLI dispatch
When the CLI is invoked with an unknown command, it exits with a non-zero status and a short usage message that lists the valid subcommands. Each subcommand is responsible for its own argument validation and error reporting.

## Out of scope
This contract does not pin specific exit codes, flag syntax beyond `<command> [arguments]`, configuration files, or environment variables — those belong to individual subcommand contracts when relevant.
