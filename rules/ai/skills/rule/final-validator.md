# The /flanders-rule validator audits the artifact against three categories

The `/flanders-rule` skill gates its work behind a final validator hosted as `rules/ai/skills/final-validator-host.md` pins. This rule pins the three check categories the validator runs against the persisted or updated rule file(s). Failure in ANY category is FAIL; the validator must run every check on every invocation and must not stop at the first violation.

## Who this applies to

- **Subject:** the `/flanders-rule` skill, as the host that packages the validator's prompt with the three categories enumerated below.
- **Subject (when running as a subagent):** the validator instance, in producing a verdict that audits all three categories independently.
- **Not subject:** the `/flanders-plan` and `/flanders-contract` validators — each has its own per-skill rule.

## What the validator receives

The host follows `rules/ai/skills/final-validator-host.md` for the shared inputs (artifact paths, canonical listings, output spec, read-only discipline, FAIL loop). On top of those, the host MUST inline the verbatim text of each of the three check categories below in the validator's prompt.

The canonical listings the host passes are:

1. The rules listing captured at the start of the run (every relative path under `rules/`, including the file(s) just written or updated).
2. The contracts listing captured at the start of the run (every relative path under `contracts/`). Contracts are passed so the validator can detect contradictions between a rule and an existing contract.

The host also passes the explicit list of rule file paths the skill wrote or updated in this run, so the validator knows which subset of the canonical rules listing is under audit.

## What the validator must check

Three categories, all mandatory; failure in any one is a FAIL. Each category is audited independently and violations are enumerated exhaustively.

### 1. Format and shape

Every rule artifact file written or updated in this run:

- Lives inside `rules/` and is non-empty.
- Is markdown.
- **Captures exactly one atomic rule.** A file that pins two or more independent obligations is FAIL. Those obligations belong in separate files inside the same subfolder.
- Has a filename descriptive of the single rule the file captures — a reader can tell which rule the file pins from its name alone.
- Bundles of related rules are modeled as subfolders containing single-rule files, never as one multi-rule file. A `testing/` subfolder with one file per testing obligation is correct; a single `testing.md` listing multiple obligations is FAIL.

### 2. Content rules (verbatim from `contracts/ai-skills/rule-skill.md`)

Verify that each persisted rule satisfies EACH of the following obligations, independently. The host inlines this list verbatim in the validator's prompt; the validator audits each item as its own check and enumerates violations by name plus the offending file:line.

- **Free of placeholders.** No `<TBD>`, no `TODO`, no `XXX`, no template-style blanks, no parenthetical "(to be decided)".
- **Scope of enforcement is explicit.** The rule has a "Who this applies to" or equivalent section that names exactly which code, agents, surfaces, file patterns, or call sites the rule binds. An open-ended "applies everywhere" or "applies to all code" without enumeration of the actual surface is FAIL. A reader must be able to look at a piece of code and decide whether the rule applies to it.
- **Free of ambiguous wording.** Hedge phrasing that turns the obligation into a choice instead of a commitment — `may or may not`, `pick one of`, `or equivalent`, `left to the implementer`, `at the discretion of`, `or — alternatively —`, `or X if Y` — is FAIL.
- **No rule is duplicated across files.** When the request relates to a rule already covered by an existing file, that file is updated rather than a parallel duplicate created. The validator looks for the same obligation pinned in two places.

### 3. Non-contradiction with the canonical corpus

The rule file(s) written or updated in this run do not contradict any other rule in `rules/` (the canonical rules listing) and do not contradict any contract in `contracts/` (the canonical contracts listing also provided to the validator). A contradiction is an obligation pinned in two places with incompatible content. Tightening, extending, or qualifying an existing obligation in a way the existing text already allows is not a contradiction.

Out of scope of the validator: verifying that paths referenced by the rule physically resolve on disk; that is the skill's pre-validator responsibility.

## Failure signals

- The validator reports PASS on a rule file that captures two or more independent obligations.
- The validator reports PASS on a rule whose scope is undefined or stated as "everywhere" without enumeration of the actual surface.
- The validator reports PASS on a rule with hedge phrasing that turns the obligation into a choice.
- The validator reports PASS on a rule that duplicates an existing one instead of updating in place.
- The validator reports PASS on a rule that contradicts another rule or a contract in the canonical corpus.
- The validator aggregates the three categories into a single judgment instead of auditing each independently and enumerating violations exhaustively.
- The host packages the validator prompt without inlining the verbatim text of category 2, forcing the validator to discover the content obligations by transitive contract reading — which defeats the explicit-categories obligation pinned in `rules/ai/skills/final-validator-host.md`.
