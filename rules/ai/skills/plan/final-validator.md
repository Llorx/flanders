# The plan skill gates its output through a final validator

Before `/flanders-plan` declares its work complete, the skill runs a **final validator** over the plan file it just wrote. The validator is an independent quality gate: it audits the plan file against `contracts/shared/plan-file-format.md` and against the canonical contract/rule listings captured at the start of the run, returns a verdict, and the skill only declares complete once the verdict is PASS. A plan that has not been validated by this step has not been generated correctly, regardless of how confident the drafting phase was.

## Who this applies to

- **Subject:** the `/flanders-plan` skill itself, as the agent that orchestrates the validator. The obligation applies to every invocation of the skill, including invocations that the skill judges trivial.
- **Subject (when running as a subagent):** the validator instance, in the obligations described below about its inputs, its read-only behavior, and the shape of its output.
- **Not subject:** the `/flanders-contract` and `/flanders-rule` skills. They have their own verification steps and are out of scope here.

## How the validator is hosted

The validator runs as a subagent — spawned via the `Agent` tool — in a fresh session that does not share context with the drafting phase. The fresh session is load-bearing: it forces the validator to re-derive its judgments from the file on disk and the canonical listings, instead of inheriting the drafter's confirmation bias.

The skill may fall back to an **inline pass** (running the same checks in its own session, without spawning a subagent) only when the subagent invocation is genuinely unavailable or fails. Concretely, an inline fallback is allowed when:

- The `Agent` tool is not present in the environment the skill is running in.
- An `Agent` invocation returns an error that the skill cannot recover from (spawn failure, transport error, environment refusal).

An inline fallback is not allowed for ergonomic reasons (the plan looks small, the drafter is confident, tokens are tight). When the skill takes the inline path, it states in chat that it is falling back to inline validation and names the reason; a silent fallback is a violation of this rule.

## What the validator receives

The validator's input, regardless of host, is:

1. The absolute path to the plan file just written.
2. The canonical contract listing captured at the start of the run (every relative path under `contracts/`, as the skill enumerated them in its step 1).
3. The canonical rule listing captured at the start of the run (every relative path under `rules/`).

The validator is expected to read the plan file in full, plus any contract or rule file from the listings that it judges relevant to forming its verdict. The validator is read-only on the project: it does not edit, write, rename, or delete any file. It is also read-only on git (subject to `rules/ai/agents/no-git-writes.md` when running as a subagent).

## What the validator must check

The validator audits three categories, all three are mandatory, and a failure in any one of them is a FAIL:

1. **Format and shape.** Every task line conforms to `contracts/shared/plan-file-format.md`: a valid `[ ]` or `[x]` checkbox (no malformed variants), an immediately-following metrics object literally equal to `{"it":0,"ot":0,"t":0}` for freshly-generated tasks, a hierarchical task number, and a title. Leaf tasks carry the checkbox and the metrics object; parent groupings carry neither. Numbering is coherent with document position (`1` before `2`, `1.1` before `1.2`, no malformed numbering). Each leaf task carries a description and an explicit acceptance-criteria section. The plan file lives inside `plans/` and is non-empty, and at least one task line exists.
2. **Semantic dependency order.** Tasks appear top-to-bottom in the order they must be implemented. The audit is semantic, not numeric: the validator reads the description and acceptance criteria of each task and confirms that no task depends on work performed by a task that appears later in the document. A plan whose numbering is well-formed but whose dependencies flow upward fails this check.
3. **Spec-folder write boundary and contract non-contradiction.** No task — leaf or parent — describes work that creates, modifies, deletes, or renames any file inside `contracts/`, `rules/`, or `plans/`. There is no exception for flipping checkboxes or rewriting metrics: those mutations are performed programmatically by the `implement` command and are never described by a task. Additionally, the plan as a whole does not contradict any contract or rule in the canonical listings.

Out of scope: verifying that contract and rule paths referenced by tasks resolve to files that physically exist on disk. The validator does not perform that check.

## Output shape

The validator's final output is a verdict, not a deliverable. Because it produces a verdict, it is **not subject** to the Evidence-Report obligation of `rules/ai/agents/evidence-report.md` — the validator must not append an Evidence Report (or any other multi-line content) after its verdict line, and must not insert one before it.

The verdict has one of two shapes, on a single final line:

- `PASS`
- `FAIL <enumerated issues>` — each issue identified clearly enough that the skill's auto-fix step can act on it. Multiple issues are listed inline on the same final line, separated in a way the skill can parse; the verdict line stays single-line.

If the validator wants to show its work, it does so in the body of its response above the verdict line. The verdict line itself is the last line of the response.

## How the skill reacts to FAIL

When the validator returns FAIL, the skill enters an auto-fix loop:

1. The skill reads the FAIL report and rewrites the plan file in place, addressing each enumerated issue.
2. The skill re-launches the validator (a new subagent in a fresh session, when the subagent host is available) over the rewritten file.
3. The cycle repeats. The skill performs at most **five** auto-fix passes per `/flanders-plan` invocation. The fifth FAIL ends the loop.

When the loop ends with a FAIL — i.e., after five unsuccessful auto-fix passes — the skill stops, does not declare complete, and surfaces the last FAIL report to the user along with the plan file path. It is then the user's call to redirect, restart, or accept the partial output. The skill does not silently leave a failing plan on disk as if it were valid.

When the loop ends with a PASS at any iteration, the skill proceeds to its end-of-run chat summary as defined in `contracts/ai-skills/plan.md`.

## Failure signals

- The skill prints its end-of-run summary without having launched the validator at all.
- The skill takes the inline fallback without stating in chat that it is falling back and naming the reason.
- The validator subagent edits, writes, renames, or deletes any file in the project, or runs a git command that mutates state.
- The validator's response includes an Evidence Report, or any multi-line content after the final verdict line.
- The validator's verdict line is not exactly `PASS` or `FAIL <enumerated issues>` on a single trailing line.
- The skill receives a FAIL and declares complete without running the auto-fix loop.
- The auto-fix loop exceeds five passes within a single `/flanders-plan` invocation.
- The skill ends with a FAIL still standing and silently writes its end-of-run summary as if the plan were valid, instead of surfacing the FAIL to the user.
- The validator reports PASS on a plan whose tasks describe writing to `contracts/`, `rules/`, or `plans/` — including checkbox flips or metrics rewrites.
- The validator reports PASS on a plan in which a task depends on work performed by a later task, on the grounds that the numbering looks correct.
