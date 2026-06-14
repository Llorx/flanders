# Every Flanders content skill hosts its final validator the same way

The Flanders content skills (`/flanders-spec`, `/flanders-plan`) each gate their persisted output through a final validator subagent. The host behavior of that validator — how it is spawned, what it receives, how it produces its verdict, and how the skill reacts to a FAIL — is identical across both skills. This rule pins that shared host behavior in one place. Each skill's per-skill rule — [src/prompts/.docs/rules/ai/skills/spec/final-validator.md](/src/prompts/.docs/rules/ai/skills/spec/final-validator.md) and [src/prompts/.docs/rules/ai/skills/plan/final-validator.md](/src/prompts/.docs/rules/ai/skills/plan/final-validator.md) — pins only the check categories that are specific to that skill's artifact.

## Who this applies to

- **Subject:** every Flanders content skill that owns a final-validator stage — today `/flanders-spec` and `/flanders-plan` — as the host that orchestrates the validator launch.
- **Subject (when running as a subagent):** the validator instance, in the obligations described below about its read-only behavior and the shape of its output.
- **Not subject:** skills or commands that do not have a final-validator stage. The `implement` command's adversarial reviewer is a separate gate with its own contract in [.docs/contracts/cli-commands/implement/iteration-loop.md](/.docs/contracts/cli-commands/implement/iteration-loop.md).

## How the validator is hosted

The validator runs as a subagent — spawned via the AI tool's subagent mechanism — in a fresh session that does not share context with the drafting phase. The fresh session is load-bearing: it forces the validator to re-derive its judgments from the artifact on disk and from the canonical listings, instead of inheriting the drafter's confirmation bias.

The subagent mechanism is tool-specific. In Claude Code, the host spawns the validator through the `Agent` tool. In Codex CLI, the host spawns it through whatever Codex documents as its subagent surface at the time of the run. The host chooses the mechanism based on the AI tool it is running inside.

The host may fall back to an **inline pass** (running the checks in its own session, without spawning a subagent) only when the subagent invocation is genuinely unavailable or fails. Concretely, an inline fallback is allowed when:

- The AI tool the host is running in does not expose a subagent mechanism (for example, Codex CLI without a documented subagent surface at run time).
- A subagent invocation returns an error that the host cannot recover from (spawn failure, transport error, environment refusal).

An inline fallback is not allowed for ergonomic reasons (the artifact looks small, the drafter is confident, tokens feel tight). When the host takes the inline path, it states in chat that it is falling back to inline validation and names the concrete reason; a silent fallback is a violation.

## What the validator receives

The host packages the validator's prompt with all four of the following, regardless of which skill is invoking the validator:

1. The absolute path to the artifact file. When the skill produced or updated multiple files, every absolute path is included plus an explicit enumeration of which subset of the canonical listing is under audit in this run.
2. The canonical listing(s) captured by the skill at the start of the run. Which listings to pass is named by the per-skill rule (every skill passes both the contracts and the rules listings).
3. The **verbatim text of every check obligation enumerated by the per-skill rule.** The host MUST inline those obligations in the prompt — it does not just point the validator at the per-skill rule file by path, and it does not rely on the validator discovering check obligations through transitive reading of the skill's own contract. Without the verbatim text, the validator's categories collapse to whatever the validator chooses to read on its own, and gaps appear silently. Including the verbatim text closes that gap.
4. The output-format spec described in the `Output shape` section below.

In addition to these four, a per-skill rule may require the host to pass inputs specific to that skill's artifact. The per-skill rule enumerates such inputs, and the host passes them alongside the four above.

The validator reads the artifact(s) in full, plus any contract or rule from the listings that it judges relevant to forming its verdict.

## Validator read-only discipline

The validator is read-only on the project: it does not edit, write, rename, or delete any file. It is also read-only on git, subject to [src/commands/.docs/rules/ai/agents/no-git-writes.md](/src/commands/.docs/rules/ai/agents/no-git-writes.md). This obligation applies regardless of the host mechanism, including the inline fallback path.

## Output shape

The validator's final output is a verdict, not a deliverable. Because it produces a verdict, it is **not subject** to the Evidence-Report obligation of [src/commands/.docs/rules/ai/agents/evidence-report.md](/src/commands/.docs/rules/ai/agents/evidence-report.md) — the validator must not append an Evidence Report or any other multi-line content after the verdict line, and must not insert one before it.

The verdict has one of two shapes, on a single final line:

- `PASS`
- `FAIL <enumerated issues>` — each issue stated clearly enough that the host's auto-fix step can act on it. Multiple issues are listed inline on the same final line, separated in a way the host can parse; the verdict line stays single-line.

If the validator wants to show its work, it does so in the body of its response above the verdict line. The verdict line itself is the last line of the response.

## How the host reacts to FAIL

When the validator returns FAIL, the host enters a triage-then-fix loop. The triage step is non-negotiable: the host MUST process every issue through it before reaching for any rewrite, so that failures requiring user input are surfaced as questions rather than silently patched.

1. **Triage each issue.** For every issue enumerated in the FAIL report, the host classifies it against the clarification-scope of the originating skill's contract — the same criteria that govern that skill's initial clarification phase. The originating skill maps to its clarification-scope source as follows:
   - `/flanders-spec` — the clarification phase in [.docs/contracts/ai-skills/spec-skill.md](/.docs/contracts/ai-skills/spec-skill.md).
   - `/flanders-plan` — the clarification phase in [.docs/contracts/ai-skills/plan-skill.md](/.docs/contracts/ai-skills/plan-skill.md), further constrained by [src/prompts/.docs/rules/ai/skills/plan/clarification-scope.md](/src/prompts/.docs/rules/ai/skills/plan/clarification-scope.md).

   An issue lands in one of two buckets:
   - **Re-clarify bucket** — the issue's fix would commit the skill to an answer that, per the originating skill's clarification-scope, the user is the one who must give, and that the user did not give in the initial clarification phase of this invocation. The host re-enters the originating skill's clarification phase for that specific ambiguity before any rewrite happens. Re-entered clarification follows the same question mechanics the originating skill's contract already pins: one question per turn, multiple-choice preferred when the answer space is bounded, no bundling. The re-entered phase is scoped to the specific ambiguity the issue closes — it is not the original phase re-run wholesale, and it does not re-ask decisions the user has already given in this same invocation.
   - **Silent-fix bucket** — every other issue. This covers formatting, missing links, naming, numbering, placeholders that do not require a user-level decision, and any other fix the originating skill's contract authorizes the skill to resolve on its own. The host applies these in place without asking.

2. **Apply the fixes.** With the answers gathered for the re-clarify bucket (if any) and the silent-fix bucket determined, the host rewrites the affected artifact(s) in place, addressing every enumerated issue.
3. **Re-launch the validator** (a new subagent in a fresh session when the subagent host is available) over the rewritten artifact(s).
4. The cycle repeats. The host performs at most **five** triage-then-fix passes per skill invocation. The fifth FAIL ends the loop.

When the loop ends with a PASS at any iteration, the host proceeds to its end-of-run summary as defined by the skill's own contract.

When the loop ends with FAIL — i.e., after five unsuccessful passes — the host stops, does not declare complete, and surfaces the last FAIL report along with the artifact path(s) to the user in chat. It is then the user's call to redirect, restart, or accept the partial output. The host does not silently leave a failing artifact on disk as if it were valid.

Triage never broadens the originating skill's clarification-scope: an issue the originating skill would not have asked about in its initial clarification phase is never asked about during the fix loop either. It is fixed in place per the silent-fix bucket.

## Failure signals

- The host prints its end-of-run summary without having launched the validator at all.
- The host takes the inline fallback without stating in chat that it is falling back and naming the concrete reason.
- The host packages the validator prompt without the verbatim check obligations from the per-skill rule, forcing the validator to discover what to check by transitive contract reading.
- The validator subagent edits, writes, renames, or deletes any file in the project, or runs a git command that mutates state.
- The validator's response includes an Evidence Report, or any multi-line content after the final verdict line.
- The validator's verdict line is not exactly `PASS` or `FAIL <enumerated issues>` on a single trailing line.
- The host receives a FAIL and declares complete without running the triage-then-fix loop.
- The host rewrites the artifact in place for a FAIL issue whose fix closes a clarification-scope ambiguity the originating skill's contract pins as user-input territory and that the user did not resolve in the initial clarification phase, instead of re-entering the originating skill's clarification phase for that ambiguity.
- The triage step is collapsed into the rewrite — the host reads the FAIL report and rewrites without first classifying each issue against the originating skill's clarification-scope.
- The host re-asks decisions the user has already given in the same skill invocation when re-entering the clarification phase, instead of scoping the re-entered phase to the specific ambiguity at hand.
- The host broadens the originating skill's clarification-scope during the fix loop — asks about an issue the originating skill's contract would not have asked about in its initial clarification phase.
- The triage-then-fix loop exceeds five passes within a single skill invocation.
- The host ends with a FAIL still standing and silently writes its end-of-run summary as if the artifact were valid, instead of surfacing the FAIL to the user.
