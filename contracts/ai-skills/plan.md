# `/flanders-plan` Skill Contract

## Purpose
Produce a single, ordered, contract-aware work plan that, when implemented, satisfies a user-supplied request without violating any existing contract. The skill runs inside the user's own Claude Code session and writes the plan file directly into the user's project.

## Provisioning
The skill becomes available only after the user runs `npx flanders install` (see `cli-commands/install.md`).

## Invocation
The user invokes the skill from inside a Claude Code session as:

    /flanders-plan [<data>]

The optional `<data>` argument follows the same rule as `/flanders-contract`:
- Omitted: the skill takes the user's natural-language request inline from the conversation.
- Supplied and resolves to an existing file path: read and used as input.
- Supplied and does not resolve to an existing file: used verbatim as inline input.

## Behavior
1. Recursively list every file inside the project's `contracts/` folder and every file inside the project's `rules/` folder. The listing captures the relative path of each file (relative to the project root). The contracts listing is the canonical reference of contracts for this run; the rules listing is the canonical reference of rules for this run.
2. Resolve the input from the invocation rule above.
3. Produce exactly one markdown file inside the project's `plans/` folder:
   - The file content follows the plan file format defined in `shared/plan-file-format.md`.
   - The filename is descriptive of the plan's subject.
4. After writing the plan file, re-read it and verify in chat:
   - The file exists at the expected path inside `plans/` and is non-empty.
   - Every leaf task line follows the shape defined in `shared/plan-file-format.md` — a valid `[ ]` or `[x]` checkbox (no malformed variants such as `[]`, `[ x]`, or `[X ]`) immediately followed by a metrics object literally equal to `{"it":0,"ot":0,"t":0}`.
   - At least one task line was produced.
   If any check fails, the skill fixes the file and re-verifies, instead of leaving a malformed plan on disk.
5. After successful verification, the skill prints a summary in chat, containing:
   - The plan file path.
   - The plan file's character size (number of bytes or characters in the file).
   - The plan file's total line count.
   - The total number of detected tasks.

## Plan content rules
- The skill's sole deliverable is the plan markdown file. The skill must not write, modify, or delete any source code or any file outside `plans/`. The same prohibition extends to the plan's task content: no task the skill writes may describe work that creates, modifies, deletes, or renames files inside `contracts/`, `rules/`, or `plans/` (with the bounded checkbox/metrics exception that the `implement` command holds, not the worker). Both constraints — the skill's own write boundary and the immovability that applies to the tasks it generates — are pinned in `shared/spec-folder-write-authority.md`.
- Order tasks top-to-bottom in the order they must be implemented, accounting for dependencies between them. A task that depends on another must appear after the task it depends on.
- Write each task with a detailed description and explicit acceptance criteria — the conditions that must be true once the task is implemented for it to be considered complete.
- Choose a granularity that is neither too broad nor too narrow. Tasks must be small enough to be tackled by a single AI invocation without burning excessive tokens, but large enough that splitting them further would create artificial fragmentation. When in doubt, subdivide a broad task into sub-tasks rather than leaving it broad.
- For every leaf task, link the relevant contract file or files by their listed relative path. When the relevant obligation lives in a specific section or line range of a contract, reference that section or line range as well.
- For every leaf task, link the relevant rule file or files by their listed relative path. The planner MUST read every rule file it determines is relevant to the request before drafting the plan; reading the relevant rules is not optional. When a rule's enforcement is bound to a specific scope, reference that scope alongside the file path.
- Number tasks hierarchically (`1`, `1.1`, `1.2`, `2`, `2.1`, ...) per `shared/plan-file-format.md`.
- Never produce a plan that violates any contract or rule on the canonical lists.

## Output language
The plan file is written in the same natural language as the input request, unless the user says otherwise.

## Missing contracts or rules
If the `contracts/` folder is missing or empty, the skill warns the user in chat and produces a plan that includes whatever contracts the request implicitly requires before any implementation work. If the `rules/` folder is missing or empty, the skill warns the user in chat and proceeds without rule references on the resulting tasks.
