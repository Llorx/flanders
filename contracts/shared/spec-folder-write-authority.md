# Spec Folder — Write Authority

## Purpose
Pin who is authorized to create, modify, or delete files inside the project's spec folders: `contracts/`, `rules/`, and `plans/`. These folders hold the project's source of truth — public obligations (`contracts/`), implementation conventions (`rules/`), and the ordered work the implementer must execute (`plans/`). Authority to change them is restricted to dedicated, user-initiated entry points.

## Authority
- `contracts/` is writable only via the `/flanders-contract` skill (see `ai-skills/contract.md`).
- `rules/` is writable only via the `/flanders-rule` skill (see `ai-skills/rule.md`).
- `plans/` is writable only via the `/flanders-plan` skill (see `ai-skills/plan.md`) — with one bounded exception: the `implement` command may rewrite the checkbox state and the metrics object of an existing task line in an existing plan file as work progresses (see `cli-commands/implement/iteration-loop.md` and `shared/plan-file-format.md`). The `implement` command may not create new plan files, delete existing ones, rename them, or alter any other content inside `plans/`.

No other skill, command, agent, or automated process in this project — including every AI agent that `implement` spawns (worker, reviewer, build/test detect, or any auxiliary agent the implementation rules may add) — may create, modify, delete, or rename any file inside `contracts/`, `rules/`, or `plans/`. A change happens only when the user explicitly invokes the corresponding skill (or, for plans, when `implement` performs its bounded checkbox/metrics update).

## Read access
Reading is unrestricted. Every agent may, and often must, read any contract, rule, or plan file in order to comply with the obligations and conventions those files define.

## Downstream implication
- Plans (`/flanders-plan` output) may describe code work that complies with existing contracts and rules, but may not include tasks that modify them. Modifying a contract or a rule is a separate, user-initiated act performed via the corresponding skill.
- `implement`-spawned agents may consult any contract, rule, or plan file they need but never write to those folders — even when the agent's task description points at one of those files.
