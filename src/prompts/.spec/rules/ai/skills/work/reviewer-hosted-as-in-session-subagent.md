# The `/flanders-work` reviewer is a single in-session subagent, independent of the Flanders configuration

The `/flanders-work` skill validates its work through one adversarial reviewer that it runs as a subagent of the same session, using the host AI tool's own subagent mechanism. That reviewer is an instance of the same AI tool the user is running the skill in; the Flanders configuration written by `install` does not select or govern it. This is how the `/flanders-work` reviewer is hosted, as distinct from the `implement` command, which invokes a configured list of reviewers through the AI runner.

## Who this applies to

- **Subject:** the source content that produces the `/flanders-work` skill artifact body — the prompt text the `install` command ships — at the point where it directs the skill to launch and host the reviewer; and the `/flanders-work` skill at runtime when it spawns the reviewer.
- **Not subject:** the `implement` command's reviewers, which are configured in `.flanders/` and invoked through the AI runner (see [.spec/contracts/shared/flanders-config.md](/.spec/contracts/shared/flanders-config.md) and [.spec/contracts/cli-commands/implement/iteration-loop.md](/.spec/contracts/cli-commands/implement/iteration-loop.md)); and the content-skill final validators, governed by [src/prompts/.spec/rules/ai/skills/final-validator-host.md](/src/prompts/.spec/rules/ai/skills/final-validator-host.md).

## Behavior

1. **Spawned as a subagent through the host tool's mechanism.** The skill launches the reviewer through the host AI tool's subagent mechanism, in a fresh subagent session that does not share context with the work the session just performed. In Claude Code the host spawns it through the `Agent` tool; in Codex CLI through whatever Codex documents as its subagent surface at the time of the run.

2. **Exactly one reviewer.** The skill runs a single reviewer per review round. It does not read the `.flanders/` reviewer list and does not run multiple reviewers concurrently.

3. **The Flanders configuration does not govern the reviewer.** The reviewer's tool, model, and effort are the host session's. The skill does not consult the worker or reviewer tool, model, effort, or reviewer-list fields persisted in `.flanders/`; `/flanders-work` relies only on having been installed.

4. **Inline fallback when no subagent mechanism is available.** When the host AI tool exposes no subagent mechanism, or a subagent invocation returns an unrecoverable error (spawn failure, transport error, environment refusal), the skill runs the review inline in its own session. It states in chat that it is falling back and names the concrete reason; a silent fallback is a violation. An inline fallback for ergonomic reasons — the change looks small, tokens feel tight, the session is confident — is forbidden.

5. **The reviewer prompt is the shared reviewer methodology, self-contained.** The reviewer's prompt is built from the shared Flanders reviewer methodology — the change-set determination of [src/prompts/.spec/rules/ai/review/reviewer-derives-change-set-from-git.md](/src/prompts/.spec/rules/ai/review/reviewer-derives-change-set-from-git.md), the empty-change-set handling of [src/prompts/.spec/rules/ai/review/reviewer-empty-change-set-judged-against-head.md](/src/prompts/.spec/rules/ai/review/reviewer-empty-change-set-judged-against-head.md), the FAIL conditions and exhaustiveness of [src/prompts/.spec/rules/ai/review/reviewer-fail-conditions-and-exhaustiveness.md](/src/prompts/.spec/rules/ai/review/reviewer-fail-conditions-and-exhaustiveness.md), and the verdict recording of [src/prompts/.spec/rules/ai/review/reviewer-records-verdict-via-error-log.md](/src/prompts/.spec/rules/ai/review/reviewer-records-verdict-via-error-log.md) — with the spec under review being the user's request. Because the prompt ships inside a skill artifact, it inlines those obligations and carries no flanders-internal spec citations, per [src/prompts/.spec/rules/ai/skills/skill-prompts-are-self-contained.md](/src/prompts/.spec/rules/ai/skills/skill-prompts-are-self-contained.md).

## Why

`/flanders-work` is the lightweight, in-session path: the user is already in an AI-tool session, so the cheapest way to get an independent adversarial pass is a subagent of that same session rather than an externally configured invocation. Keeping the reviewer on the host session's tool, and limiting it to one, is what makes the skill usable without any `.flanders/` reviewer configuration and keeps it distinct from the heavier, configurable `implement` review stage. The fresh subagent session preserves the reviewer's independence from the reasoning the session used while doing the work.

## Failure signals

- The skill invokes the reviewer through the AI runner or reads the `.flanders/` configuration to choose the reviewer's tool, model, or effort.
- The skill runs more than one reviewer per round, or reproduces the `implement` configured reviewer list.
- The skill takes the inline fallback without stating in chat that it is falling back and naming the concrete reason, or takes it for ergonomic reasons rather than genuine unavailability.
- The reviewer is run in a session that shares context with the work just performed, instead of a fresh subagent session.
- The reviewer prompt cites a flanders-internal spec path instead of inlining the shared reviewer methodology.
