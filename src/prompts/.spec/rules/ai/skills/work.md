# /flanders-work skill rules

## `/flanders-work` finalizes a clean review without committing, updating a plan, or writing Flanders configuration

When a `/flanders-work` review round ends with the reviewer reporting no violations, the skill's work is complete and it stops there. It does not commit the changes, does not create or modify any plan file, and does not write any Flanders configuration. The implemented changes are left in the working tree for the user to dispose of.

### Who this applies to

- **Subject:** the source content that produces the `/flanders-work` skill artifact body, and the `/flanders-work` skill at runtime, at the moment a review round ends with an empty verdict file per [src/prompts/.spec/rules/ai/skills/work.md#the-flanders-work-review-loop-is-driven-by-the-presence-and-content-of-a-temporary-error-log-file](/src/prompts/.spec/rules/ai/skills/work.md#the-flanders-work-review-loop-is-driven-by-the-presence-and-content-of-a-temporary-error-log-file).
- **Not subject:** the `implement` command, which finalizes an accepted task by flipping its plan-file checkbox and creating a per-task commit (see [.spec/contracts/cli-commands/implement/iteration-loop.md](/.spec/contracts/cli-commands/implement/iteration-loop.md) and [.spec/contracts/cli-commands/implement/git-integration.md](/.spec/contracts/cli-commands/implement/git-integration.md)).

### Behavior

On a clean review, the skill:

1. **Does not commit.** It runs no `git add`, `git commit`, or any other git command that mutates repository state. The changes remain as an uncommitted working tree for the user to review, amend, commit, or discard. (The reviewer subagent is separately forbidden from writing to git by [src/commands/.spec/rules/ai/agents.md#autonomous-subagents-never-write-to-git](/src/commands/.spec/rules/ai/agents.md#autonomous-subagents-never-write-to-git); this rule pins that the skill's own finalization also performs no commit.)

2. **Does not touch `plans/`.** It creates, modifies, deletes, and renames nothing in the `plans/` folder. `/flanders-work` has no plan file: its spec is the user's request, not a plan task, so there is no checkbox to flip and no metrics to record.

3. **Does not write Flanders configuration.** It writes nothing to `.flanders/`. The skill consumes no configuration and produces none.

The skill then reports completion to the user in chat, in the interaction language of [.spec/contracts/ai-skills/interaction-language.md](/.spec/contracts/ai-skills/interaction-language.md).

### Why

`/flanders-work` is the lightweight path that deliberately skips the `implement` pipeline's bookkeeping — plan files, per-task commits, and task metrics. Leaving the accepted changes uncommitted in the working tree hands control of how the work enters history back to the user, which fits a quick, in-session task where the user is present and decides what to do next.

### Failure signals

- The skill commits, stages, or otherwise mutates git state when a review passes.
- The skill writes a plan file, or flips a checkbox or rewrites metrics in an existing plan file, to record the completed work.
- The skill writes to `.flanders/` as part of finishing.
- The skill treats a clean review as requiring a commit before the work is considered done.

## The `/flanders-work` review loop is driven by the presence and content of a temporary error-log file

After it performs the work, the `/flanders-work` skill drives its work-then-review loop entirely from a temporary error-log file — the reviewer's verdict file. Before each review round the skill provisions that file as absent; the reviewer writes its verdict into it per the shared verdict rule; and the skill then branches on whether the file is absent, present and empty, or present and non-empty. The loop has no fixed upper bound. Each review round is preceded by the build and test gates passing, per [.spec/contracts/ai-skills/work-skill.md](/.spec/contracts/ai-skills/work-skill.md) and [.spec/contracts/shared/build-test-validation.md](/.spec/contracts/shared/build-test-validation.md), so the reviewer only ever runs against changes that already build and pass tests.

### Who this applies to

- **Subject:** the source content that produces the `/flanders-work` skill artifact body, and the `/flanders-work` skill at runtime, in the loop that follows performing the work.
- **Not subject:** the `implement` command's orchestrator, whose per-reviewer verdict-file lifecycle — per-reviewer folders, delete-before, and unbounded re-launch across a configured reviewer list — is pinned by [src/commands/.spec/rules/ai/agents.md#the-implement-orchestrator-decides-each-reviewers-verdict-from-its-own-per-reviewer-error-file--deleted-before-inspected-after](/src/commands/.spec/rules/ai/agents.md#the-implement-orchestrator-decides-each-reviewers-verdict-from-its-own-per-reviewer-error-file--deleted-before-inspected-after). The reviewer's own obligation to write the file is pinned by [src/prompts/.spec/rules/ai/review.md#every-flanders-adversarial-reviewer-records-its-verdict-by-writing-violations-into-its-error-log-file-never-via-its-output-or-exit-code](/src/prompts/.spec/rules/ai/review.md#every-flanders-adversarial-reviewer-records-its-verdict-by-writing-violations-into-its-error-log-file-never-via-its-output-or-exit-code).

### Behavior

For each review round:

1. **Provision the verdict file as absent.** Before launching the reviewer, the skill ensures the temporary error-log file does not exist (deleting it if a previous round left one), so the reviewer recreating it is observable. The skill passes the reviewer the path to that file.

2. **Launch the reviewer and wait for its completion.** The skill spawns the reviewer per [src/prompts/.spec/rules/ai/skills/work.md#the-flanders-work-reviewer-is-a-single-in-session-subagent-independent-of-the-flanders-configuration](/src/prompts/.spec/rules/ai/skills/work.md#the-flanders-work-reviewer-is-a-single-in-session-subagent-independent-of-the-flanders-configuration) and waits until it completes.

3. **Branch on the file once the reviewer has completed:**
   - **Absent** — the reviewer did not produce the file it was required to produce, so it did not run to a verdict. The skill relaunches the reviewer for the same review round, repeating with no maximum count until the file exists. An absent file is never read as a pass.
   - **Present and empty** — the reviewer ran to a verdict and found no violation. The work is accepted; the loop ends and the skill finalizes per [src/prompts/.spec/rules/ai/skills/work.md#flanders-work-finalizes-a-clean-review-without-committing-updating-a-plan-or-writing-flanders-configuration](/src/prompts/.spec/rules/ai/skills/work.md#flanders-work-finalizes-a-clean-review-without-committing-updating-a-plan-or-writing-flanders-configuration).
   - **Present and non-empty** — the reviewer ran to a verdict and recorded violations. The skill reworks the implementation to address every recorded violation, re-runs the build and test gates per [.spec/contracts/ai-skills/work-skill.md](/.spec/contracts/ai-skills/work-skill.md) (which must pass before the review runs again), then starts a new review round from step 1 against a freshly-provisioned absent file.

4. **No fixed upper bound.** The work-then-review cycle repeats until a round ends with a present empty file. There is no iteration cap; the user interrupts the session to stop it.

The verdict is read only from the file's presence and content, never from the reviewer's streamed output or exit code, consistent with [src/prompts/.spec/rules/ai/review.md#every-flanders-adversarial-reviewer-records-its-verdict-by-writing-violations-into-its-error-log-file-never-via-its-output-or-exit-code](/src/prompts/.spec/rules/ai/review.md#every-flanders-adversarial-reviewer-records-its-verdict-by-writing-violations-into-its-error-log-file-never-via-its-output-or-exit-code).

### Why

A single in-session reviewer needs an unambiguous, format-independent verdict signal, and the file provides one: provisioning it absent before the round makes the reviewer recreating it the proof that it ran, so an empty file means "looked and found nothing" while an absent file means "never reached a verdict" and is retried rather than trusted. Relaunching on absence rather than counting it as a pass prevents a reviewer that silently did nothing from closing the loop prematurely. Reworking on non-empty content and re-reviewing, with no cap, lets the skill converge on small tasks without the ceremony of a configured iteration limit.

### Failure signals

- The skill reads an absent verdict file as a pass and finishes, instead of relaunching the reviewer.
- The skill does not provision the verdict file as absent before a review round, so a stale file from a previous round is mistaken for the current verdict.
- The skill decides the verdict from the reviewer's streamed output or exit code instead of the file's presence and content.
- The skill finishes on a non-empty verdict file instead of reworking the recorded violations and re-reviewing.
- The skill imposes a fixed iteration cap on the work-then-review cycle.

## The `/flanders-work` reviewer is a single in-session subagent, independent of the Flanders configuration

The `/flanders-work` skill validates its work through one adversarial reviewer that it runs as a subagent of the same session, using the host AI tool's own subagent mechanism. That reviewer is an instance of the same AI tool the user is running the skill in; the Flanders configuration written by `install` does not select or govern it. This is how the `/flanders-work` reviewer is hosted, as distinct from the `implement` command, which invokes a configured list of reviewers through the AI runner.

### Who this applies to

- **Subject:** the source content that produces the `/flanders-work` skill artifact body — the prompt text the `install` command ships — at the point where it directs the skill to launch and host the reviewer; and the `/flanders-work` skill at runtime when it spawns the reviewer.
- **Not subject:** the `implement` command's reviewers, which are configured in `.flanders/` and invoked through the AI runner (see [.spec/contracts/shared/flanders-config.md](/.spec/contracts/shared/flanders-config.md) and [.spec/contracts/cli-commands/implement/iteration-loop.md](/.spec/contracts/cli-commands/implement/iteration-loop.md)); and the content-skill final validators, governed by [src/prompts/.spec/rules/ai/skills/skills-common.md#every-flanders-content-skill-hosts-its-final-validator-the-same-way](/src/prompts/.spec/rules/ai/skills/skills-common.md#every-flanders-content-skill-hosts-its-final-validator-the-same-way).

### Behavior

1. **Spawned as a subagent through the host tool's mechanism.** The skill launches the reviewer through the host AI tool's subagent mechanism, in a fresh subagent session that does not share context with the work the session just performed. In Claude Code the host spawns it through the `Agent` tool; in Codex CLI through whatever Codex documents as its subagent surface at the time of the run.

2. **Exactly one reviewer.** The skill runs a single reviewer per review round. It does not read the `.flanders/` reviewer list and does not run multiple reviewers concurrently.

3. **The Flanders configuration does not govern the reviewer.** The reviewer's tool, model, and effort are the host session's. The skill does not consult the worker or reviewer tool, model, effort, or reviewer-list fields persisted in `.flanders/`; `/flanders-work` relies only on having been installed.

4. **Inline fallback when no subagent mechanism is available.** When the host AI tool exposes no subagent mechanism, or a subagent invocation returns an unrecoverable error (spawn failure, transport error, environment refusal), the skill runs the review inline in its own session. It states in chat that it is falling back and names the concrete reason; a silent fallback is a violation. An inline fallback for ergonomic reasons — the change looks small, tokens feel tight, the session is confident — is forbidden.

5. **The reviewer prompt is the shared reviewer methodology, self-contained.** The reviewer's prompt is built from the shared Flanders reviewer methodology — the change-set determination of [src/prompts/.spec/rules/ai/review.md#every-flanders-adversarial-reviewer-derives-the-change-set-from-git-status-not-from-git-diff-alone](/src/prompts/.spec/rules/ai/review.md#every-flanders-adversarial-reviewer-derives-the-change-set-from-git-status-not-from-git-diff-alone), the empty-change-set handling of [src/prompts/.spec/rules/ai/review.md#when-the-change-set-is-empty-the-reviewer-judges-the-spec-against-the-committed-working-tree-not-against-the-absence-of-a-diff](/src/prompts/.spec/rules/ai/review.md#when-the-change-set-is-empty-the-reviewer-judges-the-spec-against-the-committed-working-tree-not-against-the-absence-of-a-diff), the FAIL conditions and exhaustiveness of [src/prompts/.spec/rules/ai/review.md#every-flanders-adversarial-reviewer-prompt-enumerates-the-same-fail-conditions-and-demands-exhaustive-enumeration](/src/prompts/.spec/rules/ai/review.md#every-flanders-adversarial-reviewer-prompt-enumerates-the-same-fail-conditions-and-demands-exhaustive-enumeration), and the verdict recording of [src/prompts/.spec/rules/ai/review.md#every-flanders-adversarial-reviewer-records-its-verdict-by-writing-violations-into-its-error-log-file-never-via-its-output-or-exit-code](/src/prompts/.spec/rules/ai/review.md#every-flanders-adversarial-reviewer-records-its-verdict-by-writing-violations-into-its-error-log-file-never-via-its-output-or-exit-code) — with the spec under review being the user's request. Because the prompt ships inside a skill artifact, it inlines those obligations and carries no flanders-internal spec citations, per [src/prompts/.spec/rules/ai/skills/skills-common.md#flanders-skill-artifact-prompts-are-self-contained--no-citations-of-flanders-internal-spec-paths](/src/prompts/.spec/rules/ai/skills/skills-common.md#flanders-skill-artifact-prompts-are-self-contained--no-citations-of-flanders-internal-spec-paths).

### Why

`/flanders-work` is the lightweight, in-session path: the user is already in an AI-tool session, so the cheapest way to get an independent adversarial pass is a subagent of that same session rather than an externally configured invocation. Keeping the reviewer on the host session's tool, and limiting it to one, is what makes the skill usable without any `.flanders/` reviewer configuration and keeps it distinct from the heavier, configurable `implement` review stage. The fresh subagent session preserves the reviewer's independence from the reasoning the session used while doing the work.

### Failure signals

- The skill invokes the reviewer through the AI runner or reads the `.flanders/` configuration to choose the reviewer's tool, model, or effort.
- The skill runs more than one reviewer per round, or reproduces the `implement` configured reviewer list.
- The skill takes the inline fallback without stating in chat that it is falling back and naming the concrete reason, or takes it for ergonomic reasons rather than genuine unavailability.
- The reviewer is run in a session that shares context with the work just performed, instead of a fresh subagent session.
- The reviewer prompt cites a flanders-internal spec path instead of inlining the shared reviewer methodology.
