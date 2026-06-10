# Spec Folder — Write Authority

## Purpose
Pin who is authorized to create, modify, or delete files inside the project's spec folders: every `.docs/contracts` and `.docs/rules` folder in the project tree, and the project-root `plans/` folder. These hold the project's source of truth — public obligations across each scope's boundary (`.docs/contracts`), implementation conventions internal to each scope (`.docs/rules`), and the ordered work the implementer must execute (`plans/`). The `.docs` layout and scope semantics are pinned in `shared/spec-folder-layout.md`. Authority to change these folders is restricted to dedicated, user-initiated entry points.

## Authority
- Every `.docs/contracts` folder is writable only via the `/flanders-spec` skill (see `ai-skills/spec-skill.md`).
- Every `.docs/rules` folder is writable only via the `/flanders-spec` skill (see `ai-skills/spec-skill.md`).
- The project-root `plans/` folder is writable only via the `/flanders-plan` skill (see `ai-skills/plan-skill.md`) — with one bounded exception: the `implement` command may rewrite the checkbox state and the metrics object of an existing task line in an existing plan file as work progresses (see `cli-commands/implement/iteration-loop.md` and `shared/plan-file-format.md`). The `implement` command may not create new plan files, delete existing ones, rename them, or alter any other content inside `plans/`.

No other skill, command, agent, or automated process in this project — including every AI agent that `implement` spawns (worker, reviewer, build/test detect, or any auxiliary agent the implementation rules may add) — may create, modify, delete, or rename any file inside any `.docs/contracts` folder, any `.docs/rules` folder, or the `plans/` folder. A change happens only when the user explicitly invokes the corresponding skill (or, for plans, when `implement` performs its bounded checkbox/metrics update).

## Read access
Reading is unrestricted. Every agent may, and often must, read any contract, rule, or plan file in order to comply with the obligations and conventions those files define.

## Downstream implication
- Plans (`/flanders-plan` output) may describe code work that complies with existing contracts and rules, but may not include tasks that modify them. Modifying a contract or a rule is a separate, user-initiated act performed via the `/flanders-spec` skill.
- `implement`-spawned agents may consult any contract, rule, or plan file they need but never write to those folders — even when the agent's task description points at one of those files.
