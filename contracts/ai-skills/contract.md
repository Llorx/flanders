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
2. Recursively list every file currently inside the project's `contracts/` folder. The listing captures the relative path of each file (relative to the project root). When the folder does not exist or is empty, the listing is empty.
3. Run the **clarification phase** before writing anything to disk:
   - Pick the files relevant to the request from the listing and read their content to understand the project context. The listing is exhaustive — do not enumerate files in any other way.
   - Ask the user clarifying questions sequentially — one question per turn — whenever the request leaves an obligation ambiguous, leaves a UI or logic decision unspecified, or admits multiple valid interpretations. Do not bundle several questions in one turn.
   - Prefer multiple-choice questions when the answer space is bounded. Open-ended questions are used only when multiple-choice would force a false dichotomy.
   - When two or three substantially different approaches would all satisfy the request, present those approaches with a short trade-off summary for each and ask the user to pick or redirect, instead of silently choosing one.
   - The clarification phase ends only when the skill has enough information to draft contract files that contain no placeholders, no contradictions, and no scope ambiguity.
4. Run the **drafting phase**. Before persisting any file:
   - Present the planned file layout (which files will exist, what each file will cover) and the key obligations of each file as a structured summary, and wait for user approval or redirection.
   - For non-trivial requests, present the draft of each file (or each section, when a file is large) and wait for approval before moving on. Trivial requests may be presented as a single combined draft.
   - Update related existing contract files in place when the request affects obligations they already cover, and create new files only for obligations not already covered. Do not duplicate an existing obligation across files.
5. After approval, run the **self-review pass** before finalizing each file: re-read the draft and check for placeholders left behind, contradictions with other contract files, ambiguous wording, and scope that drifted beyond what the user requested. Any issue is fixed in place; if a fix would change the meaning of an already-approved obligation, surface the issue to the user and ask before applying it.
6. Organize the resulting files in whichever shape best fits the requested product:
   - A single descriptive file when the product is small.
   - Multiple files inside `contracts/` when the product has clearly separable concerns (for example, a logic file and a UI file).
   - Subfolders grouping related files when the product has multiple sections (for example, one folder per major feature, with logic and UI files inside, plus any other concerns that are neither logic nor UI).
7. Filenames must be descriptive of their content — the user must be able to tell what each file covers from its name alone.

## Output language
Contract files are written in the same natural language as the input request. If the input is in Spanish, the output is in Spanish; if English, English; and so on. The skill does not translate, unless the user says otherwise.

## Idempotency and overwrites
Existing files in `contracts/` are not protected by the skill. Because the skill receives the current state of the folder and is asked to update related files in place, re-running with related input will modify those files rather than create parallel duplicates. The skill does not guarantee deterministic file naming or layout across runs with unrelated input. Preserving prior versions of contract files is the user's responsibility, typically through version control.
