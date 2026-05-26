# `/flanders-spec` Skill Contract

## Purpose
Translate a free-form request into the project's spec files — contracts, rules, or both. The skill classifies each obligation in the request by its nature and writes it to the folder that fits: public, user-visible obligations go to `contracts/`; internal implementation conventions go to `rules/`. When a request carries both kinds of obligation, the skill writes to both folders in the same invocation. The skill runs inside the user's own AI-tool session and writes the resulting files directly into the user's project.

`/flanders-spec` is the single entry point for authoring contracts and rules.

## Provisioning
The skill becomes available only after the user runs `npx flanders install` (see `cli-commands/install.md`). The skill is installed for each AI tool the user picked at install time (Claude Code, Codex CLI, or both). The invocation form below is the same regardless of which AI tool the user is invoking it from.

## Invocation
The user invokes the skill from inside an AI-tool session as:

    /flanders-spec [<data>]

The optional `<data>` argument is interpreted as follows:
- If `<data>` is omitted, the skill takes the user's natural-language request from the same turn or from subsequent turns of the conversation. No argument parsing happens.
- If `<data>` is supplied and resolves to an existing file path, the file's content is read and used as the input.
- If `<data>` is supplied and does not resolve to an existing file path, the value is used verbatim as the inline input.

## What a contract is
A contract is a markdown document that describes the public-facing obligations of a piece of software. It captures what a user of that software will see, do, and rely on. Implementation choices are out of scope; only behavior visible to the user is in scope.

Contracts are the most public surface of the project. Once written, they are immovable — see `shared/spec-folder-write-authority.md` for the full write-authority obligation that applies to `contracts/`.

## What a rule is
A rule is a markdown document that captures a single, atomic piece of implementation guidance — a constraint, convention, or pattern that the project's code must follow. Each rule file describes exactly one rule. Examples: "use library X", "100% test coverage for this kind of code", "no production dependencies without asking", "use a mocking context whenever the class accesses something it does not own", "follow the dispose pattern", "apply SOLID".

Bundles of related rules (for example, the multiple obligations that make up SOLID, or the dispose pattern) are modeled as a subfolder under `rules/` containing one file per atomic rule inside, never as a single multi-rule file.

The namespace of a rule is its relative path inside `rules/` — the combination of its enclosing subfolders and its filename. The namespace is what downstream tooling uses to organize, filter, and reference rules.

Rules are immovable once written — see `shared/spec-folder-write-authority.md` for the full write-authority obligation that applies to `rules/`.

## Contract vs rule: how the skill classifies
For every obligation in the request, the skill decides whether it is a contract or a rule using the distinction above: an obligation that describes public, user-visible behavior of the product is a contract and is written to `contracts/`; an obligation that constrains how the project's code is written is a rule and is written to `rules/`. A single request may carry both kinds; the skill writes each to its proper folder in the same invocation. The classification is the skill's own decision, not a question put to the user — the user reviews and approves it in the drafting phase before anything is persisted.

## Behavior
The skill's sole deliverable is one or more markdown files inside the project's `contracts/` and `rules/` folders. The skill must not write, modify, or delete any source code or any file outside `contracts/` and `rules/`.

1. Resolve the input from the invocation rule above.
2. The spec files are written against the state of the project's `contracts/` and `rules/` folders as they exist at invocation. That state is the canonical reference for the run; when a folder does not exist or is empty, its canonical reference is empty.
3. **Clarification phase.** Whenever the request leaves an obligation ambiguous, leaves a UI or logic decision unspecified, leaves a rule or its scope of enforcement unspecified, or admits multiple valid interpretations, the skill asks the user clarifying questions sequentially — one question per turn, multiple-choice preferred when the answer space is bounded. When two or three substantially different approaches would all satisfy the request, the skill presents those approaches with a short trade-off summary for each and asks the user to pick or redirect, instead of silently choosing one.
4. **Drafting phase.** Before persisting any file, the skill presents the planned file layout — which files will exist, which fall under `contracts/` and which under `rules/` (the classification made visible), and the key obligations of each file — as a structured summary, and waits for user approval or redirection. Once the layout is approved, the skill persists every resulting file in a single batch without any further per-file or per-section confirmation step.
5. After approval, the skill persists the files. When the request relates to obligations already covered by existing files, those files are updated rather than duplicated; new files are created only for obligations not already covered. No obligation is duplicated across files, whether within a folder or across the two folders.
6. Files are organized in whichever shape best fits the content:
   - In `contracts/`: a single descriptive file when the product is small; multiple files when the product has clearly separable concerns (for example, a logic file and a UI file); subfolders grouping related files when the product has multiple sections (for example, one folder per major feature).
   - In `rules/`: one file per atomic rule. Subfolders group thematically related rules (for example, a `testing/` subfolder for testing rules, a `dependencies/` subfolder for dependency-management rules, a `solid/` subfolder with one file per SOLID principle). A bundle of related rules MUST be modeled as a subfolder of single-rule files, never as one multi-rule file.
7. Filenames must be descriptive of their content — the user must be able to tell what each contract file covers, and which single rule each rule file pins, from the name alone.
8. **Post-write validation.** Before declaring complete, the skill runs the post-write validation gate per `ai-skills/post-write-validation.md`. If the gate fails, the skill follows the triage-then-fix loop defined there — re-entering this contract's clarification phase for any issue that closes a previously-unresolved ambiguity in this contract's clarification scope, and fixing the rest in place — and surfaces the final failure to the user if the bounded loop exhausts.

## Output language
Spec files are written in the same natural language as the input request. If the input is in Spanish, the output is in Spanish; if English, English; and so on. The skill does not translate, unless the user says otherwise.

## Idempotency and overwrites
Existing files in `contracts/` and `rules/` are not protected by the skill. Re-running the skill with input related to existing obligations modifies those files rather than creating parallel duplicates. The skill does not guarantee deterministic file naming or layout across runs with unrelated input. Preserving prior versions of spec files is the user's responsibility, typically through version control.
