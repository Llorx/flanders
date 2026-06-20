# /flanders-spec skill rules

## Spec artifacts state only the present spec — the /flanders-spec prompt prohibits past content actively

A contract or rule authored by `/flanders-spec` describes only the present spec: what the software does now and what the code must do now. It never records what the spec used to be, what it replaces, what changed in the run that produced it, or any other historical, transitional, or migration framing. Past facts about the spec's evolution belong in the commit message or pull-request description, not in a permanent spec file. The `/flanders-spec` skill artifact body enforces this as an active prohibition in its own drafting guidance, not solely as a check the post-write validator applies after the fact.

### Who this applies to

- **Subject:** every contract file under a `.spec/contracts` folder, every rule file under a `.spec/rules` folder, and every behavior-rule file under a `.spec/flanders` folder that `/flanders-spec` writes or updates — including flanders' own spec, which `/flanders-spec` authors because the project self-hosts its spec.
- **Subject:** the source content that produces the `/flanders-spec` skill artifact body — the prompt text the `install` command ships — which must carry the active prohibition described under "How to apply".
- **Not subject:** plan files under `plans/` (`/flanders-plan` output), which sequence work and may reference prior state as task context.
- **Not subject:** commit messages, pull-request descriptions, and other non-spec documents — these are the correct home for historical, transitional, and migration notes.

### What counts as past content

Past content is any statement whose subject is the spec's history rather than its current obligations. The following in a contract or rule file are forbidden:

- "Replaces the former X", "supersedes Y", "this used to be Z", "previously W".
- A changelog or summary of what the producing run added, removed, renamed, or merged.
- Migration or transition notes describing how the project moved from an old shape to the current one.
- References to skills, files, or obligations that no longer exist, framed as things the current spec evolved away from.

A spec file reads as if the present shape is simply how things are, with no memory of how it got there.

### How to apply

- The `/flanders-spec` skill artifact body states this prohibition **actively in its drafting guidance** — a direct instruction not to write historical, transitional, or migration content into the contracts and rules it produces — placed where the body tells the skill how to draft, not deferred to the body's final-validation section alone. An obligation surfaced only as a validator check is reactive: the skill writes the past content and is then forced to undo it. The active prohibition stops it being written in the first place.
- When the producing run needs to record that the spec changed — a merge, a rename, a removal — that record goes in the commit message or pull-request description for the change, never in the spec file itself.
- The spec validator additionally gates this obligation, per [src/prompts/.spec/rules/ai/skills/spec.md#the-flanders-spec-validator-audits-each-artifact-by-its-folder-against-the-spec-check-categories](/src/prompts/.spec/rules/ai/skills/spec.md#the-flanders-spec-validator-audits-each-artifact-by-its-folder-against-the-spec-check-categories). The active prohibition and the validator check are complementary, not alternatives.

### Failure signals

- A contract or rule file authored by `/flanders-spec` contains "replaces the former X", a changelog of the run's edits, or any other historical, transitional, or migration framing instead of stating only the present spec.
- The `/flanders-spec` skill artifact body surfaces this obligation only in its final-validation section, with no active prohibition in its drafting guidance.
- A spec file names a skill, file, or obligation that no longer exists, framed as something the current spec evolved away from.

## A spec states behavior; an explicit prohibition is written only when load-bearing

A contract or rule authored by `/flanders-spec` states each obligation as the behavior the code performs — what the software does and what the code must do. The set of things the code does **not** do is unbounded, so a spec does not enumerate non-actions. When a request asks to remove or stop a behavior, the spec change is to describe the resulting positive behavior; the removed behavior then disappears by omission. An explicit prohibition — "does not…", "never…", "must not…" — is written only when it is **load-bearing** per the test below. A prohibition that merely restates the absence of a behavior the positive spec already excludes is redundant and is not written.

### Who this applies to

- **Subject:** every contract file under a `.spec/contracts` folder, every rule file under a `.spec/rules` folder, and every behavior-rule file under a `.spec/flanders` folder that `/flanders-spec` writes or updates — including flanders' own spec, which `/flanders-spec` authors because the project self-hosts its spec.
- **Subject:** the source content that produces the `/flanders-spec` skill artifact body — the prompt text the `install` command ships — which must carry this as an active drafting instruction, per "How to apply".
- **Not subject:** a prohibition that is load-bearing per the test below. Such a prohibition is a legitimate obligation, not a violation — for example [src/commands/.spec/rules/ai/agents.md#autonomous-subagents-never-write-to-git](/src/commands/.spec/rules/ai/agents.md#autonomous-subagents-never-write-to-git) and [src/prompts/.spec/rules/ai/review.md#no-flanders-adversarial-reviewer-runs-the-build-or-test-scripts](/src/prompts/.spec/rules/ai/review.md#no-flanders-adversarial-reviewer-runs-the-build-or-test-scripts), which each forbid a behavior an implementer would otherwise plausibly perform.
- **Not subject:** plan files under `plans/` (`/flanders-plan` output), which sequence work rather than pin obligations.

### When a prohibition is load-bearing

A prohibition is load-bearing — and is therefore written — only when BOTH conditions hold:

1. **Not already entailed.** Its absence is not already implied by a positive obligation in the spec. A positive obligation stated exclusively — "the only X is Y", "exactly these…" — already excludes every alternative, so a prohibition restating that exclusion adds nothing.
2. **Guards a plausible mistake.** Reading only the positive spec, a competent implementer would plausibly introduce the prohibited behavior anyway. The behavior qualifies in either of two cases: it is an attractive default the implementer would reach for; or it falls inside a responsibility the component otherwise has — an agent that legitimately runs commands but must not write to git, a reviewer whose job is reviewing but must not run the build.

A prohibition that fails either condition is not written: a prohibition of a behavior the positive spec already excludes, or of a behavior no competent implementer would introduce (the "does not format the disk on install" kind), is noise.

### How to apply

- The `/flanders-spec` skill artifact body states this **actively in its drafting guidance** — a direct instruction to phrase each obligation as the behavior the code performs, to satisfy a removal request by describing the resulting positive behavior, and to admit an explicit prohibition only when it is load-bearing per the test above — placed where the body tells the skill how to draft. This mirrors how [src/prompts/.spec/rules/ai/skills/spec.md#spec-artifacts-state-only-the-present-spec--the-flanders-spec-prompt-prohibits-past-content-actively](/src/prompts/.spec/rules/ai/skills/spec.md#spec-artifacts-state-only-the-present-spec--the-flanders-spec-prompt-prohibits-past-content-actively) carries its prohibition actively in the drafting guidance rather than deferring it. The active instruction stops a redundant prohibition being written in the first place; an instruction deferred to a post-write step is reactive, forcing the skill to write the non-action and then undo it.
- Whether a prohibition is load-bearing is a judgment about entailment and plausibility rather than a textual pattern, so the active drafting instruction in the skill body is the enforcement surface for this obligation.

### Failure signals

- A rule authored by `/flanders-spec` states an obligation as a prohibition of a behavior the positive spec already excludes — for example, the spec already says the only subprocess a command launches is one specific probe, and a separate rule forbids launching a different tool merely to test that it is present.
- A request to remove a behavior is satisfied by adding a rule that forbids the removed behavior, instead of by describing the resulting positive behavior and letting the removed behavior vanish by omission.
- A spec enumerates a non-action no competent implementer would perform — the "does not format the disk on install" kind — treating the absence of an absurd behavior as an obligation.
- The `/flanders-spec` skill artifact body surfaces this obligation only as a post-write check, with no active instruction in its drafting guidance.

## A term rename sweeps the whole corpus by token, not a curated subset

When a `/flanders-spec` run renames, relocates, or removes a term that can recur in spec files beyond the ones it is editing — a folder name, a path segment, a flag, an identifier, a fixed string, or a namespace convention — the skill establishes the full set of files to touch by searching the entire corpus for the old term and triaging every occurrence individually. It does not curate a subset of "relevant" files by judgment and assume that subset is complete; coverage is driven by the token, not by which files the drafter believes are central.

### Who this applies to

- **Subject:** the `/flanders-spec` skill, during any request that renames, relocates, or removes such a recurring term, for every term the run changes.
- **Not subject:** `/flanders-plan` — it authors a single plan file and does not rename corpus-wide spec terms — and every other agent or command. A request that introduces only new terms, or edits a single file with no recurring term, does not trigger the sweep.

### What the sweep requires

- For each old term the run changes, search the whole corpus — every contract and every rule — for that term, and inspect every occurrence the search returns. The search is exhaustive over the corpus; it is not narrowed to the files the drafter already planned to edit.
- Triage each occurrence individually into exactly one of two dispositions: an occurrence the rename must update, which the run edits; or an occurrence that is an intentional reference the rename leaves alone, such as a cross-reference to an unrelated file or a deliberately unchanged example. An occurrence is never left unexamined on the grounds that its file looked irrelevant.
- The set of files the run edits is the union of the files the sweep shows must be updated. A file the sweep surfaces that the drafter had not planned to touch is added to the run.
- Moving or renaming a spec file changes that file's namespace — a path segment and namespace convention that recurs as the text and the target of every markdown link pointing at it. Such a move or rename is one of the term changes this sweep covers: the run searches the corpus for the old namespace and updates every occurrence, and because a reference's target is that namespace prefixed with a leading slash per [.spec/contracts/shared/cross-file-reference-links.md](/.spec/contracts/shared/cross-file-reference-links.md), updating an occurrence updates both the link text and the link target.

### How this relates to reading references

This obligation is additive to [src/prompts/.spec/rules/ai/skills/skills-common.md#skills-read-relevant-references-before-drafting](/src/prompts/.spec/rules/ai/skills/skills-common.md#skills-read-relevant-references-before-drafting). That rule governs which existing files the drafter reads before drafting, selected by relevance to the request. This rule governs coverage of a rename: for the specific case of a recurring term it removes the relevance judgment, because a stale occurrence most often survives precisely in a file the drafter judged irrelevant. The two obligations are complementary; neither substitutes for the other.

### Failure signals

- The run renames a recurring term, edits the files the drafter judged central, and leaves a stale occurrence of the old term in a file the drafter never searched.
- The drafter triages a broad search result by dismissing whole files as "incidental" without inspecting each occurrence inside them.
- The run fixes the set of files to edit before the corpus search and does not let the search expand that set.

## The /flanders-spec validator audits each artifact by its folder against the spec check categories

The `/flanders-spec` skill gates its work behind a final validator hosted as [src/prompts/.spec/rules/ai/skills/skills-common.md#every-flanders-content-skill-hosts-its-final-validator-the-same-way](/src/prompts/.spec/rules/ai/skills/skills-common.md#every-flanders-content-skill-hosts-its-final-validator-the-same-way) pins. This rule pins the check categories the validator runs against the persisted or updated file(s). Because `/flanders-spec` can write to a `.spec/contracts` folder, a `.spec/rules` folder, a `.spec/flanders` folder, or any combination in a single run, each persisted file is audited by the category set that matches the folder it landed in, plus the shared non-contradiction category that spans the whole corpus. A file that landed in a `.spec/flanders` folder is audited by the non-contradiction category C only; categories A and B audit files in `.spec/contracts` and `.spec/rules` folders respectively. Failure in ANY category is FAIL; the validator must run every applicable check on every invocation and must not stop at the first violation.

### Who this applies to

- **Subject:** the `/flanders-spec` skill, as the host that packages the validator's prompt with the categories enumerated below.
- **Subject (when running as a subagent):** the validator instance, in producing a verdict that audits every applicable category independently.
- **Not subject:** the `/flanders-plan` validator — it has its own per-skill rule.

### What the validator receives

The host follows [src/prompts/.spec/rules/ai/skills/skills-common.md#every-flanders-content-skill-hosts-its-final-validator-the-same-way](/src/prompts/.spec/rules/ai/skills/skills-common.md#every-flanders-content-skill-hosts-its-final-validator-the-same-way) for the shared inputs (artifact paths, canonical listings, output spec, read-only discipline, FAIL loop). On top of those, the host MUST inline the verbatim text of every check category below in the validator's prompt.

The canonical listings the host passes are:

1. The contracts listing captured at the start of the run (every contract's namespace — its project-root-relative path — across every `.spec/contracts` folder in the tree).
2. The rules listing captured at the start of the run (every rule's namespace across every `.spec/rules` folder in the tree).

Both listings are always passed, because a single `/flanders-spec` run may have written contract files, rule files, or both, and the non-contradiction category spans both regardless.

The host also passes the explicit list of file paths the skill wrote or updated in this run, partitioned by folder, so the validator knows which subset of each canonical listing is under audit and which category set applies to each file.

When this run renamed, relocated, or removed a term that can recur across the corpus (per [src/prompts/.spec/rules/ai/skills/spec.md#a-term-rename-sweeps-the-whole-corpus-by-token-not-a-curated-subset](/src/prompts/.spec/rules/ai/skills/spec.md#a-term-rename-sweeps-the-whole-corpus-by-token-not-a-curated-subset)), the host also passes the explicit list of those old term(s). The list is empty when the run changed no such term.

### What the validator must check

The categories below are mandatory; failure in any one is a FAIL. Each category is audited independently and violations are enumerated exhaustively. Category A applies to each file that landed in a `.spec/contracts` folder; category B applies to each file that landed in a `.spec/rules` folder; category C applies to every file written or updated in the run.

#### A. Contract artifacts (each file written or updated under a `.spec/contracts` folder)

##### A1. Format and shape

Every contract file written or updated in this run:

- Lives inside a `.spec/contracts` folder and is non-empty.
- Is markdown.
- Has a filename descriptive of its content — a reader can tell what each file covers from its name alone.
- Is organized per [.spec/contracts/ai-skills/spec-skill.md](/.spec/contracts/ai-skills/spec-skill.md): a single descriptive file when the scope is small, multiple files when the scope has clearly separable concerns (for example, a logic file and a UI file), subfolders grouping related files when the scope has multiple sections (for example, one folder per major feature).

##### A2. Content rules

Verify that each persisted contract satisfies EACH of the following obligations, independently. The host inlines this list verbatim in the validator's prompt; the validator audits each item as its own check and enumerates violations by name plus the offending file:line.

- **Free of placeholders.** No `<TBD>`, no `TODO`, no `XXX`, no template-style blanks, no parenthetical "(to be decided)".
- **Free of ambiguous wording.** Open-ended phrasing — hedge phrases such as `may or may not`, `left to the implementer`, `pick one of`, `or equivalent`, `at the discretion of the user`, `or — alternatively —`, `or X if Y`, or any formulation that leaves an obligation undefined — is FAIL. A contract obligation reads as a single concrete commitment, never as a choice the reader is invited to make.
- **Describes only public behavior across its scope's boundary.** A contract names what code outside the directory its `.spec` folder scopes can rely on, stated abstractly; for the project-root `.spec/contracts` that boundary is the end user. References to implementation details are out of scope of a contract and are FAIL. Implementation details include: names of specific classes, functions, libraries, modules, or frameworks; paths under `src/`, `lib/`, or any source folder; internal data shapes that consumers across the boundary do not directly observe; private helper or coordinator types; the existence of specific test files or runners; choices of HTTP client, ORM, database engine, build tool, or other tooling consumers do not directly interact with. A contract names what crosses its boundary — never how the directory achieves it internally.
- **Free of historical or migration content.** The contract states only the present spec — what the software does now. Content recording what the spec used to be, what it replaces, what changed in this run, or any transitional framing (for example, "replaces the former X", "previously Y", a changelog of the edit) is FAIL. Such facts belong in the commit message or pull-request description, not in a permanent spec file.
- **No obligation is duplicated across files.** When the request relates to obligations already covered by existing files, those files are updated rather than duplicated. The validator looks for the same obligation pinned in two places.
- **Cross-references are markdown links.** Every reference the contract makes to another spec file — a contract, rule, or plan file named by its namespace path — is a markdown link per [.spec/contracts/shared/cross-file-reference-links.md](/.spec/contracts/shared/cross-file-reference-links.md). A reference to a specific spec file written as a bare path or as inline code instead of a markdown link is FAIL.

#### B. Rule artifacts (each file written or updated under a `.spec/rules` folder)

##### B1. Format and shape

Every rule file written or updated in this run:

- Lives inside a `.spec/rules` folder and is non-empty.
- Is markdown.
- **Captures one or more atomic rules.** A rule file holds one rule on its own, or several related rules as discrete atomic sections. Each rule — whether it stands alone or sits as a section among related rules — pins exactly one obligation. A file is FAIL when it fuses unrelated obligations into one undifferentiated rule, or when a section it presents as a rule is not itself atomic.
- Has a filename descriptive of the rule or cluster of related rules the file captures — a reader can tell which rule or cluster the file pins from its name alone.
- Bundles of related rules are modeled either as a subfolder containing one file per atomic rule, or as a single file grouping those rules as discrete atomic sections; both shapes are valid. A `testing/` subfolder with one file per testing obligation is correct, and a single `testing.md` grouping those testing obligations as discrete atomic sections is equally correct; only a file that fuses unrelated obligations into one non-atomic rule is FAIL.

##### B2. Content rules

Verify that each persisted rule satisfies EACH of the following obligations, independently. The host inlines this list verbatim in the validator's prompt; the validator audits each item as its own check and enumerates violations by name plus the offending file:line.

- **Free of placeholders.** No `<TBD>`, no `TODO`, no `XXX`, no template-style blanks, no parenthetical "(to be decided)".
- **Scope of enforcement is explicit.** The rule has a "Who this applies to" or equivalent section that names exactly which code, agents, surfaces, file patterns, or call sites the rule binds. An open-ended "applies everywhere" or "applies to all code" without enumeration of the actual surface is FAIL. A reader must be able to look at a piece of code and decide whether the rule applies to it.
- **Free of ambiguous wording.** Hedge phrasing that turns the obligation into a choice instead of a commitment — `may or may not`, `pick one of`, `or equivalent`, `left to the implementer`, `at the discretion of`, `or — alternatively —`, `or X if Y` — is FAIL.
- **Free of historical or migration content.** The rule states only the present spec — what the code must do now. Content recording what the rule used to be, what it replaces, what changed in this run, or any transitional framing (for example, "replaces the former X", "previously Y", a changelog of the edit) is FAIL. Such facts belong in the commit message or pull-request description, not in a permanent spec file.
- **No rule is duplicated across files.** When the request relates to a rule already covered by an existing file, that file is updated rather than a parallel duplicate created. The validator looks for the same obligation pinned in two places.
- **Cross-references are markdown links.** Every reference the rule makes to another spec file — a contract, rule, or plan file named by its namespace path — is a markdown link per [.spec/contracts/shared/cross-file-reference-links.md](/.spec/contracts/shared/cross-file-reference-links.md). A reference to a specific spec file written as a bare path or as inline code instead of a markdown link is FAIL.

#### C. Non-contradiction with the canonical corpus (every file written or updated in this run)

The file(s) written or updated in this run do not contradict any other contract in the project's contracts (the canonical contracts listing, spanning every `.spec/contracts` folder) and do not contradict any rule in the project's rules (the canonical rules listing, spanning every `.spec/rules` folder). A contradiction is an obligation pinned in two places with incompatible content. Tightening, extending, or qualifying an existing obligation in a way the existing text already allows is not a contradiction.

**Renamed-term sweep.** For each old term the host passed (the terms this run renamed, relocated, or removed), the validator searches the whole corpus for that term and inspects every occurrence. An occurrence that is a stale, un-updated instance of the renamed term — a leftover that should have been changed in this run — is FAIL. An occurrence that is an intentional reference the rename correctly leaves alone is not a violation. The validator drives this check from the passed term(s), not from its own judgment of which files are relevant, so that a stale occurrence in a file the validator would not otherwise open is still caught. When the passed list is empty, this check is vacuously satisfied.

Out of scope of the validator: verifying that paths referenced by a contract or rule physically resolve on disk; that is the skill's pre-validator responsibility.

### Failure signals

- The validator reports PASS on a contract that contains implementation detail (specific class or library names, paths under `src/`, references to internal types, file paths, or runners the user does not interact with).
- The validator reports PASS on a contract or rule with hedge phrasing that leaves an obligation undefined.
- The validator reports PASS on a rule file that fuses unrelated obligations into one non-atomic rule, or that presents a section as a rule where that section is not itself atomic.
- The validator reports PASS on a rule whose scope is undefined or stated as "everywhere" without enumeration of the actual surface.
- The validator reports PASS on a run that duplicated an existing obligation across files instead of updating the existing file in place.
- The validator reports PASS on a file that contradicts another contract or rule in the canonical corpus.
- The validator reports PASS on a contract or rule that references a specific spec file as a bare path or as inline code instead of a markdown link, contrary to [.spec/contracts/shared/cross-file-reference-links.md](/.spec/contracts/shared/cross-file-reference-links.md).
- The validator reports PASS while a stale occurrence of a term this run renamed, relocated, or removed survives in a corpus file the validator did not search, because it scoped its reading by relevance judgment instead of sweeping the passed term(s) across the whole corpus.
- The validator reports PASS on a contract or rule that records historical, transitional, or migration content (for example, "replaces the former X", "previously Y", or a changelog of what this run changed) instead of stating only the present spec.
- The validator applies the contract category set to a file that landed in a `.spec/rules` folder, or the rule category set to a file that landed in a `.spec/contracts` folder, instead of selecting the category set by the file's folder.
- The validator aggregates the categories into a single judgment instead of auditing each independently and enumerating violations exhaustively.
- The host packages the validator prompt without inlining the verbatim text of the content-rule categories (A2 and B2), forcing the validator to discover the content obligations by transitive contract reading — which defeats the explicit-categories obligation pinned in [src/prompts/.spec/rules/ai/skills/skills-common.md#every-flanders-content-skill-hosts-its-final-validator-the-same-way](/src/prompts/.spec/rules/ai/skills/skills-common.md#every-flanders-content-skill-hosts-its-final-validator-the-same-way).
