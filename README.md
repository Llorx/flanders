# Flanders

> Flanders never breaks a rule.

Hi-diddly-ho, neighbor! Flanders is a Node.js toolkit that helps you author contracts, derive work plans from them, and implement those plans through a mix of plain code and AI orchestration, exposed through two surfaces — a CLI invoked as `npx flanders <command>` and three AI-tool skills invoked from inside an AI-coding-tool session.

## Contents

- [How it works](#how-it-works)
- [Requirements](#requirements)
- [Installation](#installation)
- [Usage](#usage)
- [Configuration](#configuration)

## How it works

Flanders speaks to you through two surfaces. The **CLI** — invoked as `npx flanders <command>` — carries two commands: `install`, which sets Flanders up in your project or your home directory, and `implement [plan]`, which builds a plan from start to finish. The three **AI-tool skills** — `/flanders-spec`, `/flanders-plan`, and `/flanders-work` — are invoked from right inside an AI-coding-tool session.

Underneath, Flanders keeps a tidy little spec corpus alongside your code, and golly, everything flows from it:

- **`.spec/contracts`** holds the public obligations a scope exposes — the promises its surface makes to the outside world.
- **`.spec/rules`** holds the internal conventions its code follows — the house rules it keeps for itself.

Ordered work plans then live under **`plans/`**: each plan is a sequence of tasks derived from the contracts and rules, ready to be built one at a time.

The whole neighborly cycle runs **spec → plan → implement**:

1. Capture obligations and conventions as contracts and rules in the spec corpus (with `/flanders-spec`).
2. Derive an ordered work plan from them under `plans/` (with `/flanders-plan`).
3. Implement the plan task by task, gating each result through build, test, and adversarial review (with `npx flanders implement`).

For a small, self-contained change that doesn't need a whole plan, there's a friendly shortcut: **`/flanders-work`** implements the request directly and gates it through the same adversarial review, all in one invocation.

## Requirements

A few neighborly things to have on hand before you start:

- **Node.js** — the CLI is run with `npx`.
- **A git repository** — the `implement` command requires the project to be a git repository.
- **A supported AI coding tool** — currently Claude Code or Codex CLI.
