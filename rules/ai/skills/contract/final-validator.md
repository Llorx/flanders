# The /flanders-contract validator audits the artifact against three categories

The `/flanders-contract` skill gates its work behind a final validator hosted as `rules/ai/skills/final-validator-host.md` pins. This rule pins the three check categories the validator runs against the persisted or updated contract file(s). Failure in ANY category is FAIL; the validator must run every check on every invocation and must not stop at the first violation.

## Who this applies to

- **Subject:** the `/flanders-contract` skill, as the host that packages the validator's prompt with the three categories enumerated below.
- **Subject (when running as a subagent):** the validator instance, in producing a verdict that audits all three categories independently.
- **Not subject:** the `/flanders-plan` and `/flanders-rule` validators — each has its own per-skill rule.

## What the validator receives

The host follows `rules/ai/skills/final-validator-host.md` for the shared inputs (artifact paths, canonical listings, output spec, read-only discipline, FAIL loop). On top of those, the host MUST inline the verbatim text of each of the three check categories below in the validator's prompt.

The canonical listings the host passes are:

1. The contracts listing captured at the start of the run (every relative path under `contracts/`, including the file(s) just written or updated).
2. The rules listing captured at the start of the run (every relative path under `rules/`). Rules are passed so the validator can detect contradictions between a contract and an existing rule.

The host also passes the explicit list of contract file paths the skill wrote or updated in this run, so the validator knows which subset of the canonical contracts listing is under audit.

## What the validator must check

Three categories, all mandatory; failure in any one is a FAIL. Each category is audited independently and violations are enumerated exhaustively.

### 1. Format and shape

Every contract artifact file written or updated in this run:

- Lives inside `contracts/` and is non-empty.
- Is markdown.
- Has a filename descriptive of its content — a reader can tell what each file covers from its name alone.
- Is organized per `contracts/ai-skills/contract-skill.md` step 6 of the Behavior section: a single descriptive file when the product is small, multiple files when the product has clearly separable concerns (for example, a logic file and a UI file), subfolders grouping related files when the product has multiple sections (for example, one folder per major feature, with logic and UI files inside).

### 2. Content rules (verbatim from `contracts/ai-skills/contract-skill.md`)

Verify that each persisted contract satisfies EACH of the following obligations, independently. The host inlines this list verbatim in the validator's prompt; the validator audits each item as its own check and enumerates violations by name plus the offending file:line.

- **Free of placeholders.** No `<TBD>`, no `TODO`, no `XXX`, no template-style blanks, no parenthetical "(to be decided)".
- **Free of ambiguous wording.** Open-ended phrasing — hedge phrases such as `may or may not`, `left to the implementer`, `pick one of`, `or equivalent`, `at the discretion of the user`, `or — alternatively —`, `or X if Y`, or any formulation that leaves an obligation undefined — is FAIL. A contract obligation reads as a single concrete commitment, never as a choice the reader is invited to make.
- **Describes only public, user-visible behavior.** References to implementation details are out of scope of a contract and are FAIL. Implementation details include: names of specific classes, functions, libraries, modules, or frameworks; paths under `src/`, `lib/`, or any source folder; internal data shapes that the user does not directly observe; private helper or coordinator types; the existence of specific test files or runners; choices of HTTP client, ORM, database engine, build tool, or other tooling the user does not directly interact with. A contract names what the user sees, does, and relies on — never how the project achieves it internally.
- **No obligation is duplicated across files.** When the request relates to obligations already covered by existing files, those files are updated rather than duplicated. The validator looks for the same obligation pinned in two places.

### 3. Non-contradiction with the canonical corpus

The contract file(s) written or updated in this run do not contradict any other contract in `contracts/` (the canonical contracts listing) and do not contradict any rule in `rules/` (the canonical rules listing also provided to the validator). A contradiction is an obligation pinned in two places with incompatible content. Tightening, extending, or qualifying an existing obligation in a way the existing text already allows is not a contradiction.

Out of scope of the validator: verifying that paths referenced by the contract physically resolve on disk; that is the skill's pre-validator responsibility.

## Failure signals

- The validator reports PASS on a contract that contains implementation detail (specific class or library names, paths under `src/`, references to internal types, file paths, or runners the user does not interact with).
- The validator reports PASS on a contract with hedge phrasing that leaves an obligation undefined.
- The validator reports PASS on a contract that contradicts another contract or a rule in the canonical corpus.
- The validator reports PASS on a run that duplicated an existing obligation across files instead of updating the existing file in place.
- The validator aggregates the three categories into a single judgment instead of auditing each independently and enumerating violations exhaustively.
- The host packages the validator prompt without inlining the verbatim text of category 2, forcing the validator to discover the content obligations by transitive contract reading — which defeats the explicit-categories obligation pinned in `rules/ai/skills/final-validator-host.md`.
