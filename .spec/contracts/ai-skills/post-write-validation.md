# Post-Write Validation — Shared Skill Obligation

## Purpose
Pin the user-visible behavior every Flanders content skill (`/flanders-spec`, `/flanders-plan`) follows after persisting its file(s): a post-write validation gate, and the loop the skill enters when that gate fails. Each skill's own contract references this file instead of repeating the obligation inline.

## Scope
This obligation applies to `/flanders-spec` and `/flanders-plan`. Each skill runs its own clarification phase and drafting phase per its own contract, then runs the validation gate described here before declaring complete.

## Post-write validation gate
After persisting the file(s), and before declaring complete, the skill runs a validation gate over what it just wrote or updated. The gate is the sole condition for declaring complete: when it passes, the skill declares complete; when it fails, the skill enters the loop below. The skill does not declare complete on a gate failure, and does not skip the gate.

## What a passing gate certifies
A passing gate certifies that the file(s) the skill wrote or updated in this run satisfy the validator's check categories and do not contradict the corpus the validator inspected. It does not certify that the entire corpus is mutually consistent independent of this run's files: whole-corpus consistency is not re-verified on every run, and a passing gate is not a proof of it. The skill reports a pass as a statement about the run's own output, never as a statement that the whole spec is globally sound.

## On failure — clarification triage then fix
When the gate fails, the skill processes the failure as follows, before reaching for any rewrite:

1. **Triage each issue.** For every failure the gate reports, the skill classifies it against the clarification-scope criteria of the originating skill's contract — the same criteria that govern that skill's initial clarification phase.
2. **Issues that close a previously-unresolved clarification-scope ambiguity** — i.e., issues whose fix would commit the skill to an answer that, per the originating skill's clarification phase, the user is the one who must give and that the user did not give yet — send the skill back into the clarification phase before any rewrite happens. Re-entered clarification follows the same question cadence pinned in [.spec/contracts/ai-skills/question-cadence.md](/.spec/contracts/ai-skills/question-cadence.md). Once the user has answered, the skill applies the fix incorporating that answer.
3. **All other issues** — formatting, missing links, naming, numbering, placeholders that do not require a user-level decision, and any other fix the skill can resolve on its own per the originating contract — the skill applies in place without asking.
4. **Re-run the gate** over the rewritten file(s) and repeat from step 1.

The re-entered clarification phase is not the original clarification phase repeated wholesale: only the specific ambiguity that the failed issue closes is asked. Decisions the user has already given in the same invocation are not asked again.

## Bounded loop and exhaustion surface
The fix loop is bounded — the skill never spins indefinitely. When the loop ends with a still-failing gate, the skill does not declare complete: it surfaces, in chat, the last failure report together with the absolute path(s) of the file(s) it persisted, and stops. It is then the user's call to redirect, restart, or accept the partial output. The skill never silently leaves a failing artifact on disk as if it were valid.

The exact bound, the precise mechanism by which the gate runs, and the format of the failure report are implementation conventions and are pinned in [src/prompts/.spec/rules/ai/skills/skills-common.md#every-flanders-content-skill-hosts-its-final-validator-the-same-way](/src/prompts/.spec/rules/ai/skills/skills-common.md#every-flanders-content-skill-hosts-its-final-validator-the-same-way) and the per-skill final-validator rules [src/prompts/.spec/rules/ai/skills/spec.md#the-flanders-spec-validator-audits-each-artifact-by-its-folder-against-the-spec-check-categories](/src/prompts/.spec/rules/ai/skills/spec.md#the-flanders-spec-validator-audits-each-artifact-by-its-folder-against-the-spec-check-categories) and [src/prompts/.spec/rules/ai/skills/plan.md#the-flanders-plan-validator-audits-the-plan-against-five-categories](/src/prompts/.spec/rules/ai/skills/plan.md#the-flanders-plan-validator-audits-the-plan-against-five-categories).

## Relationship to the originating skill's clarification phase
The clarification-scope criteria that govern triage in step 2 above are exactly the criteria the originating skill's contract pins for its initial clarification phase:

- `/flanders-spec` — the clarification phase described in [.spec/contracts/ai-skills/spec-skill.md](/.spec/contracts/ai-skills/spec-skill.md).
- `/flanders-plan` — the clarification phase described in [.spec/contracts/ai-skills/plan-skill.md](/.spec/contracts/ai-skills/plan-skill.md) (the narrower of the two).

Triage never broadens the originating skill's clarification scope: an issue the originating skill would not have asked about in its initial phase is not asked about during the fix loop either. It is fixed in place per step 3.
