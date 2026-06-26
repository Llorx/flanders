# `/flanders-spec` Skill Contract

## Purpose
Translate a free-form request into the project's spec files — contracts, rules, behavior rules, or any combination. The skill classifies each obligation in the request by its nature and writes it to the folder that fits: public obligations across a scope's boundary go to that scope's `.spec/contracts` folder; internal implementation conventions go to its `.spec/rules` folder; obligations that govern how Flanders' own commands and skills behave within a scope go to that scope's `.spec/flanders` folder (see [.spec/contracts/shared/flanders-behavior-rules.md](/.spec/contracts/shared/flanders-behavior-rules.md)). When a request carries more than one kind of obligation, the skill writes to each in the same invocation. The skill runs inside the user's own AI-tool session and writes the resulting files directly into the user's project. The `.spec` layout and the scope-relative meaning of contract versus rule are pinned in [.spec/contracts/shared/spec-folder-layout.md](/.spec/contracts/shared/spec-folder-layout.md).

`/flanders-spec` is the single entry point for authoring contracts, rules, and behavior rules.

## Provisioning
The skill becomes available only after the user runs `npx flanders install` (see [.spec/contracts/cli-commands/install.md](/.spec/contracts/cli-commands/install.md)). The skill is installed for each AI tool the user picked at install time (Claude Code, Codex CLI, Antigravity CLI, or any combination). The invocation form below is the same regardless of which AI tool the user is invoking it from.

## Invocation
The user invokes the skill from inside an AI-tool session as:

    /flanders-spec [<data>]

The optional `<data>` argument is interpreted as follows:
- If `<data>` is omitted, the skill takes the user's natural-language request from the same turn or from subsequent turns of the conversation. No argument parsing happens.
- If `<data>` is supplied and resolves to an existing file path, the file's content is read and used as the input.
- If `<data>` is supplied and does not resolve to an existing file path, the value is used verbatim as the inline input.

## What a contract is
A contract is a markdown document that describes the public behavior of the directory its `.spec` folder scopes — the behavior code outside that directory relies on. It describes that boundary behavior abstractly: it never names internal symbols, internal data shapes, or paths inside a source directory. At the project-root `.spec` folder the boundary is the whole project, so its contracts capture what the end user sees, does, and relies on. The scope-relative meaning of a contract is pinned in [.spec/contracts/shared/spec-folder-layout.md](/.spec/contracts/shared/spec-folder-layout.md).

Contracts are the public surface of the scope they belong to. Once written, they are immovable — see [.spec/contracts/shared/spec-folder-write-authority.md](/.spec/contracts/shared/spec-folder-write-authority.md) for the full write-authority obligation that applies to contracts.

## What a rule is
A rule is a markdown document that captures a single, atomic piece of implementation guidance internal to the directory its `.spec` folder scopes — a constraint, convention, or pattern that the directory's code must follow. Each rule is a single atomic obligation; a rule file holds one rule on its own, or several related rules as discrete atomic sections. Examples: "use library X", "100% test coverage for this kind of code", "no production dependencies without asking", "use a mocking context whenever the class accesses something it does not own", "follow the dispose pattern", "apply SOLID".

Bundles of related rules (for example, the multiple obligations that make up SOLID, or the dispose pattern) are modeled either as a subfolder under the scope's `.spec/rules` folder containing one file per atomic rule, or as a single file that groups those related rules as discrete atomic sections. The atomic unit is the rule, not the file; both shapes keep every rule atomic.

The namespace of a rule is its path relative to the project root, as pinned in [.spec/contracts/shared/spec-folder-layout.md](/.spec/contracts/shared/spec-folder-layout.md). The namespace is what downstream tooling uses to organize, filter, and reference rules.

Rules are immovable once written — see [.spec/contracts/shared/spec-folder-write-authority.md](/.spec/contracts/shared/spec-folder-write-authority.md) for the full write-authority obligation that applies to rules.

## What a behavior rule is
A behavior rule is a markdown document that governs how Flanders' own commands and skills behave when they work in the project — how they name, place, organize, or otherwise produce the files and changes they author — as distinct from contracts and rules, which describe the host project's own code. Behavior rules live in `.spec/flanders` folders and are read and honored by every Flanders command and skill whose work their scope encloses, per [.spec/contracts/shared/flanders-behavior-rules.md](/.spec/contracts/shared/flanders-behavior-rules.md).

Behavior rules are immovable once written — see [.spec/contracts/shared/spec-folder-write-authority.md](/.spec/contracts/shared/spec-folder-write-authority.md) for the full write-authority obligation that applies to behavior rules.

## Contract, rule, or behavior rule: how the skill classifies and places
For every obligation in the request, the skill decides whether it is a contract, a rule, or a behavior rule using the distinctions above — public behavior across a scope's boundary is a contract; implementation guidance internal to a scope is a rule; guidance that governs how Flanders' own commands and skills behave within a scope is a behavior rule — and it decides which `.spec` folder the spec belongs to, per the placement rule in [.spec/contracts/shared/spec-folder-layout.md](/.spec/contracts/shared/spec-folder-layout.md). A contract is written to the chosen scope's `.spec/contracts` folder; a rule is written to its `.spec/rules` folder; a behavior rule is written to its `.spec/flanders` folder. A single request may carry more than one kind and may span several scopes; the skill writes each spec to its proper `.spec` folder in the same invocation. The classification and placement are the skill's own decisions, not questions put to the user — the user reviews and approves them in the drafting phase before anything is persisted.

## Behavior
The skill's sole deliverable is one or more markdown files inside the project's `.spec/contracts`, `.spec/rules`, and `.spec/flanders` folders. The skill must not write, modify, or delete any source code or any file outside the project's `.spec/contracts`, `.spec/rules`, and `.spec/flanders` folders.

1. Resolve the input from the invocation rule above.
2. The spec files are written against the state of the project's contracts and rules as they exist at invocation — every contract under a `.spec/contracts` folder and every rule under a `.spec/rules` folder, discovered across the whole project tree. That state is the canonical reference for the run; when no `.spec` folder exists yet, the canonical reference is empty.
3. **Clarification phase.** Whenever the request leaves an obligation ambiguous, leaves a UI or logic decision unspecified, leaves a rule or its scope of enforcement unspecified, or admits multiple valid interpretations, the skill asks the user clarifying questions following the cadence pinned in [.spec/contracts/ai-skills/clarification-question-cadence.md](/.spec/contracts/ai-skills/clarification-question-cadence.md). When two or three substantially different approaches would all satisfy the request, the skill presents those approaches with a short trade-off summary for each and asks the user to pick or redirect, instead of silently choosing one.
4. **Drafting phase.** Before persisting any file, the skill presents the planned file layout — which files will exist, which `.spec` folder each falls in, which are contracts and which are rules (the classification and placement made visible), and the key obligations of each file — as a structured summary, and waits for user approval or redirection. Once the layout is approved, the skill persists every resulting file in a single batch without any further per-file or per-section confirmation step.
5. After approval, the skill persists the files. When the request relates to obligations already covered by existing files, those files are updated rather than duplicated; new files are created only for obligations not already covered. No obligation is duplicated across files, whether within a folder or across the two folders.
6. Files are organized in whichever shape best fits the content:
   - Within a `.spec/contracts` folder: a single descriptive file when the scope is small; multiple files when the scope has clearly separable concerns (for example, a logic file and a UI file); subfolders grouping related files when the scope has multiple sections (for example, one folder per major feature).
   - Within a `.spec/rules` folder: the rule is the atomic unit, not the file. A standalone file holds one isolated rule; a single file groups a cluster of related rules as discrete atomic sections; and a subfolder holds a file per rule (or per sub-cluster) when the scope spans several distinct clusters (for example, a `testing/` subfolder for testing rules, a `dependencies/` subfolder for dependency-management rules, a `solid/` subfolder for the SOLID principles). A subfolder of single-rule files and a single file grouping related rules as sections are both valid; each rule stays atomic in either shape.
7. Filenames must be descriptive of their content — the user must be able to tell what each contract file covers, and which rule or cluster of related rules each rule file pins, from the name alone.
8. **Post-write validation.** Before declaring complete, the skill runs the post-write validation gate per [.spec/contracts/ai-skills/post-write-validation.md](/.spec/contracts/ai-skills/post-write-validation.md). If the gate fails, the skill follows the triage-then-fix loop defined there — re-entering this contract's clarification phase for any issue that closes a previously-unresolved ambiguity in this contract's clarification scope, and fixing the rest in place — and surfaces the final failure to the user if the bounded loop exhausts.

## Recommending and launching the next step
Once the skill has completed its deliverable — the spec files persisted and the post-write validation gate passed — it offers to continue into the next step in the same session. The offer is made only on successful completion: when the post-write validation loop exhausts without the skill declaring complete, the skill surfaces the failure and makes no such offer.

The skill asks the user which skill to launch next: `/flanders-plan`, `/flanders-work`, or neither. It recommends one of them based on the implementation effort the spec just written implies — it recommends `/flanders-work` when the spec describes a single, small, self-contained change, and `/flanders-plan` when the spec describes larger work that spans multiple obligations or scopes or requires an ordered, multi-step implementation. The user accepts the recommendation, chooses the other skill, or declines.

When the user chooses `/flanders-plan` (see [.spec/contracts/ai-skills/plan-skill.md](/.spec/contracts/ai-skills/plan-skill.md)) or `/flanders-work` (see [.spec/contracts/ai-skills/work-skill.md](/.spec/contracts/ai-skills/work-skill.md)), the skill launches it by invoking it in the same session with no `<data>` argument, so the launched skill takes its input from the conversation — the original request together with the spec just written. The run then proceeds under the chosen skill's own contract; the launch leaves `/flanders-spec`'s own deliverable and write boundary unchanged, so the skill itself writes only this run's spec files and never code or a plan file. When the user declines, the skill ends.

## Output language
The natural language a spec file is written in is resolved in priority order:
1. The language the request explicitly asks the skill to write in, when the request states one.
2. Otherwise, the language of the project's existing spec files: when at least one contract or rule file already exists, the skill writes in that corpus's language, determined by inspecting a single existing spec file — reading more than one is unnecessary, as the corpus is kept in one language.
3. Otherwise — when the request names no language and no spec file exists yet — the language the request itself is written in.

The skill does not translate already-written content; the resolved language governs only the content the skill authors in this run.

## Interaction language
The natural language the skill converses in with the user — its clarifying questions, the approach trade-off summaries, the drafting-phase layout summary, and every other message it prints in chat — is resolved independently of the Output language above and is pinned by [.spec/contracts/ai-skills/interaction-language.md](/.spec/contracts/ai-skills/interaction-language.md).

## Idempotency and overwrites
Existing files in the project's `.spec/contracts`, `.spec/rules`, and `.spec/flanders` folders are not protected by the skill. Re-running the skill with input related to existing obligations modifies those files rather than creating parallel duplicates. The skill does not guarantee deterministic file naming or layout across runs with unrelated input. Preserving prior versions of spec files is the user's responsibility, typically through version control.
