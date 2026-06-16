# The /flanders-spec validator audits each artifact by its folder against the spec check categories

The `/flanders-spec` skill gates its work behind a final validator hosted as [src/prompts/.docs/rules/ai/skills/final-validator-host.md](/src/prompts/.docs/rules/ai/skills/final-validator-host.md) pins. This rule pins the check categories the validator runs against the persisted or updated file(s). Because `/flanders-spec` can write to a `.spec/contracts` folder, to a `.spec/rules` folder, or to both in a single run, each persisted file is audited by the category set that matches the folder it landed in, plus the shared non-contradiction category that spans the whole corpus. Failure in ANY category is FAIL; the validator must run every applicable check on every invocation and must not stop at the first violation.

## Who this applies to

- **Subject:** the `/flanders-spec` skill, as the host that packages the validator's prompt with the categories enumerated below.
- **Subject (when running as a subagent):** the validator instance, in producing a verdict that audits every applicable category independently.
- **Not subject:** the `/flanders-plan` validator — it has its own per-skill rule.

## What the validator receives

The host follows [src/prompts/.docs/rules/ai/skills/final-validator-host.md](/src/prompts/.docs/rules/ai/skills/final-validator-host.md) for the shared inputs (artifact paths, canonical listings, output spec, read-only discipline, FAIL loop). On top of those, the host MUST inline the verbatim text of every check category below in the validator's prompt.

The canonical listings the host passes are:

1. The contracts listing captured at the start of the run (every contract's namespace — its project-root-relative path — across every `.spec/contracts` folder in the tree).
2. The rules listing captured at the start of the run (every rule's namespace across every `.spec/rules` folder in the tree).

Both listings are always passed, because a single `/flanders-spec` run may have written contract files, rule files, or both, and the non-contradiction category spans both regardless.

The host also passes the explicit list of file paths the skill wrote or updated in this run, partitioned by folder, so the validator knows which subset of each canonical listing is under audit and which category set applies to each file.

When this run renamed, relocated, or removed a term that can recur across the corpus (per [src/prompts/.docs/rules/ai/skills/spec/rename-triggers-corpus-wide-sweep.md](/src/prompts/.docs/rules/ai/skills/spec/rename-triggers-corpus-wide-sweep.md)), the host also passes the explicit list of those old term(s). The list is empty when the run changed no such term.

## What the validator must check

The categories below are mandatory; failure in any one is a FAIL. Each category is audited independently and violations are enumerated exhaustively. Category A applies to each file that landed in a `.spec/contracts` folder; category B applies to each file that landed in a `.spec/rules` folder; category C applies to every file written or updated in the run.

### A. Contract artifacts (each file written or updated under a `.spec/contracts` folder)

#### A1. Format and shape

Every contract file written or updated in this run:

- Lives inside a `.spec/contracts` folder and is non-empty.
- Is markdown.
- Has a filename descriptive of its content — a reader can tell what each file covers from its name alone.
- Is organized per [.docs/contracts/ai-skills/spec-skill.md](/.docs/contracts/ai-skills/spec-skill.md): a single descriptive file when the scope is small, multiple files when the scope has clearly separable concerns (for example, a logic file and a UI file), subfolders grouping related files when the scope has multiple sections (for example, one folder per major feature).

#### A2. Content rules

Verify that each persisted contract satisfies EACH of the following obligations, independently. The host inlines this list verbatim in the validator's prompt; the validator audits each item as its own check and enumerates violations by name plus the offending file:line.

- **Free of placeholders.** No `<TBD>`, no `TODO`, no `XXX`, no template-style blanks, no parenthetical "(to be decided)".
- **Free of ambiguous wording.** Open-ended phrasing — hedge phrases such as `may or may not`, `left to the implementer`, `pick one of`, `or equivalent`, `at the discretion of the user`, `or — alternatively —`, `or X if Y`, or any formulation that leaves an obligation undefined — is FAIL. A contract obligation reads as a single concrete commitment, never as a choice the reader is invited to make.
- **Describes only public behavior across its scope's boundary.** A contract names what code outside the directory its `.spec` folder scopes can rely on, stated abstractly; for the project-root `.spec/contracts` that boundary is the end user. References to implementation details are out of scope of a contract and are FAIL. Implementation details include: names of specific classes, functions, libraries, modules, or frameworks; paths under `src/`, `lib/`, or any source folder; internal data shapes that consumers across the boundary do not directly observe; private helper or coordinator types; the existence of specific test files or runners; choices of HTTP client, ORM, database engine, build tool, or other tooling consumers do not directly interact with. A contract names what crosses its boundary — never how the directory achieves it internally.
- **Free of historical or migration content.** The contract states only the present spec — what the software does now. Content recording what the spec used to be, what it replaces, what changed in this run, or any transitional framing (for example, "replaces the former X", "previously Y", a changelog of the edit) is FAIL. Such facts belong in the commit message or pull-request description, not in a permanent spec file.
- **No obligation is duplicated across files.** When the request relates to obligations already covered by existing files, those files are updated rather than duplicated. The validator looks for the same obligation pinned in two places.
- **Cross-references are markdown links.** Every reference the contract makes to another spec file — a contract, rule, or plan file named by its namespace path — is a markdown link per [.docs/contracts/shared/cross-file-reference-links.md](/.docs/contracts/shared/cross-file-reference-links.md). A reference to a specific spec file written as a bare path or as inline code instead of a markdown link is FAIL.

### B. Rule artifacts (each file written or updated under a `.spec/rules` folder)

#### B1. Format and shape

Every rule file written or updated in this run:

- Lives inside a `.spec/rules` folder and is non-empty.
- Is markdown.
- **Captures exactly one atomic rule.** A file that pins two or more independent obligations is FAIL. Those obligations belong in separate files inside the same subfolder.
- Has a filename descriptive of the single rule the file captures — a reader can tell which rule the file pins from its name alone.
- Bundles of related rules are modeled as subfolders containing single-rule files, never as one multi-rule file. A `testing/` subfolder with one file per testing obligation is correct; a single `testing.md` listing multiple obligations is FAIL.

#### B2. Content rules

Verify that each persisted rule satisfies EACH of the following obligations, independently. The host inlines this list verbatim in the validator's prompt; the validator audits each item as its own check and enumerates violations by name plus the offending file:line.

- **Free of placeholders.** No `<TBD>`, no `TODO`, no `XXX`, no template-style blanks, no parenthetical "(to be decided)".
- **Scope of enforcement is explicit.** The rule has a "Who this applies to" or equivalent section that names exactly which code, agents, surfaces, file patterns, or call sites the rule binds. An open-ended "applies everywhere" or "applies to all code" without enumeration of the actual surface is FAIL. A reader must be able to look at a piece of code and decide whether the rule applies to it.
- **Free of ambiguous wording.** Hedge phrasing that turns the obligation into a choice instead of a commitment — `may or may not`, `pick one of`, `or equivalent`, `left to the implementer`, `at the discretion of`, `or — alternatively —`, `or X if Y` — is FAIL.
- **Free of historical or migration content.** The rule states only the present spec — what the code must do now. Content recording what the rule used to be, what it replaces, what changed in this run, or any transitional framing (for example, "replaces the former X", "previously Y", a changelog of the edit) is FAIL. Such facts belong in the commit message or pull-request description, not in a permanent spec file.
- **No rule is duplicated across files.** When the request relates to a rule already covered by an existing file, that file is updated rather than a parallel duplicate created. The validator looks for the same obligation pinned in two places.
- **Cross-references are markdown links.** Every reference the rule makes to another spec file — a contract, rule, or plan file named by its namespace path — is a markdown link per [.docs/contracts/shared/cross-file-reference-links.md](/.docs/contracts/shared/cross-file-reference-links.md). A reference to a specific spec file written as a bare path or as inline code instead of a markdown link is FAIL.

### C. Non-contradiction with the canonical corpus (every file written or updated in this run)

The file(s) written or updated in this run do not contradict any other contract in the project's contracts (the canonical contracts listing, spanning every `.spec/contracts` folder) and do not contradict any rule in the project's rules (the canonical rules listing, spanning every `.spec/rules` folder). A contradiction is an obligation pinned in two places with incompatible content. Tightening, extending, or qualifying an existing obligation in a way the existing text already allows is not a contradiction.

**Renamed-term sweep.** For each old term the host passed (the terms this run renamed, relocated, or removed), the validator searches the whole corpus for that term and inspects every occurrence. An occurrence that is a stale, un-updated instance of the renamed term — a leftover that should have been changed in this run — is FAIL. An occurrence that is an intentional reference the rename correctly leaves alone is not a violation. The validator drives this check from the passed term(s), not from its own judgment of which files are relevant, so that a stale occurrence in a file the validator would not otherwise open is still caught. When the passed list is empty, this check is vacuously satisfied.

Out of scope of the validator: verifying that paths referenced by a contract or rule physically resolve on disk; that is the skill's pre-validator responsibility.

## Failure signals

- The validator reports PASS on a contract that contains implementation detail (specific class or library names, paths under `src/`, references to internal types, file paths, or runners the user does not interact with).
- The validator reports PASS on a contract or rule with hedge phrasing that leaves an obligation undefined.
- The validator reports PASS on a rule file that captures two or more independent obligations.
- The validator reports PASS on a rule whose scope is undefined or stated as "everywhere" without enumeration of the actual surface.
- The validator reports PASS on a run that duplicated an existing obligation across files instead of updating the existing file in place.
- The validator reports PASS on a file that contradicts another contract or rule in the canonical corpus.
- The validator reports PASS on a contract or rule that references a specific spec file as a bare path or as inline code instead of a markdown link, contrary to [.docs/contracts/shared/cross-file-reference-links.md](/.docs/contracts/shared/cross-file-reference-links.md).
- The validator reports PASS while a stale occurrence of a term this run renamed, relocated, or removed survives in a corpus file the validator did not search, because it scoped its reading by relevance judgment instead of sweeping the passed term(s) across the whole corpus.
- The validator reports PASS on a contract or rule that records historical, transitional, or migration content (for example, "replaces the former X", "previously Y", or a changelog of what this run changed) instead of stating only the present spec.
- The validator applies the contract category set to a file that landed in a `.spec/rules` folder, or the rule category set to a file that landed in a `.spec/contracts` folder, instead of selecting the category set by the file's folder.
- The validator aggregates the categories into a single judgment instead of auditing each independently and enumerating violations exhaustively.
- The host packages the validator prompt without inlining the verbatim text of the content-rule categories (A2 and B2), forcing the validator to discover the content obligations by transitive contract reading — which defeats the explicit-categories obligation pinned in [src/prompts/.docs/rules/ai/skills/final-validator-host.md](/src/prompts/.docs/rules/ai/skills/final-validator-host.md).
