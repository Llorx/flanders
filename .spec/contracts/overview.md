# Flanders Overview Contract

## Purpose
Flanders is a Node.js library that helps users create contracts, derive work plans from those contracts, and implement those plans through a mix of plain code and AI orchestration.

## Surfaces
Flanders ships two user-facing surfaces:

- A **CLI**, invoked via `npx flanders <command> [arguments...]`. Each command owns its own contract under `.spec/contracts/cli-commands/`:
  - `install` — see [.spec/contracts/cli-commands/install.md](/.spec/contracts/cli-commands/install.md).
  - `implement [plan]` — see [.spec/contracts/cli-commands/implement/overview.md](/.spec/contracts/cli-commands/implement/overview.md).
- Three **AI-tool skills**, invoked from inside an AI-coding-tool session. Each skill owns its own contract under `.spec/contracts/ai-skills/`:
  - `/flanders-spec` — authors contracts, rules, and behavior rules; see [.spec/contracts/ai-skills/spec-skill.md](/.spec/contracts/ai-skills/spec-skill.md).
  - `/flanders-plan` — see [.spec/contracts/ai-skills/plan-skill.md](/.spec/contracts/ai-skills/plan-skill.md).
  - `/flanders-work` — implements a request directly and gates it through adversarial review, in one invocation; see [.spec/contracts/ai-skills/work-skill.md](/.spec/contracts/ai-skills/work-skill.md).

The skills are delivered to the user's AI-tool environment by the `install` subcommand. The set of supported AI tools is currently Claude Code and OpenAI Codex CLI.

## CLI dispatch
When the CLI is invoked with an unknown command, it exits with a non-zero status and a short usage message that lists the valid subcommands. Each subcommand is responsible for its own argument validation and error reporting.

## Out of scope
This contract does not pin specific exit codes, flag syntax beyond `<command> [arguments]`, configuration files, or environment variables — those belong to individual subcommand contracts when relevant.
