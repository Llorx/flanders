# `/flanders-contract` Skill Contract

## Purpose
Translate a free-form description of a software product into one or more contract markdown files that capture the public, user-visible obligations of that product. The skill runs inside the user's own Claude Code session and writes the resulting files directly into the user's project.

## Provisioning
The skill becomes available only after the user runs `npx flanders install` (see `cli-commands/install.md`).

## Invocation
The user invokes the skill from inside a Claude Code session as:

    /flanders-contract [<data>]

The optional `<data>` argument is interpreted as follows:
- If `<data>` is omitted, the skill takes the user's natural-language request from the same turn or from subsequent turns of the conversation. No argument parsing happens.
- If `<data>` is supplied and resolves to an existing file path, the file's content is read and used as the input.
- If `<data>` is supplied and does not resolve to an existing file path, the value is used verbatim as the inline input.

## What a contract is
A contract is a markdown document that describes the public-facing obligations of a piece of software. It captures what a user of that software will see, do, and rely on. Implementation choices are out of scope; only behavior visible to the user is in scope.

Contracts are the most public surface of the project. Once written, they are immovable — see `shared/spec-folder-write-authority.md` for the full write-authority obligation that applies to `contracts/`.

## Behavior
The skill's sole deliverable is one or more contract markdown files inside the project's `contracts/` folder. The skill must not write, modify, or delete any source code or any file outside `contracts/`.

1. Resolve the input from the invocation rule above.
2. The contracts are written against the state of the project's `contracts/` folder as it exists at invocation. That state is the canonical reference for the run; when the folder does not exist or is empty, the canonical reference is empty.
3. **Clarification phase.** Whenever the request leaves an obligation ambiguous, leaves a UI or logic decision unspecified, or admits multiple valid interpretations, the skill asks the user clarifying questions sequentially — one question per turn, multiple-choice preferred when the answer space is bounded. When two or three substantially different approaches would all satisfy the request, the skill presents those approaches with a short trade-off summary for each and asks the user to pick or redirect, instead of silently choosing one.
4. **Drafting phase.** Before persisting any file, the skill presents the planned file layout (which files will exist, what each file will cover) and the key obligations of each file as a structured summary, and waits for user approval or redirection. Once the layout is approved, the skill persists every resulting file in a single batch without any further per-file or per-section confirmation step.
5. After approval, the skill persists the contract files. When the request relates to obligations already covered by existing files, those files are updated rather than duplicated; new files are created only for obligations not already covered. No obligation is duplicated across files.
6. Resulting files are organized in whichever shape best fits the requested product:
   - A single descriptive file when the product is small.
   - Multiple files inside `contracts/` when the product has clearly separable concerns (for example, a logic file and a UI file).
   - Subfolders grouping related files when the product has multiple sections (for example, one folder per major feature, with logic and UI files inside, plus any other concerns that are neither logic nor UI).
7. Filenames must be descriptive of their content — the user must be able to tell what each file covers from its name alone.

## Output language
Contract files are written in the same natural language as the input request. If the input is in Spanish, the output is in Spanish; if English, English; and so on. The skill does not translate, unless the user says otherwise.

## Idempotency and overwrites
Existing files in `contracts/` are not protected by the skill. Re-running the skill with input related to existing obligations modifies those files rather than creating parallel duplicates. The skill does not guarantee deterministic file naming or layout across runs with unrelated input. Preserving prior versions of contract files is the user's responsibility, typically through version control.
