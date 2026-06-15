# A spec states behavior; an explicit prohibition is written only when load-bearing

A contract or rule authored by `/flanders-spec` states each obligation as the behavior the code performs — what the software does and what the code must do. The set of things the code does **not** do is unbounded, so a spec does not enumerate non-actions. When a request asks to remove or stop a behavior, the spec change is to describe the resulting positive behavior; the removed behavior then disappears by omission. An explicit prohibition — "does not…", "never…", "must not…" — is written only when it is **load-bearing** per the test below. A prohibition that merely restates the absence of a behavior the positive spec already excludes is redundant and is not written.

## Who this applies to

- **Subject:** every contract file under a `.docs/contracts` folder and every rule file under a `.docs/rules` folder that `/flanders-spec` writes or updates — including flanders' own spec, which `/flanders-spec` authors because the project self-hosts its spec.
- **Subject:** the source content that produces the `/flanders-spec` skill artifact body — the prompt text the `install` command ships — which must carry this as an active drafting instruction, per "How to apply".
- **Not subject:** a prohibition that is load-bearing per the test below. Such a prohibition is a legitimate obligation, not a violation — for example [src/commands/.docs/rules/ai/agents/no-git-writes.md](/src/commands/.docs/rules/ai/agents/no-git-writes.md) and [src/prompts/.docs/rules/ai/review/reviewer-does-not-run-build-or-test.md](/src/prompts/.docs/rules/ai/review/reviewer-does-not-run-build-or-test.md), which each forbid a behavior an implementer would otherwise plausibly perform.
- **Not subject:** plan files under `plans/` (`/flanders-plan` output), which sequence work rather than pin obligations.

## When a prohibition is load-bearing

A prohibition is load-bearing — and is therefore written — only when BOTH conditions hold:

1. **Not already entailed.** Its absence is not already implied by a positive obligation in the spec. A positive obligation stated exclusively — "the only X is Y", "exactly these…" — already excludes every alternative, so a prohibition restating that exclusion adds nothing.
2. **Guards a plausible mistake.** Reading only the positive spec, a competent implementer would plausibly introduce the prohibited behavior anyway. The behavior qualifies in either of two cases: it is an attractive default the implementer would reach for; or it falls inside a responsibility the component otherwise has — an agent that legitimately runs commands but must not write to git, a reviewer whose job is reviewing but must not run the build.

A prohibition that fails either condition is not written: a prohibition of a behavior the positive spec already excludes, or of a behavior no competent implementer would introduce (the "does not format the disk on install" kind), is noise.

## How to apply

- The `/flanders-spec` skill artifact body states this **actively in its drafting guidance** — a direct instruction to phrase each obligation as the behavior the code performs, to satisfy a removal request by describing the resulting positive behavior, and to admit an explicit prohibition only when it is load-bearing per the test above — placed where the body tells the skill how to draft. This mirrors how [src/prompts/.docs/rules/ai/skills/spec/present-state-only.md](/src/prompts/.docs/rules/ai/skills/spec/present-state-only.md) carries its prohibition actively in the drafting guidance rather than deferring it. The active instruction stops a redundant prohibition being written in the first place; an instruction deferred to a post-write step is reactive, forcing the skill to write the non-action and then undo it.
- Whether a prohibition is load-bearing is a judgment about entailment and plausibility rather than a textual pattern, so the active drafting instruction in the skill body is the enforcement surface for this obligation.

## Failure signals

- A rule authored by `/flanders-spec` states an obligation as a prohibition of a behavior the positive spec already excludes — for example, the spec already says the only subprocess a command launches is one specific probe, and a separate rule forbids launching a different tool merely to test that it is present.
- A request to remove a behavior is satisfied by adding a rule that forbids the removed behavior, instead of by describing the resulting positive behavior and letting the removed behavior vanish by omission.
- A spec enumerates a non-action no competent implementer would perform — the "does not format the disk on install" kind — treating the absence of an absurd behavior as an obligation.
- The `/flanders-spec` skill artifact body surfaces this obligation only as a post-write check, with no active instruction in its drafting guidance.
