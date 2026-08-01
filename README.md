# Flanders

Hi-diddly-ho, neighbor! Flanders is a Node.js toolkit for keeping AI-assisted work aligned with the specifications you choose. It helps you author a spec corpus, derive an ordered plan, and implement each task through build, test, adversarial review, and commit gates.

## Contents

- [How it works](#how-it-works)
- [Requirements](#requirements)
- [Installation](#installation)
- [Updating](#updating)
- [Configuration](#configuration)
- [Usage](#usage)
- [A worked example](#a-worked-example)
- [Hard stop](#hard-stop)

## How it works

The usual cycle is **spec → plan → implement**:

1. From inside an AI coding session, invoke `/flanders-spec` to capture the project's obligations and conventions.
2. From inside an AI coding session, invoke `/flanders-plan` to turn the request and spec corpus into an ordered plan under `plans/`.
3. From the Flanders CLI, run `npx flanders implement` to execute the plan one task at a time.

For a small, self-contained change, invoke `/flanders-implement` from inside an AI coding session instead. It skips the plan and runs one request through the same task cycle.

At the start of a run, Flanders detects the project's build and test commands; a command it cannot determine confidently is skipped. For each task, it launches the configured worker, runs build then test, runs the configured adversarial reviewers concurrently, and commits the accepted result. Failed gates brief the next iteration, and reviewers judge the worker's changes against the task and every applicable obligation.

I'm not gonna lie, it is token hungry: the AI may iterate and validate several times to prevent specification drift. When an AI session reaches a rate limit, Flanders retries it periodically and resumes as soon as it recovers. During a CLI `implement` run, you can also press `F5` to retry rate-limited jobs manually.

The spec corpus can contain `.spec` folders at the project root or deeper in the tree; ignored `.spec` folders are not part of the corpus. Each folder scopes its containing directory and everything below it:

- `.spec/contracts` holds behavior visible across that scope's boundary.
- `.spec/rules` holds implementation conventions internal to that scope.
- `.spec/flanders` holds behavior rules for Flanders commands and skills working in that scope.
- The project-root `plans/` folder holds project-wide work plans.

`/flanders-spec` is the entry point for authoring contracts, rules, and behavior rules, while `/flanders-plan` authors plans. Workers and reviewers may read those files but do not edit them; the CLI's bounded plan-file changes are described in [Implementing a plan](#implementing-a-plan).

Flanders enforces the practices you put in the corpus. Whether SOLID, a duplication policy, a style guide, or another design, architecture, or code-quality practice governs the project is your decision; Flanders supplies none of its own. Its one built-in discipline is for source comments: workers first make the code express its meaning and reserve comments for constraints, invariants, or consequences the code cannot express.

## Requirements

- Node.js.
- Claude Code or OpenAI Codex CLI.
- Git on `PATH` and a git working tree when running `implement` or `/flanders-implement`.
- A logged-in session for every configured AI tool.

The CLI `implement` command also requires every spec file to be committed and every unstaged change outside the selected plan to be staged or committed before it starts. Staged non-spec changes are allowed and join the first accepted task's commit.

## Installation

Install the package from a shell with npm:

```sh
npm install --global flanders
```

Then run setup from the Flanders CLI:

```sh
npx flanders install
```

With no flags, `install` asks for the skills tool or tools, installation scope, worker, and one or more reviewers. Each worker and reviewer has its own tool, model, effort, and optional Claude fast-mode setting, which is off by default. With multiple reviewers, setup also collects the minimum number that must reach a verdict and which reviewers may be abandoned if they are still rate-limited after the round can complete. By default every reviewer is required.

The two mutually exclusive scopes are:

| Flag | Skills | Configuration |
| --- | --- | --- |
| `--project` | `.claude/skills/` and/or `.agents/skills/` in the current project | `.flanders/` at the project root |
| `--global` | `~/.claude/skills/` and/or `~/.agents/skills/` | `~/.flanders/` |

For every selected AI tool, `install` writes the `/flanders-spec`, `/flanders-plan`, `/flanders-implement`, and `/flanders-hard-stop-review` skill artifacts. Selecting both tools installs the full set for each.

### Flags

Every setup answer has a flag equivalent. Omit any flag and `install` asks for that answer interactively.

| Flag | Meaning |
| --- | --- |
| `--project`, `--global` | Choose one installation scope. |
| `--skills-tool=<claude\|codex\|claude,codex>` | Install skills for one or both supported tools. Values must be distinct. |
| `--worker-tool=<claude\|codex>` | Select the worker tool. |
| `--worker-model=<value>` | Select the worker model; an empty value uses the tool's configured default. |
| `--worker-effort=<value>` | Select the worker effort; an empty value uses the tool's configured default. |
| `--worker-fast` | Enable higher-speed, higher-cost fast mode for a Claude worker whose model supports it. |
| `--reviewer-tool=<claude\|codex>` | Select reviewer 1's tool. |
| `--reviewer-model=<value>` | Select reviewer 1's model; an empty value uses the tool's configured default. |
| `--reviewer-effort=<value>` | Select reviewer 1's effort; an empty value uses the tool's configured default. |
| `--reviewer-fast` | Enable fast mode for reviewer 1 when it uses a supported Claude model. |
| `--reviewer-N-tool=<claude\|codex>` | Select reviewer `N`'s tool, for `N` starting at 2. |
| `--reviewer-N-model=<value>` | Select reviewer `N`'s model; an empty value uses the tool's configured default. |
| `--reviewer-N-effort=<value>` | Select reviewer `N`'s effort; an empty value uses the tool's configured default. |
| `--reviewer-N-fast` | Enable fast mode for reviewer `N` when it uses a supported Claude model. |
| `--reviewer-optional`, `--reviewer-N-optional` | Mark a configured reviewer optional. |
| `--reviewer-minimum=<value>` | Require an integer from `1` through the configured reviewer count to reach a verdict. |

Reviewer tool, model, and effort flags establish an ordered, contiguous reviewer list starting with reviewer 1. Supplying any of them fixes the list to the indices supplied; fast and optional flags only annotate reviewers already in that list. Weighted-review flags require at least two reviewers, and no reviewer may be optional when the minimum equals the reviewer count. Tool values are restricted to the supported names; model and effort values are accepted verbatim. Fast flags are valid only for Claude roles whose selected model supports fast mode.

If the chosen scope already has readable configuration, `install` uses its worker and reviewer choices as the interactive defaults. Missing, malformed, or unreadable existing configuration falls back to fresh defaults and is replaced by a completed run.

Existing skills and configuration at the destination are overwritten without a prompt or backup. On success, `install` prints every file it wrote.

## Updating

After upgrading the package, refresh installed skills from the Flanders CLI with:

```sh
npx flanders update
```

`update` takes no flags. It checks every project and global Claude Code and Codex CLI skill destination; wherever it finds at least one Flanders skill, it overwrites the full four-skill set with the current version without a prompt or backup. It does not create a new installation, and it neither reads nor changes `.flanders/` configuration. On success it prints every skill file written; if it finds no installation, it exits with a diagnostic directing you to `install`.

## Configuration

`install` persists the configured worker and ordered reviewer list, including each role's tool, model, effort, fast-mode setting, reviewer optionality, and the minimum reviewer count. The skills-tool choice is used only during installation and is not stored.

When Flanders runs, project configuration takes precedence over global configuration as a complete unit: if the project has `.flanders/`, Flanders uses it alone; otherwise it uses `~/.flanders/`. The two scopes are never merged. Malformed selected configuration is an error; if neither scope has configuration, `implement` and `/flanders-implement` stop and direct you to `npx flanders install`.

## Usage

Flanders has three CLI commands—`install`, `update`, and `implement [plan]`—and four skills invoked from inside an AI coding session.

### The four skills

The slash forms below name the skills. Invoke each through the skill mechanism provided by Claude Code or Codex CLI; the exact token the tool expects may differ.

```text
/flanders-spec [<data>]
/flanders-plan [<data>]
/flanders-implement [<data>]
/flanders-hard-stop-review [<data>]
```

For `/flanders-spec`, `/flanders-plan`, and `/flanders-implement`, `<data>` is the request. Omit it to use the conversation, supply an existing file path to use that file's contents, or supply other text to use it verbatim. For `/flanders-hard-stop-review`, `<data>` is the preserved hard-stop folder path; omit it when the path is already in the conversation.

Skills address you in the language of your latest message when it is determinable, adding the light Flanders touch only in English. For a path-only hard-stop review, the skill falls back to the plan and then the spec corpus for that language. When skills have independent clarification questions, they ask them together; bounded choices use the AI tool's question facility when available. Any report owed before a question is delivered first.

- **`/flanders-spec`** classifies a request into contracts, rules, and behavior rules across the appropriate `.spec` scopes. It asks about unresolved obligations, shows the planned file layout and the effect of changed obligations for approval, writes only after approval, and validates the files it changed. It updates existing coverage instead of duplicating it, then offers `/flanders-plan`, `/flanders-implement`, or neither. When it changes project-root public contracts, it warns that the README may need reconciliation. Written specs use an explicitly requested language, otherwise the existing corpus language, otherwise the request language.
- **`/flanders-plan`** creates exactly one ordered, specification-aware markdown plan in `plans/`, with complete leaf tasks, acceptance criteria, and markdown links to applicable contracts and rules. It asks only about observable outcomes, scope ambiguities, or unverified runtime premises that the plan cannot reasonably resolve. It writes without a pre-write approval step, validates its output, reports the plan path, and tells you to implement it from the Flanders CLI. The plan uses the request's language unless you ask otherwise.
- **`/flanders-implement`** follows the shortcut path introduced in [How it works](#how-it-works). It first commits pending spec changes; other inherited changes remain in place and are included in the accepted-work commit. On success it reports what was implemented; its hard-stop behavior is covered in [Hard stop](#hard-stop).
- **`/flanders-hard-stop-review`** is the read-only recovery skill described in [Hard stop](#hard-stop).

### Implementing a plan

Run from the Flanders CLI:

```sh
npx flanders implement [plan]
```

`[plan]`, when supplied, is a markdown file under `plans/`. Leave it off and Flanders runs the single plan in `plans/`, or asks which one to run when `plans/` holds more than one. An empty `plans/` folder, or a selected plan that is missing, empty, or malformed, produces a startup diagnostic; a plan whose tasks are already complete exits successfully without running a task.

Before work begins, `implement` validates the plan and checks the git requirements under [Requirements](#requirements). Once the plan is selected, the run asks no further questions. It streams the worker, build, test, and reviewer output while showing live task and plan progress.

Each open task runs through the cycle described in [How it works](#how-it-works), with up to five iterations. An accepted task has its checkbox and metrics updated and is committed with its plan number and title. Completing the last task prefixes the plan filename with `V-`. A hard stop follows the recovery path in [Hard stop](#hard-stop).

### A typical workflow

1. From the Flanders CLI, run `npx flanders install` to configure Flanders and install its skills.
2. From inside an AI coding session, invoke `/flanders-spec` with the project's obligations and conventions.
3. From inside an AI coding session, invoke `/flanders-plan` with the work to plan.
4. From the Flanders CLI, run `npx flanders implement` against that plan.

For small work, replace steps 3 and 4 by invoking `/flanders-implement` from inside the AI coding session.

## A worked example

Here is the same path for a calculator that only multiplies and subtracts, neighbor:

1. From the Flanders CLI, install project-scoped skills and configuration:

   ```sh
   npx flanders install --project
   ```

2. From inside an AI coding session, invoke the spec skill with the requirement:

   ```text
   /flanders-spec A web calculator with exactly two operations—multiply and subtract—over two number inputs, showing the result. Use teal operation buttons, a white result panel, a slate background, and React bundled by Vite with no other UI framework.
   ```

3. In the same AI coding session, invoke the planning skill after the spec is approved and validated:

   ```text
   /flanders-plan
   ```

4. From the Flanders CLI, implement the resulting plan:

   ```sh
   npx flanders implement
   ```

5. For a later small change, invoke `/flanders-spec` from inside an AI coding session to add `make the result panel use a larger font`, then accept its offer to launch `/flanders-implement` in that session.

## Hard stop

When a hard stop happens, hand the preserved folder path that `implement` prints to the `/flanders-hard-stop-review` skill from inside an AI coding session. A hard stop ends the run with a non-zero status and occurs for one of three causes:

- A task exceeds the fixed limit of five iterations.
- The worker declares that the task is structurally impossible within the work and obligations it was given.
- A configured AI tool reports that it is not logged in.

For a task stop, `implement` identifies the plan line and task title; for a worker-declared stop, it also reports the worker's cause, evidence, and proposed unblocking change. A login stop instead tells you which configured tool needs a login and asks you to re-run. The temporary folder is preserved so it can be inspected.

`/flanders-hard-stop-review` reads the folder, the affected plan task, and its specs, then reports the root cause and recommends re-running unchanged, revising the plan through `/flanders-plan`, fixing the spec through `/flanders-spec`, or combining those actions. It can offer to launch the appropriate skill, but it does not re-run the Flanders CLI itself.

`/flanders-implement` uses the same hard-stop causes for its one-request cycle. It diagnoses iteration-cap and worker-declared stops in the same invocation and offers the appropriate next skill; a login failure is reported without diagnosis. Its temporary folder is preserved on every hard stop.
