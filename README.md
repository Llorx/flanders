# Flanders

> Flanders never breaks a rule.

Hi-diddly-ho, neighbor! Flanders is a Node.js toolkit that helps you author contracts, derive work plans from them, and implement those plans through a mix of plain code and AI orchestration, exposed through two surfaces — a CLI invoked as `npx flanders <command>` and three AI-tool skills invoked from inside an AI-coding-tool session.

## Contents

- [How it works](#how-it-works)
- [Requirements](#requirements)
- [Installation](#installation)
- [Configuration](#configuration)
- [Usage](#usage)
- [Voice](#voice)
- [Project metadata](#project-metadata)

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

## Usage

With Flanders installed, here's how to put it to work — running plans from the CLI and shaping them with the three skills.

### Implementing a plan

```sh
npx flanders implement [plan]
```

`implement` takes a plan from your `plans/` folder and carries it through from start to finish. Leave `[plan]` off and Flanders runs the single plan in `plans/` for you automatically; when there's more than one, it lists them and asks you to re-run naming the one to implement. From there it works through each open task with the worker AI, gating every result through build, test, and adversarial review before marking that task complete in the plan — and it commits once per accepted task, so each step lands as its own neat little commit. The project must be a git repository: `implement` needs git and has no flag to turn it off.

### The three skills

The skills become available after a successful `npx flanders install` run. Each one shapes a different part of the spec → plan → implement cycle:

- **`/flanders-spec`** — turns a free-form request into your contracts, rules, and behavior rules, written into the `.spec/contracts`, `.spec/rules`, and `.spec/flanders` folders.
- **`/flanders-plan`** — derives a single, ordered, contract-aware work plan under `plans/` from your request.
- **`/flanders-work`** — implements a small, self-contained request directly and gates it through a single adversarial review, all in one invocation — no plan file and no commit.

### A typical workflow

Here's the neighborly path from a blank slate to shipped code:

1. **`npx flanders install`** — set Flanders up and deliver the skills.
2. **`/flanders-spec`** — capture your obligations and conventions as contracts and rules.
3. **`/flanders-plan`** — derive an ordered work plan from them under `plans/`.
4. **`npx flanders implement`** — build the plan task by task, each result gated through build, test, and review.

And when a change is small enough that a whole plan would be overkill, **`/flanders-work`** is your shortcut — it carries that one request from request to reviewed finish without a plan or a commit.

## Voice

You may notice Flanders is a friendly neighbor through and through: every surface that speaks to you — the `install` command's interactive prompts, the status writes of both `install` and `implement`, the live `implement` UI, and the narration from the worker, the reviewers, and the skills — carries a gentle, good-natured Ned-Flanders tone. It's only ever a light seasoning, mind you: the flavor colors how a message reads, but it never changes what the message means or how accurate it is, and it never lands on the things that must stay exact — command names, paths, flags, the facts inside a diagnostic, or git commit messages.

---

## Project metadata

- **Package** — `flanders`
- **License** — MIT
- **Author** — Llorx
- **Repository** — git+https://github.com/Llorx/flanders.git
- **Issues** — https://github.com/Llorx/flanders/issues
- **Homepage** — https://github.com/Llorx/flanders#readme
