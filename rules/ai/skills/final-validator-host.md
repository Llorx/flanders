# Every Flanders content skill hosts its final validator the same way

The Flanders content skills (`/flanders-plan`, `/flanders-contract`, `/flanders-rule`) each gate their persisted output through a final validator subagent. The host behavior of that validator — how it is spawned, what it receives, how it produces its verdict, and how the skill reacts to a FAIL — is identical across the three skills. This rule pins that shared host behavior in one place. Each skill's per-skill rule under `rules/ai/skills/{plan,contract,rule}/final-validator.md` pins only the check categories that are specific to that skill's artifact.

## Who this applies to

- **Subject:** every Flanders content skill that owns a final-validator stage — today `/flanders-plan`, `/flanders-contract`, and `/flanders-rule` — as the host that orchestrates the validator launch.
- **Subject (when running as a subagent):** the validator instance, in the obligations described below about its read-only behavior and the shape of its output.
- **Not subject:** skills or commands that do not have a final-validator stage. The `implement` command's adversarial reviewer is a separate gate with its own contract in `contracts/cli-commands/implement/iteration-loop.md`.

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
2. The canonical listing(s) captured by the skill at the start of the run. Which listings to pass is named by the per-skill rule (for example, `/flanders-plan` passes both the contracts and the rules listings; `/flanders-contract` passes both; `/flanders-rule` passes both).
3. The **verbatim text of every check obligation enumerated by the per-skill rule.** The host MUST inline those obligations in the prompt — it does not just point the validator at the per-skill rule file by path, and it does not rely on the validator discovering check obligations through transitive reading of the skill's own contract. Without the verbatim text, the validator's categories collapse to whatever the validator chooses to read on its own, and gaps appear silently. Including the verbatim text closes that gap.
4. The output-format spec described in the `Output shape` section below.

The validator reads the artifact(s) in full, plus any contract or rule from the listings that it judges relevant to forming its verdict.

## Validator read-only discipline

The validator is read-only on the project: it does not edit, write, rename, or delete any file. It is also read-only on git, subject to `rules/ai/agents/no-git-writes.md`. This obligation applies regardless of the host mechanism, including the inline fallback path.

## Output shape

The validator's final output is a verdict, not a deliverable. Because it produces a verdict, it is **not subject** to the Evidence-Report obligation of `rules/ai/agents/evidence-report.md` — the validator must not append an Evidence Report or any other multi-line content after the verdict line, and must not insert one before it.

The verdict has one of two shapes, on a single final line:

- `PASS`
- `FAIL <enumerated issues>` — each issue stated clearly enough that the host's auto-fix step can act on it. Multiple issues are listed inline on the same final line, separated in a way the host can parse; the verdict line stays single-line.

If the validator wants to show its work, it does so in the body of its response above the verdict line. The verdict line itself is the last line of the response.

## How the host reacts to FAIL

When the validator returns FAIL, the host enters an auto-fix loop:

1. The host reads the FAIL report and rewrites the affected artifact(s) in place, addressing each enumerated issue.
2. The host re-launches the validator (a new subagent in a fresh session when the subagent host is available) over the rewritten artifact(s).
3. The cycle repeats. The host performs at most **five** auto-fix passes per skill invocation. The fifth FAIL ends the loop.

When the loop ends with a PASS at any iteration, the host proceeds to its end-of-run summary as defined by the skill's own contract.

When the loop ends with FAIL — i.e., after five unsuccessful auto-fix passes — the host stops, does not declare complete, and surfaces the last FAIL report along with the artifact path(s) to the user in chat. It is then the user's call to redirect, restart, or accept the partial output. The host does not silently leave a failing artifact on disk as if it were valid.

## Failure signals

- The host prints its end-of-run summary without having launched the validator at all.
- The host takes the inline fallback without stating in chat that it is falling back and naming the concrete reason.
- The host packages the validator prompt without the verbatim check obligations from the per-skill rule, forcing the validator to discover what to check by transitive contract reading.
- The validator subagent edits, writes, renames, or deletes any file in the project, or runs a git command that mutates state.
- The validator's response includes an Evidence Report, or any multi-line content after the final verdict line.
- The validator's verdict line is not exactly `PASS` or `FAIL <enumerated issues>` on a single trailing line.
- The host receives a FAIL and declares complete without running the auto-fix loop.
- The auto-fix loop exceeds five passes within a single skill invocation.
- The host ends with a FAIL still standing and silently writes its end-of-run summary as if the artifact were valid, instead of surfacing the FAIL to the user.
