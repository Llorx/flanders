# Shared content-skill rules

## Every Flanders content skill hosts its final validator the same way

The Flanders content skills (`/flanders-spec`, `/flanders-plan`) each gate their persisted output through a final validator subagent. The host behavior of that validator — how it is spawned, what it receives, how it produces its verdict, and how the skill reacts to a FAIL — is identical across both skills. This rule pins that shared host behavior in one place. Each skill's per-skill rule — [src/prompts/.spec/rules/ai/skills/spec.md#the-flanders-spec-validator-audits-each-artifact-by-its-folder-against-the-spec-check-categories](/src/prompts/.spec/rules/ai/skills/spec.md#the-flanders-spec-validator-audits-each-artifact-by-its-folder-against-the-spec-check-categories) and [src/prompts/.spec/rules/ai/skills/plan.md#the-flanders-plan-validator-audits-the-plan-against-five-categories](/src/prompts/.spec/rules/ai/skills/plan.md#the-flanders-plan-validator-audits-the-plan-against-five-categories) — pins only the check categories that are specific to that skill's artifact.

### Who this applies to

- **Subject:** every Flanders content skill that owns a final-validator stage — today `/flanders-spec` and `/flanders-plan` — as the host that orchestrates the validator launch.
- **Subject (when running as a subagent):** the validator instance, in the obligations described below about its read-only behavior and the shape of its output.
- **Not subject:** skills or commands that do not have a final-validator stage. The `implement` command's adversarial reviewer is a separate gate with its own contract in [.spec/contracts/cli-commands/implement/iteration-loop.md](/.spec/contracts/cli-commands/implement/iteration-loop.md).

### How the validator is hosted

The validator runs as a subagent — spawned via the AI tool's subagent mechanism — in a fresh session that does not share context with the drafting phase. The fresh session is load-bearing: it forces the validator to re-derive its judgments from the artifact on disk and from the canonical listings, instead of inheriting the drafter's confirmation bias.

The subagent mechanism is tool-specific. In Claude Code, the host spawns the validator through the `Agent` tool. In Codex CLI, the host spawns it through whatever Codex documents as its subagent surface at the time of the run. The host chooses the mechanism based on the AI tool it is running inside.

The host may fall back to an **inline pass** (running the checks in its own session, without spawning a subagent) only when the subagent invocation is genuinely unavailable or fails. Concretely, an inline fallback is allowed when:

- The AI tool the host is running in does not expose a subagent mechanism (for example, Codex CLI without a documented subagent surface at run time).
- A subagent invocation returns an error that the host cannot recover from (spawn failure, transport error, environment refusal).

An inline fallback is not allowed for ergonomic reasons (the artifact looks small, the drafter is confident, tokens feel tight). When the host takes the inline path, it states in chat that it is falling back to inline validation and names the concrete reason; a silent fallback is a violation.

### What the validator receives

The host packages the validator's prompt with all four of the following, regardless of which skill is invoking the validator:

1. The absolute path to the artifact file. When the skill produced or updated multiple files, every absolute path is included plus an explicit enumeration of which subset of the canonical listing is under audit in this run.
2. The canonical listing(s) captured by the skill at the start of the run. Which listings to pass is named by the per-skill rule (every skill passes both the contracts and the rules listings).
3. The **verbatim text of every check obligation enumerated by the per-skill rule.** The host MUST inline those obligations in the prompt — it does not just point the validator at the per-skill rule file by path, and it does not rely on the validator discovering check obligations through transitive reading of the skill's own contract. Without the verbatim text, the validator's categories collapse to whatever the validator chooses to read on its own, and gaps appear silently. Including the verbatim text closes that gap.
4. The output-format spec described in the `Output shape` section below.

In addition to these four, a per-skill rule may require the host to pass inputs specific to that skill's artifact. The per-skill rule enumerates such inputs, and the host passes them alongside the four above.

The validator reads the artifact(s) in full, plus any contract or rule from the listings that it judges relevant to forming its verdict.

### Validator read-only discipline

The validator is read-only on the project: it does not edit, write, rename, or delete any file. It is also read-only on git, subject to [src/commands/.spec/rules/ai/agents.md#autonomous-subagents-never-write-to-git](/src/commands/.spec/rules/ai/agents.md#autonomous-subagents-never-write-to-git). This obligation applies regardless of the host mechanism, including the inline fallback path.

### Output shape

The validator's final output is a verdict, not a deliverable. Because it produces a verdict, it is **not subject** to the Evidence-Report obligation of [src/commands/.spec/rules/ai/evidence.md#adversarially-reviewed-subagents-self-audit-via-an-evidence-report](/src/commands/.spec/rules/ai/evidence.md#adversarially-reviewed-subagents-self-audit-via-an-evidence-report) — the validator must not append an Evidence Report or any other multi-line content after the verdict line, and must not insert one before it.

The verdict has one of two shapes, on a single final line:

- `PASS`
- `FAIL <enumerated issues>` — each issue stated clearly enough that the host's auto-fix step can act on it. Multiple issues are listed inline on the same final line, separated in a way the host can parse; the verdict line stays single-line.

If the validator wants to show its work, it does so in the body of its response above the verdict line. The verdict line itself is the last line of the response.

### How the host reacts to FAIL

When the validator returns FAIL, the host enters a triage-then-fix loop. The triage step is non-negotiable: the host MUST process every issue through it before reaching for any rewrite, so that failures requiring user input are surfaced as questions rather than silently patched.

1. **Triage each issue.** For every issue enumerated in the FAIL report, the host classifies it against the clarification-scope of the originating skill's contract — the same criteria that govern that skill's initial clarification phase. The originating skill maps to its clarification-scope source as follows:
   - `/flanders-spec` — the clarification phase in [.spec/contracts/ai-skills/spec-skill.md](/.spec/contracts/ai-skills/spec-skill.md).
   - `/flanders-plan` — the clarification phase in [.spec/contracts/ai-skills/plan-skill.md](/.spec/contracts/ai-skills/plan-skill.md), further constrained by [src/prompts/.spec/rules/ai/skills/plan.md#flanders-plan-clarification-questions-are-limited-to-genuinely-unsettled-implementation-choices-scope-ambiguities-and-unbacked-runtime-premises](/src/prompts/.spec/rules/ai/skills/plan.md#flanders-plan-clarification-questions-are-limited-to-genuinely-unsettled-implementation-choices-scope-ambiguities-and-unbacked-runtime-premises).

   An issue lands in one of two buckets:
   - **Re-clarify bucket** — the issue's fix would commit the skill to an answer that, per the originating skill's clarification-scope, the user is the one who must give, and that the user did not give in the initial clarification phase of this invocation. The host re-enters the originating skill's clarification phase for that specific ambiguity before any rewrite happens. Re-entered clarification follows the same question mechanics the originating skill's contract already pins: one question per turn, multiple-choice preferred when the answer space is bounded, no bundling. The re-entered phase is scoped to the specific ambiguity the issue closes — it is not the original phase re-run wholesale, and it does not re-ask decisions the user has already given in this same invocation.
   - **Silent-fix bucket** — every other issue. This covers formatting, missing links, naming, numbering, placeholders that do not require a user-level decision, and any other fix the originating skill's contract authorizes the skill to resolve on its own. The host applies these in place without asking.

2. **Apply the fixes.** With the answers gathered for the re-clarify bucket (if any) and the silent-fix bucket determined, the host rewrites the affected artifact(s) in place, addressing every enumerated issue.
3. **Re-launch the validator** (a new subagent in a fresh session when the subagent host is available) over the rewritten artifact(s).
4. The cycle repeats. The host performs at most **five** triage-then-fix passes per skill invocation. The fifth FAIL ends the loop.

When the loop ends with a PASS at any iteration, the host proceeds to its end-of-run summary as defined by the skill's own contract.

When the loop ends with FAIL — i.e., after five unsuccessful passes — the host stops, does not declare complete, and surfaces the last FAIL report along with the artifact path(s) to the user in chat. It is then the user's call to redirect, restart, or accept the partial output. The host does not silently leave a failing artifact on disk as if it were valid.

Triage never broadens the originating skill's clarification-scope: an issue the originating skill would not have asked about in its initial clarification phase is never asked about during the fix loop either. It is fixed in place per the silent-fix bucket.

### Failure signals

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

## Skills read relevant references before drafting

Before drafting any deliverable, `/flanders-spec` and `/flanders-plan` read every file in their canonical reference set that is relevant to the request. Reading is not optional. A draft that begins without the relevant files having been read is invalid, regardless of how confident the drafter is about the request.

### Who this applies to

- **Subject:** every invocation of the two Flanders skills:
  - `/flanders-spec`
  - `/flanders-plan`
- **Not subject:** other agents and commands, including the `implement` command and the workers, reviewers, and validators it spawns. They consult contracts and rules under their own rules and are out of scope here.

### Canonical reference set per skill

The reference set is the existing spec content the new deliverable must be consistent with — every contract under a `.spec/contracts` folder and every rule under a `.spec/rules` folder, discovered across the whole project tree per [src/workspace/.spec/rules/spec-discovery.md#the-spec-corpus-is-enumerated-by-recursive-discovery-of-spec-folders](/src/workspace/.spec/rules/spec-discovery.md#the-spec-corpus-is-enumerated-by-recursive-discovery-of-spec-folders):

- `/flanders-spec` — the project's contracts and rules.
- `/flanders-plan` — the project's contracts and rules.

The reference set is captured at invocation. Files added or removed mid-run are not picked up retroactively. The drafter does not consult any other source — for example, a stale snapshot held in conversation context, a previous run's listing, or memory — in place of the state captured at invocation.

### What "relevant" means

A file in the canonical reference set is relevant to the request when any of the following is true:

- It defines an obligation the new deliverable must respect or contradict-check against.
- It covers content the new deliverable would update or extend in place.
- It sits in a topically adjacent namespace whose existing wording shapes how the new deliverable should be written (to preserve consistency of style, scope, and vocabulary).

When in doubt, the drafter reads rather than omits. Under-reading is more costly than over-reading: a deliverable that contradicts or duplicates an unread file is invalid, while a few extra reads only cost time.

### When the read happens

Reading happens before the clarification phase concludes and certainly before the drafting phase begins. The drafter does not start drafting on the assumption that it will read relevant files later, and does not present a planned file layout in the drafting phase without having already read the files that would shape that layout.

### Failure signals

- The skill drafts a contract, rule, or plan without having read the existing files it must avoid contradicting or duplicating.
- The skill picks a subset of "obviously relevant" files and skips others whose obligations would shape the deliverable.
- The skill drafts against a stale reference set instead of the state captured at invocation.
- The skill presents a planned file layout for user approval without having read the files in the canonical reference set that overlap with that layout.
- The skill produces a deliverable that contradicts or duplicates an existing file that the skill, on inspection, had not read.

## Skills run a self-review pass on the draft before persisting

Before persisting any deliverable, `/flanders-spec` and `/flanders-plan` re-read the draft and audit it against a fixed checklist. Any issue is fixed in place. The content the user approved during the drafting phase differs by skill: for `/flanders-spec`, it is the layout summary the user approved (the file list and the key obligations promised in it); for `/flanders-plan`, there is no user-approved content at all. When a fix would change the meaning of content the user approved, the skill surfaces the issue to the user and asks before applying the fix; for `/flanders-plan`, no such content exists, so findings are always fixed silently. A draft that has not been self-reviewed against this checklist must not be persisted.

### Who this applies to

- **Subject:** every invocation of the two Flanders skills:
  - `/flanders-spec`
  - `/flanders-plan`
- **Not subject:** other agents and commands. The post-persist final-validator pinned in [src/prompts/.spec/rules/ai/skills/plan.md#the-flanders-plan-validator-audits-the-plan-against-five-categories](/src/prompts/.spec/rules/ai/skills/plan.md#the-flanders-plan-validator-audits-the-plan-against-five-categories) is a separate, additional quality gate for `/flanders-plan`; it does not replace this pre-persist self-review.

### When the self-review runs

The self-review is the last step the skill performs before persistence; persisting a draft and then verifying it is not a substitute for this pre-persist pass. The trigger point differs by skill:

- `/flanders-spec` — the self-review runs after the user approves the layout summary and before the skill writes the batch of files to disk. Every file in the batch is self-reviewed before being persisted.
- `/flanders-plan` — the self-review runs after the clarification phase ends and before the skill writes the plan file to disk. No user approval precedes it.

### The self-review checklist

The skill audits the draft against all of the following, every time:

1. **No placeholders left behind.** No `TODO`, no `TBD`, no `<placeholder>`-style markers, no half-finished sentences, no "(fill in)"-style fragments.
2. **No contradictions with the canonical reference set.** The draft is consistent with every relevant file in the canonical reference set as captured at invocation (per [src/prompts/.spec/rules/ai/skills/skills-common.md#skills-read-relevant-references-before-drafting](/src/prompts/.spec/rules/ai/skills/skills-common.md#skills-read-relevant-references-before-drafting)). For both `/flanders-spec` and `/flanders-plan`, contradictions are checked against the full canonical reference set — every contract under a `.spec/contracts` folder and every rule under a `.spec/rules` folder, per [src/prompts/.spec/rules/ai/skills/skills-common.md#skills-read-relevant-references-before-drafting](/src/prompts/.spec/rules/ai/skills/skills-common.md#skills-read-relevant-references-before-drafting).
3. **No ambiguous wording.** Every obligation, rule, or task description is unambiguous about scope, subject, and applicability. A reader who is not in this conversation must be able to interpret the draft a single way.
4. **No scope drift.** The draft does not introduce obligations, rules, or tasks that were not part of the request the user approved during the drafting phase.

A failure in any one of these is treated as a finding and must be addressed before persistence.

### How the skill reacts to a finding

When the self-review surfaces a finding, the skill does one of the following:

- **Mechanical fix that does not change meaning** — for example, removing a stray placeholder, rewording an ambiguous sentence without altering the obligation, or pruning content that drifted outside scope. The skill fixes the draft in place and re-runs the self-review on the fixed version.
- **Fix that would change the meaning of already-approved content** — applies only to `/flanders-spec`, whose user-approved content is the layout summary (the file list and the key obligations promised in it). When such a fix is needed, the skill stops, surfaces the issue to the user in chat (naming the file, the finding, and the proposed change), and waits for the user's decision before applying it. The skill does not silently rewrite content the user already approved. For `/flanders-plan`, this branch never triggers, because no content in the draft is user-approved; every finding in a plan draft is handled by the mechanical-fix branch above.

The self-review loop ends only when the draft passes every item on the checklist. The skill does not persist a draft with an open finding.

### Failure signals

- The skill persists a file without having run the self-review checklist on the final draft.
- The skill persists a file with a placeholder, a contradiction against an existing canonical file, an ambiguous obligation, or scope drift the user did not approve.
- For `/flanders-spec`, the skill silently rewrites content that the user approved in the layout summary as part of a self-review fix, instead of surfacing the issue to the user.
- The skill exits the self-review loop with an open finding still standing and treats the deliverable as complete.
- The skill substitutes a post-persist verification (re-read the file from disk and check it) for the pre-persist self-review the draft is owed.

## Flanders skill artifact prompts are self-contained — no citations of flanders-internal spec paths

The body of every Flanders skill artifact — the prompt text that the `install` command writes to the user's AI-tool skill folders, where each artifact represents `/flanders-spec`, `/flanders-plan`, or `/flanders-work` — is self-contained. Every obligation the artifact enforces is inline in its body. The body never cites a specific spec file from flanders' own development spec — a file inside one of flanders' own `.spec/contracts` or `.spec/rules` folders, or inside flanders' `plans/` folder — because that specific file does not exist in the user's project where the artifact runs, so the citation resolves to nothing.

### Who this applies to

- **Subject:** the source content that produces each Flanders skill artifact body — every place in the flanders codebase where the prompt text shipped by `install` is authored or assembled.
- **Subject:** the resulting skill artifact files that `install` writes into the user's AI-tool skill folders.
- **Not subject:** files inside flanders' own `.spec/contracts` and `.spec/rules` folders (at any depth in the project tree) and flanders' own `plans/` folder, which freely cross-reference each other by relative path. Those files are flanders' development spec and never ship to user projects.

### What is forbidden in a skill artifact body

- A relative or absolute path that names a specific file inside one of flanders' own `.spec/contracts` or `.spec/rules` folders, or inside flanders' `plans/` folder. Examples of what NOT to embed: `.spec/contracts/ai-skills/spec-skill.md`, `src/prompts/.spec/rules/ai/skills/skills-common.md#every-flanders-content-skill-hosts-its-final-validator-the-same-way`, `src/commands/.spec/rules/ai/agents.md#autonomous-subagents-never-write-to-git`, `.spec/contracts/shared/spec-folder-write-authority.md`, `.spec/contracts/cli-commands/install.md`.
- A phrase that defers an obligation to such a file — "the full obligation lives in X", "subject to X", "see X for the canonical definition", "verbatim from X", and analogous deferrals — when `X` is a flanders-internal spec path. The obligation itself is inlined in the body; the pointer is removed.

### What is permitted in a skill artifact body

- Structural references to the user's project spec folders by their conventional shape — `.spec/contracts` and `.spec/rules` folders (which may appear at any level of the project tree) and the project-root `plans/` folder — without naming a specific file inside them. For example: "discover every `.spec/contracts` folder in the project tree", "persist exactly one markdown file inside the project's `plans/` folder", "for every leaf task, link the relevant contract file or files by their listed relative path".
- Names of user-visible AI tools the skill targets (Claude Code, Codex CLI) and the install destinations those tools use as already pinned by the install behavior the user has consented to.

The body never embeds a specific file path that points to a file from flanders' own spec.

### How to apply this rule

When authoring or editing a skill artifact body source, search the body for any path that names a specific file inside a `.spec/contracts` folder, a `.spec/rules` folder (at any depth — including the nested `src/**/.spec/rules` folders), or the `plans/` folder, rather than just naming the folder. Every such citation is removed. The substantive obligation the citation pointed at is inlined in its place — the citation is the only thing being stripped; the obligation itself stays in the body. The result is a body that, when shipped to an arbitrary user project, makes sense in that project without requiring access to flanders' own repository.

When a flanders-internal spec file is renamed, the correct response in any skill artifact body that cites it is to REMOVE the citation, not to update the path.

### Failure signals

- A skill artifact body, once written by `install` into a user project, names a specific file inside a `.spec/contracts` folder, a `.spec/rules` folder, or the `plans/` folder — and that specific file does not exist in the user's project (because it belongs to flanders' own development spec).
- A skill artifact body says "the full obligation lives in X.md", "verbatim from X.md", or any analogous deferral, where X is a flanders-internal spec path.
- A flanders-internal spec file is renamed and the rename is propagated into a skill artifact body as a path update, instead of the citation being removed entirely.
- The artifact body source in flanders' codebase is edited to add a new citation to a flanders-internal spec path instead of inlining the obligation.
