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

## Installation

Setting Flanders up is a breeze, neighbor — just run:

```sh
npx flanders install
```

This is the one and only way Flanders publishes its skills to disk, and the only way it writes the persistent `.flanders/` configuration the other commands read.

### Scope

Flanders installs at one of two scopes, chosen with a pair of mutually exclusive flags:

- `--project` — the scope is the current working directory. Skills go into the project's AI-tool skill folders, and the `.flanders/` configuration is written at the project root.
- `--global` — the scope is your home directory. Skills go into the user-level AI-tool skill folders, and the `.flanders/` configuration is written at your home directory.

Passing both at once is a usage error. When you supply neither, the command kindly prompts you to pick one.

### What it writes

For each AI tool you select for skills, `install` writes one skill artifact per Flanders skill (`/flanders-spec`, `/flanders-plan`, and `/flanders-work`) into that tool's skill folder for the chosen scope:

| Tool | Project scope | Global scope |
| --- | --- | --- |
| Claude Code | `.claude/skills/` | `~/.claude/skills/` |
| Codex CLI | `.codex/prompts/` | `~/.codex/prompts/` |

Select `both` and the artifacts are written for both tools, each into its own folder. Alongside the skills, the command writes the `.flanders/` configuration at the chosen scope (see [Configuration](#configuration)).

### Interactive prompts

Run it without flags and Flanders walks you through the setup, asking in this order:

1. **Skills tool** — `claude`, `codex`, or `both`.
2. **Scope** — `--project` or `--global`, each option labelled with the concrete destination path(s) for the skills tool you picked.
3. **Worker tool, model, and effort** — the AI the `implement` command's worker uses.
4. **Reviewer configuration** — an ordered list of one or more adversarial reviewers, each with its own tool, model, and effort.
5. **Weighted-review configuration** — when two or more reviewers are configured, the minimum number of reviewers that must run to a verdict, and which reviewers are optional.

### Running without prompts

Every question has an equivalent command-line flag, so the whole thing can run non-interactively, doncha know. Any answer you supply by flag is not prompted again.

### Overwriting and output

Existing files at the destination — both skill artifacts and `.flanders/` configuration files — are overwritten silently, with no backup and no prompt, so preserving prior versions is up to your own version control. On success, the command prints the full list of files it wrote, one path per line.

## Configuration

The `install` command tucks your answers into a `.flanders/` folder so the other commands — `implement` today — know just how you like things done. Where that folder lives depends on the scope you chose:

- **Project scope** — `.flanders/` at the project root.
- **Global scope** — `~/.flanders/` in your home directory.

It persists exactly the answers downstream commands need at run time:

- The **worker** the `implement` command uses: its tool (`claude` or `codex`), its model, and its reasoning effort.
- The **ordered list of adversarial reviewers**, in the order you configured them. Each reviewer carries its own tool (`claude` or `codex`), model, and effort, plus whether it is optional.
- The **minimum number of reviewers** that must run to a verdict in each review round.

For any model or effort you leave unset — the worker's or a reviewer's — Flanders doesn't record a concrete value; instead it persists the explicit marker `default configured model` or `default configured effort`, which tells the tool to fall back to its own default at run time.

The skills-tool answer is used by `install` itself to decide which folders to write into, so it isn't persisted here.

### Which configuration wins

When a command reads the configuration, a project-scope `.flanders/` always takes precedence over a global one — and it's all or nothing, with no field-by-field merge between the two. So a project `.flanders/` is used in full when it's present; otherwise the global `~/.flanders/` is used.
