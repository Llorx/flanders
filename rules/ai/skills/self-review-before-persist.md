# Skills run a self-review pass on the draft before persisting

Before persisting any deliverable, `/flanders-spec` and `/flanders-plan` re-read the draft and audit it against a fixed checklist. Any issue is fixed in place. The content the user approved during the drafting phase differs by skill: for `/flanders-spec`, it is the layout summary the user approved (the file list and the key obligations promised in it); for `/flanders-plan`, there is no user-approved content at all. When a fix would change the meaning of content the user approved, the skill surfaces the issue to the user and asks before applying the fix; for `/flanders-plan`, no such content exists, so findings are always fixed silently. A draft that has not been self-reviewed against this checklist must not be persisted.

## Who this applies to

- **Subject:** every invocation of the two Flanders skills:
  - `/flanders-spec`
  - `/flanders-plan`
- **Not subject:** other agents and commands. The post-persist final-validator pinned in `rules/ai/skills/plan/final-validator.md` is a separate, additional quality gate for `/flanders-plan`; it does not replace this pre-persist self-review.

## When the self-review runs

The self-review is the last step the skill performs before persistence; persisting a draft and then verifying it is not a substitute for this pre-persist pass. The trigger point differs by skill:

- `/flanders-spec` — the self-review runs after the user approves the layout summary and before the skill writes the batch of files to disk. Every file in the batch is self-reviewed before being persisted.
- `/flanders-plan` — the self-review runs after the clarification phase ends and before the skill writes the plan file to disk. No user approval precedes it.

## The self-review checklist

The skill audits the draft against all of the following, every time:

1. **No placeholders left behind.** No `TODO`, no `TBD`, no `<placeholder>`-style markers, no half-finished sentences, no "(fill in)"-style fragments.
2. **No contradictions with the canonical reference set.** The draft is consistent with every relevant file in the canonical reference set as captured at invocation (per `rules/ai/skills/read-relevant-references-before-drafting.md`). For both `/flanders-spec` and `/flanders-plan`, contradictions are checked against the full canonical reference set — every contract under a `.docs/contracts` folder and every rule under a `.docs/rules` folder, per `rules/ai/skills/read-relevant-references-before-drafting.md`.
3. **No ambiguous wording.** Every obligation, rule, or task description is unambiguous about scope, subject, and applicability. A reader who is not in this conversation must be able to interpret the draft a single way.
4. **No scope drift.** The draft does not introduce obligations, rules, or tasks that were not part of the request the user approved during the drafting phase.

A failure in any one of these is treated as a finding and must be addressed before persistence.

## How the skill reacts to a finding

When the self-review surfaces a finding, the skill does one of the following:

- **Mechanical fix that does not change meaning** — for example, removing a stray placeholder, rewording an ambiguous sentence without altering the obligation, or pruning content that drifted outside scope. The skill fixes the draft in place and re-runs the self-review on the fixed version.
- **Fix that would change the meaning of already-approved content** — applies only to `/flanders-spec`, whose user-approved content is the layout summary (the file list and the key obligations promised in it). When such a fix is needed, the skill stops, surfaces the issue to the user in chat (naming the file, the finding, and the proposed change), and waits for the user's decision before applying it. The skill does not silently rewrite content the user already approved. For `/flanders-plan`, this branch never triggers, because no content in the draft is user-approved; every finding in a plan draft is handled by the mechanical-fix branch above.

The self-review loop ends only when the draft passes every item on the checklist. The skill does not persist a draft with an open finding.

## Failure signals

- The skill persists a file without having run the self-review checklist on the final draft.
- The skill persists a file with a placeholder, a contradiction against an existing canonical file, an ambiguous obligation, or scope drift the user did not approve.
- For `/flanders-spec`, the skill silently rewrites content that the user approved in the layout summary as part of a self-review fix, instead of surfacing the issue to the user.
- The skill exits the self-review loop with an open finding still standing and treats the deliverable as complete.
- The skill substitutes a post-persist verification (re-read the file from disk and check it) for the pre-persist self-review the draft is owed.
