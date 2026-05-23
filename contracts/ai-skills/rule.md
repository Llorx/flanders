# `/flanders-rule` Skill Contract

## Purpose
Translate a free-form description of code-implementation guidance into one or more rule markdown files that capture how code in the project must be written. The skill runs inside the user's own AI-tool session and writes the resulting files directly into the user's project.

Rules differ from contracts: contracts pin public, user-visible obligations of the product, while rules pin internal implementation conventions that the project's code must follow — for example, "use library X", "100% test coverage for this kind of code", "no production dependencies without asking", "use a mocking context whenever the class accesses something it does not own", "follow the dispose pattern", "apply SOLID". Plans and implementations downstream must respect rules just as they respect contracts.

## Provisioning
The skill becomes available only after the user runs `npx flanders install` (see `cli-commands/install.md`). The skill is installed for each AI tool the user picked at install time (Claude Code, Codex CLI, or both). The invocation form below is the same regardless of which AI tool the user is invoking it from.

## Invocation
The user invokes the skill from inside an AI-tool session as:

    /flanders-rule [<data>]

The optional `<data>` argument is interpreted as follows:
- If `<data>` is omitted, the skill takes the user's natural-language request from the same turn or from subsequent turns of the conversation. No argument parsing happens.
- If `<data>` is supplied and resolves to an existing file path, the file's content is read and used as the input.
- If `<data>` is supplied and does not resolve to an existing file path, the value is used verbatim as the inline input.

## What a rule is
A rule is a markdown document that captures a single, atomic piece of implementation guidance — a constraint, convention, or pattern that the project's code must follow. Each rule file describes exactly one rule.

Bundles of related rules (for example, the multiple obligations that make up SOLID, or the dispose pattern) are modeled as a subfolder under `rules/` containing one file per atomic rule inside, never as a single multi-rule file.

The namespace of a rule is its relative path inside `rules/` — the combination of its enclosing subfolders and its filename. The namespace is what downstream tooling uses to organize, filter, and reference rules.

Rules are immovable once written — see `shared/spec-folder-write-authority.md` for the full write-authority obligation that applies to `rules/`.

## Behavior
The skill's sole deliverable is one or more rule markdown files inside the project's `rules/` folder. The skill must not write, modify, or delete any source code or any file outside `rules/`.

1. Resolve the input from the invocation rule above.
2. The rules are written against the state of the project's `rules/` folder as it exists at invocation. That state is the canonical reference for the run; when the folder does not exist or is empty, the canonical reference is empty.
3. **Clarification phase.** Whenever the request leaves a rule ambiguous, leaves the scope of enforcement unspecified, or admits multiple valid interpretations, the skill asks the user clarifying questions sequentially — one question per turn, multiple-choice preferred when the answer space is bounded. When two or three substantially different formulations of a rule would all satisfy the request, the skill presents those formulations with a short trade-off summary for each and asks the user to pick or redirect, instead of silently choosing one.
4. **Drafting phase.** Before persisting any file, the skill presents the planned file layout (which rule files will exist, in which subfolders, and the atomic rule each file captures) as a structured summary, and waits for user approval or redirection. Once the layout is approved, the skill persists every resulting file in a single batch without any further per-file or per-section confirmation step.
5. After approval, the skill persists the rule files. When the request relates to rules already covered by existing files, those files are updated rather than duplicated; new files are created only for rules not already covered. No rule is duplicated across files.
6. Each rule lives in its own file. Subfolders inside `rules/` group thematically related rules (for example, a `testing/` subfolder for testing-related rules, a `dependencies/` subfolder for dependency-management rules, a `solid/` subfolder with one file per SOLID principle, a `disposes/` subfolder with one file per dispose-pattern obligation). A bundle of related rules MUST be modeled as a subfolder of single-rule files, never as one multi-rule file.
7. Filenames must be descriptive of the single rule the file captures — the user must be able to tell which rule a file pins from its name alone.

## Output language
Rule files are written in the same natural language as the input request. If the input is in Spanish, the output is in Spanish; if English, English; and so on. The skill does not translate, unless the user says otherwise.

## Idempotency and overwrites
Existing files in `rules/` are not protected by the skill. Re-running the skill with input related to existing rules modifies those files rather than creating parallel duplicates. The skill does not guarantee deterministic file naming or layout across runs with unrelated input. Preserving prior versions of rule files is the user's responsibility, typically through version control.
