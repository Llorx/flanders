# Spec Folder — Write Authority

## Purpose
Pin who is authorized to create, modify, or delete files inside the project's spec folders: every `.spec/contracts`, `.spec/rules`, and `.spec/flanders` folder in the project tree, and the project-root `plans/` folder. These hold the project's source of truth — public obligations across each scope's boundary (`.spec/contracts`), implementation conventions internal to each scope (`.spec/rules`), the rules that govern Flanders' own command behavior within each scope (`.spec/flanders`), and the ordered work the implementer must execute (`plans/`). The `.spec` layout and scope semantics are pinned in [.spec/contracts/shared/spec-folder-layout.md](/.spec/contracts/shared/spec-folder-layout.md). Authority to change these folders is restricted to dedicated, user-initiated entry points.

## Authority
- Every `.spec/contracts`, `.spec/rules`, and `.spec/flanders` folder is writable only via the `/flanders-spec` skill (see [.spec/contracts/ai-skills/spec-skill.md](/.spec/contracts/ai-skills/spec-skill.md); `.spec/flanders` is additionally governed by [.spec/contracts/shared/flanders-behavior-rules.md](/.spec/contracts/shared/flanders-behavior-rules.md)).
- The project-root `plans/` folder is writable only via the `/flanders-plan` skill (see [.spec/contracts/ai-skills/plan-skill.md](/.spec/contracts/ai-skills/plan-skill.md)) — with bounded exceptions held by the `implement` command: it may rewrite the checkbox state and the metrics object of an existing task line in an existing plan file as work progresses, and it may rename a plan file once, as it finalizes the task that completes the plan, to mark the plan complete (see [.spec/contracts/cli-commands/implement/iteration-loop.md](/.spec/contracts/cli-commands/implement/iteration-loop.md) and [.spec/contracts/shared/plan-file-format.md](/.spec/contracts/shared/plan-file-format.md)). The `implement` command may not create new plan files or delete existing ones, and beyond these bounded writes it does not alter the content inside `plans/`.

No other skill, command, agent, or automated process in this project — including every AI agent that `implement` spawns (worker, reviewer, build/test detect, or any auxiliary agent the implementation rules may add) — may create, modify, delete, or rename any file inside any `.spec/contracts` folder, any `.spec/rules` folder, any `.spec/flanders` folder, or the `plans/` folder. A change happens only when the user explicitly invokes the corresponding skill (or, for plans, when `implement` performs its bounded checkbox/metrics update or its completion rename).

## Read access
Reading is unrestricted. Every agent may, and often must, read any contract, rule, or plan file in order to comply with the obligations and conventions those files define.

## Downstream implication
- Plans (`/flanders-plan` output) may describe code work that complies with existing contracts and rules, but may not include tasks that modify them. Modifying a contract, a rule, or a behavior rule is a separate, user-initiated act performed via the `/flanders-spec` skill.
- `implement`-spawned agents may consult any contract, rule, or plan file they need but never write to those folders — even when the agent's task description points at one of those files.
