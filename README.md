# Motivation

Hi-diddly-ho, neighbor! I am a Node.js toolkit that helps avoid AI drifting. I was sick of the AI not reading the `CLAUDE.md`, avoiding rules and forgetting what I told it 3 prompts ago. You know that I, Ned Flanders, will never break a rule, so it was natural for me to spawn here at some point. I will help you define a specification, the public contracts and private rules, and then I will orchestrate the AI for you to implement and review anything without breaking the specification. I have no problem hitting the AI with a stick when it drifts.

## Contents

- [How it works](#how-it-works)
- [Requirements](#requirements)
- [Installation](#installation)
- [Updating](#updating)
- [Configuration](#configuration)
- [Usage](#usage)
- [A worked example](#a-worked-example)

## How it works

With Flanders you first define a specification that will be stored in a `.spec` folder alongside where the specification applies. Then Flanders will help you to create a plan divided into tasks, and via CLI you then implement the plan.

Flanders will implement one task at a time, and then will launch, in parallel, as many validators as you have configured. If something differs from the specification, they will notify the worker to review the problem and fix it.

I'm not gonna lie, it is token hungry, but that's what you get when you want to reduce specification drifting. The AI has to iterate and validate multiple times what it is doing to avoid the typical "Ah, you are right! You already told me that". Still, Flanders has rate limit detection and retries, so you can let an implementation run overnight while you sleep, without worrying about the limits.

The whole neighborly cycle runs **spec → plan → implement**:

1. Capture obligations and conventions as contracts and rules in the spec corpus (with `/flanders-spec`).
2. Derive an ordered work plan from them under `plans/` (with `/flanders-plan`).
3. Implement the plan task by task, gating each result through build, test, and adversarial review (with `flanders implement`).

For a small, self-contained change that doesn't need a whole plan, there's a friendly shortcut: **`/flanders-work`** implements the request directly and gates it through the same build, test, and adversarial review, all in one invocation.

Underneath, Flanders keeps a tidy little spec corpus alongside your code, and everything flows from it:

- **`.spec/contracts`** holds the public obligations a scope exposes — the promises its surface makes to the outside world.
- **`.spec/rules`** holds the internal conventions its code follows — the house rules it keeps for itself.
- **`.spec/flanders`** holds behavior rules — the obligations that govern how Flanders' own commands and skills behave while they work in your project.

## Requirements

A few neighborly things to have on hand before you start:

- **Node.js**.
- **A git repository** — the `implement` command requires the project to be a git repository.
- **A supported CLI AI coding tool** — currently Claude Code or Codex CLI.

## Installation

Setting Flanders up is a breeze, neighbor — just run:

```sh
npm install flanders -g
```

and then:

```sh
flanders install
```

This is how Flanders first sets up on disk: it is the only command that writes the persistent `.flanders/` configuration that `implement` reads, and the way you publish the skills to a fresh scope.

### Scope

Flanders installs at one of two scopes, chosen with a pair of mutually exclusive flags:

- `--project` — the scope is the current working directory. Skills go into the project's AI-tool skill folders, and the `.flanders/` configuration is written at the project root.
- `--global` — the scope is your home directory. Skills go into the user-level AI-tool skill folders, and the `.flanders/` configuration is written at your home directory.

### What it writes

For each AI tool you select for skills, `install` writes one skill artifact per Flanders skill (`/flanders-spec`, `/flanders-plan`, and `/flanders-work`) into that tool's skill folder for the chosen scope:

| Tool | Project scope | Global scope |
| --- | --- | --- |
| Claude Code | `.claude/skills/` | `~/.claude/skills/` |
| Codex CLI | `.codex/prompts/` | `~/.codex/prompts/` |

Select both tools and the artifacts are written for each, into its own folder. Alongside the skills, the command writes the `.flanders/` configuration at the chosen scope (see [Configuration](#configuration)).

### Interactive prompts

Run it without flags and Flanders walks you through the setup, asking in this order:

1. **Skills tool** — one or more of `claude` and `codex`.
2. **Scope** — `--project` or `--global`, each option labelled with the concrete destination path(s) for the skills tool you picked.
3. **Worker tool, model, and effort** — the AI the `implement` command's worker uses.
4. **Reviewer configuration** — an ordered list of one or more adversarial reviewers, each with its own tool, model, and effort. You can have any number of reviewers, for example Claude Opus, Claude Sonnet and Codex. You can even duplicate them if you think that one pass is not enough to detect a problem.
5. **Weighted-review configuration** — when two or more reviewers are configured, the minimum number of reviewers that must run to a verdict, and which reviewers are optional. Optional reviewers will not halt the implementation when they reach a rate limit.

After the effort question, both the worker and each reviewer are also asked whether to enable Claude Code's fast mode — but only when that role's tool is Claude Code and its chosen model supports fast mode. The question defaults to off, since fast mode bills at a higher rate, and your answer is persisted per role in the `.flanders/` configuration.

And if a `.flanders/` configuration already lives at the scope you choose, neighbor, `install` reads it the moment you pick that scope and pre-selects your stored answers as the question defaults. Just press Enter straight through to reproduce your saved configuration just as it was.

### Flags

Every question has an equivalent command-line flag, so the whole setup can run without a single prompt:

**Scope** (mutually exclusive)

- `--project` — install into the current working directory.
- `--global` — install into your home directory.

**Skills and worker**

- `--skills-tool=<claude|codex|claude,codex>` — which AI tool(s) the skills are installed for, as a comma-separated list of one or more of `claude` and `codex`.
- `--worker-tool=<claude|codex>` — which AI tool the `implement` worker uses.
- `--worker-model=<value>` — model the worker tool invokes; an empty value means "use the tool's default configured model".
- `--worker-effort=<value>` — reasoning effort the worker tool invokes; an empty value means "use the tool's default configured effort".
- `--worker-fast` — a presence flag that enables Claude Code's fast mode for the worker; off by default, and valid only for a worker whose tool is `claude` and whose model supports fast mode.

**Reviewers** — an ordered list, where reviewer 1 uses the unindexed names and reviewer `N` (2 or greater) carries the index:

- `--reviewer-tool=<claude|codex>` / `--reviewer-N-tool=<claude|codex>`
- `--reviewer-model=<value>` / `--reviewer-N-model=<value>`
- `--reviewer-effort=<value>` / `--reviewer-N-effort=<value>`

The reviewer indices must form a contiguous run starting at reviewer 1. Supplying any reviewer flag fixes the reviewer list to those indices and skips the "configure another reviewer?" prompt.

A presence flag, `--reviewer-fast` / `--reviewer-N-fast`, enables Claude Code's fast mode for that reviewer; off by default, and valid only for a reviewer whose tool is `claude` and whose model supports fast mode. It annotates a reviewer within the established list rather than establishing or extending it, so — unlike the tool, model, and effort flags above — it neither fixes the list nor skips the "configure another reviewer?" prompt.

**Weighted review** — only meaningful with two or more reviewers:

- `--reviewer-optional` / `--reviewer-N-optional` — a presence flag that marks that reviewer optional; a reviewer with no such flag is required.
- `--reviewer-minimum=<value>` — the minimum number of reviewers that must run to a verdict each round, an integer between `1` and the number of configured reviewers.

A tool flag, or the `codex` effort flag, rejects a value outside its accepted set; model flags and the `claude` effort flag accept any value verbatim. Supplying a weighted-review flag with a single reviewer — or a `--reviewer-minimum` equal to the reviewer count together with any optional flag — is a usage error.

### Overwriting and output

Existing files at the destination — both skill artifacts and `.flanders/` configuration files — are overwritten silently, with no backup and no prompt, so preserving prior versions is up to your own version control. On success, the command prints the full list of files it wrote, one path per line.

## Updating

Updated the lib and itching for the freshest skills, neighbor? Just run:

```sh
flanders update
```

`update` takes no flags. It scans the four skill destinations `install` writes to — Claude Code's `.claude/skills/` and `~/.claude/skills/`, and Codex CLI's `.codex/prompts/` and `~/.codex/prompts/` — and wherever it finds at least one Flanders skill artifact already in place, it rewrites the full `/flanders-spec`, `/flanders-plan`, and `/flanders-work` trio there with the current version. A destination where no Flanders skill artifact is present is left untouched, so `update` refreshes the installations you already have and never creates one where you had none.

## Configuration

The `install` command tucks your answers into a `.flanders/` folder so the command that consumes them — `implement` — knows just how you like things done. (`update` leaves this configuration untouched; it only refreshes the skills.) Where that folder lives depends on the scope you chose:

- **Project scope** — `.flanders/` at the project root.
- **Global scope** — `~/.flanders/` in your home directory.

### Which configuration wins

When a command reads the configuration, a project-scope `.flanders/` always takes precedence over a global one — and it's all or nothing, with no field-by-field merge between the two. So a project `.flanders/` is used in full when it's present; otherwise the global `~/.flanders/` is used.

## Usage

With Flanders installed, here's how to put it to work — running plans from the CLI and shaping them with the three skills.

### The three skills

- **`/flanders-spec`** — turns a free-form request into your contracts, rules, and behavior rules, written into the `.spec/contracts`, `.spec/rules`, and `.spec/flanders` folders.
- **`/flanders-plan`** — derives a single, ordered, specification-aware work plan from your request.
- **`/flanders-work`** — implements a small, self-contained request directly and gates it through build, test, and a single adversarial review, all in one invocation — no plan file and no commit.

Each skill takes the same optional `<data>` argument:

```
/flanders-spec [<data>]
/flanders-plan [<data>]
/flanders-work [<data>]
```

- Omit it, and the skill takes your request straight from the conversation.
- Give it a path to an existing file, and the skill reads that file as the input.
- Give it any other text, and the skill uses that text verbatim.

### Implementing a plan

```sh
flanders implement [plan]
```

`implement` takes a plan from your `plans/` folder and carries it through from start to finish. Leave `[plan]` off and Flanders runs the single plan in `plans/` for you automatically. From there it works through each open task with the worker AI, gating every result through build, test, and adversarial review before marking that task complete in the plan — and it commits once per accepted task, so each step lands as its own neat little commit. The whole run is non-interactive: once started, it never stops to ask you anything, and it caps each task at five attempts before halting. The project must be a git repository: `implement` needs git and has no flag to turn it off.

When the plan implementation is finished, you can squash all the plan commits. They are ordered by task for easier identification.

### A typical workflow

Here's the neighborly path from a blank slate to shipped code:

1. **`flanders install`** — set Flanders up and deliver the skills.
2. **`/flanders-spec`** — capture your obligations and conventions as contracts, rules, and behavior rules.
3. **`/flanders-plan`** — derive an ordered work plan from them under `plans/`.
4. **`flanders implement`** — build the plan task by task, each result gated through build, test, and review.

And when a change is small enough that a whole plan would be overkill, **`/flanders-work`** is your shortcut — it carries that one request from request to reviewed finish without a plan or a commit.

## A worked example

Let's build a tiny web calculator that only multiplies and subtracts, neighbor — start to finish, the whole spec → plan → implement stroll.

1. **Set Flanders up** in your project and deliver the skills:

```sh
flanders install
```

2. **Capture the spec** with `/flanders-spec`. You describe what you want; the skill sorts each obligation into the right folder — public behavior into `.spec/contracts`, internal conventions into `.spec/rules`:

```
/flanders-spec A web calculator with exactly two operations — multiply and subtract — over two number inputs, showing the result. The operation buttons are teal, the result panel is white, and the page background is slate. Build the UI with React bundled by Vite, and use no other UI framework.
```

From that one request it writes, for example:

- a **functionality contract** under `.spec/contracts/` — the calculator offers exactly two operations, multiply and subtract, over two numeric inputs, and shows the result;
- a **colors contract** under `.spec/contracts/` — the operation buttons are teal, the result panel white, and the background slate;
- a **frameworks rule** under `.spec/rules/` — the UI is built with React bundled by Vite, and no other UI framework is introduced.

The skill shows you the planned layout first and writes the files once you approve.

3. **Derive the plan** with `/flanders-plan` — one ordered, specification-aware plan under `plans/`, each task linked back to the contracts and rules it satisfies:

```
/flanders-plan
```

4. **Build it** with `implement` — Flanders works each task with the worker AI, gates every result through build, test, and adversarial review, and lands one commit per accepted task:

```sh
flanders implement
```

When it finishes, the contracts are honored by code: a calculator that multiplies and subtracts and nothing else, in teal, white, and slate, built on the framework your rule pinned.

5. **Tweak it later** with the shortcut — a small change that doesn't need a whole plan:

```
/flanders-work make the result panel use a larger font
```

If you really want the font to be kept at that size, just save the spec, and no future work will ever break that specification:

```
/flanders-spec make the result panel use a larger font
```
```
/flanders-work
```