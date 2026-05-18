# Skills run a self-review pass on the draft before persisting

Before persisting any deliverable, `/flanders-contract`, `/flanders-rule`, and `/flanders-plan` re-read the draft and audit it against a fixed checklist. Any issue is fixed in place. If a fix would change the meaning of content the user already approved during the drafting phase, the skill surfaces the issue to the user and asks before applying the fix. A draft that has not been self-reviewed against this checklist must not be persisted.

## Who this applies to

- **Subject:** every invocation of the three Flanders skills:
  - `/flanders-contract`
  - `/flanders-rule`
  - `/flanders-plan`
- **Not subject:** other agents and commands. The post-persist final-validator pinned in `rules/ai/skills/plan/final-validator.md` is a separate, additional quality gate for `/flanders-plan`; it does not replace this pre-persist self-review.

## When the self-review runs

The self-review runs after the user has approved the draft (or the section of the draft, for non-trivial requests) and before the skill writes the file to disk. The self-review is the last step the skill performs before persistence; persisting a draft and then verifying it is not a substitute for this pre-persist pass.

## The self-review checklist

The skill audits the draft against all of the following, every time:

1. **No placeholders left behind.** No `TODO`, no `TBD`, no `<placeholder>`-style markers, no half-finished sentences, no "(fill in)"-style fragments.
2. **No contradictions with the canonical reference set.** The draft is consistent with every relevant file in the canonical reference set as captured at invocation (per `rules/ai/skills/read-relevant-references-before-drafting.md`). For `/flanders-plan`, contradictions are checked against both `contracts/` and `rules/`; for `/flanders-rule`, against `rules/` and any related contracts; for `/flanders-contract`, against `contracts/`.
3. **No ambiguous wording.** Every obligation, rule, or task description is unambiguous about scope, subject, and applicability. A reader who is not in this conversation must be able to interpret the draft a single way.
4. **No scope drift.** The draft does not introduce obligations, rules, or tasks that were not part of the request the user approved during the drafting phase.

A failure in any one of these is treated as a finding and must be addressed before persistence.

## How the skill reacts to a finding

When the self-review surfaces a finding, the skill does one of the following:

- **Mechanical fix that does not change meaning** — for example, removing a stray placeholder, rewording an ambiguous sentence without altering the obligation, or pruning content that drifted outside the approved scope. The skill fixes the draft in place and re-runs the self-review on the fixed version.
- **Fix that would change the meaning of already-approved content** — the skill stops, surfaces the issue to the user in chat (naming the file or section, the finding, and the proposed change), and waits for the user's decision before applying it. The skill does not silently rewrite content the user already approved.

The self-review loop ends only when the draft passes every item on the checklist. The skill does not persist a draft with an open finding.

## Failure signals

- The skill persists a file without having run the self-review checklist on the final draft.
- The skill persists a file with a placeholder, a contradiction against an existing canonical file, an ambiguous obligation, or scope drift the user did not approve.
- The skill silently rewrites already-approved content as part of a self-review fix, instead of surfacing the issue to the user.
- The skill exits the self-review loop with an open finding still standing and treats the deliverable as complete.
- The skill substitutes a post-persist verification (re-read the file from disk and check it) for the pre-persist self-review the draft is owed.
