# Code comment economy

## Flanders' code-authoring prompts instruct the agent that a source comment carries only what the code cannot express

Every Flanders prompt through which an agent authors source code in the host project instructs that agent to write a comment only where the comment states something the code itself cannot show — an external constraint, an invariant the code cannot enforce, or a consequence a competent reader of the code alone would get wrong. The argument that a change is correct, the citation of the contract, rule, plan task, or reviewer finding behind it, and the `file:line` an inspection should target belong to the agent's own reporting channel — the Evidence Report for the `implement` worker, pinned by [src/commands/.spec/rules/ai/evidence.md#adversarially-reviewed-subagents-self-audit-via-an-evidence-report](/src/commands/.spec/rules/ai/evidence.md#adversarially-reviewed-subagents-self-audit-via-an-evidence-report), and the account the `/flanders-work` session renders to its reviewer and to the user. A comment describes the code as it now stands, so what the code previously did, what a change replaced, and what remains to migrate are not comment content. Where a rule of the host project requires a comment, that comment is required content and this instruction never displaces it.

This is the third member of the economy set Flanders pins: [src/prompts/.spec/rules/ai/prompt-wording-economy.md#every-prompt-flanders-authors-is-worded-economically](/src/prompts/.spec/rules/ai/prompt-wording-economy.md#every-prompt-flanders-authors-is-worded-economically) governs the economy of a prompt's own wording, [src/prompts/.spec/rules/ai/skills/skills-common.md#the-flanders-spec-and-flanders-plan-skill-bodies-instruct-economy-of-files-and-words](/src/prompts/.spec/rules/ai/skills/skills-common.md#the-flanders-spec-and-flanders-plan-skill-bodies-instruct-economy-of-files-and-words) governs the economy of the documents a content skill produces, and this rule governs the economy of the code Flanders' agents author.

### Who this applies to

- **Subject:** the construction of the Flanders prompts through which an agent authors source code in the host project — the `implement` command's worker prompt (see [.spec/contracts/cli-commands/implement/iteration-loop.md](/.spec/contracts/cli-commands/implement/iteration-loop.md)) and the `/flanders-work` skill artifact body in its work-and-rework role (see [.spec/contracts/ai-skills/work-skill.md](/.spec/contracts/ai-skills/work-skill.md)) — at the point where the prompt instructs the agent how to write the code.
- **Not subject:** every Flanders adversarial reviewer prompt and the build-and-test detection agent prompt, which author no source code in the host project; the reviewer's obligation to record a comment that breaches this discipline is pinned by [src/prompts/.spec/rules/ai/review.md#every-flanders-adversarial-reviewer-records-a-violation-for-a-source-comment-that-argues-the-change-instead-of-stating-a-constraint](/src/prompts/.spec/rules/ai/review.md#every-flanders-adversarial-reviewer-records-a-violation-for-a-source-comment-that-argues-the-change-instead-of-stating-a-constraint).
- **Not subject:** the `/flanders-spec`, `/flanders-plan`, and `/flanders-hard-stop-review` skill bodies, whose agents author markdown documents rather than source code.

### Behavior

The prompt instructs the agent that, in the code it writes:

1. **A comment states what the code cannot.** The agent writes a comment where the code alone would leave a competent reader wrong — an external constraint the code obeys but cannot show, an invariant the type system cannot carry, a consequence not visible from the construct — and writes none where the comment would restate what the line already says.

2. **Justification goes to the reporting channel.** The argument that the work satisfies a criterion, contract, rule, or behavior rule, the identifier of the plan task or reviewer finding being addressed, and the `file:line` a reviewer's inspection should target are stated in the agent's report, and the source carries none of them.

3. **A comment records the present.** The comment describes the code as it now stands; what the code used to do, what the change replaced, and what is not yet migrated stay out of the source.

4. **A comment a project rule requires is required content.** Where a rule of the host project mandates a comment at a construct, the agent writes it, and this discipline neither removes it nor argues against it.

### Why

The agent writes under adversarial review, and it is told the changes must demonstrate compliance rather than merely achieve it, per [src/prompts/.spec/rules/ai/review.md#every-flanders-adversarial-reviewer-prompt-enumerates-the-same-fail-conditions-and-demands-exhaustive-enumeration](/src/prompts/.spec/rules/ai/review.md#every-flanders-adversarial-reviewer-prompt-enumerates-the-same-fail-conditions-and-demands-exhaustive-enumeration). For a structural or semantic obligation the guard is the reviewer reading the source at a named `file:line` per [src/commands/.spec/rules/ai/evidence.md#a-claims-evidence-requirement-is-set-by-what-signal-can-soundly-observe-its-regression](/src/commands/.spec/rules/ai/evidence.md#a-claims-evidence-requirement-is-set-by-what-signal-can-soundly-observe-its-regression), and no test may carry it per [src/.spec/rules/testing.md#the-subjects-source-text-is-not-the-public-surface-either](/src/.spec/rules/testing.md#the-subjects-source-text-is-not-the-public-surface-either). Absent an instruction naming a different channel, the only place the agent finds at that line to address a reader of source is a comment, so it deposits its defense of the diff in the code. The reviewer then enumerates every occurrence of a pattern on every iteration, so the agent annotates every occurrence on every iteration and removes none, and comment density rises monotonically across the loop until the comments that carry a real constraint are buried among the ones that argue. Naming the report as the channel for justification gives that pressure the place it is asking for and leaves the source carrying only what a future reader cannot get from the code.

### Failure signals

- A prompt in scope carries no instruction about what a comment may contain, leaving the agent to infer from the review conditions that the source is where compliance is demonstrated.
- A prompt in scope instructs the agent to justify, prove, or demonstrate its work in the code it writes, or to leave a citation trail in the source for the reviewer to follow.
- A prompt in scope states the discipline but names no channel for the justification it displaces, so the agent has nowhere to put the argument the review still demands.
- A prompt in scope states the discipline in terms that would suppress a comment a host-project rule requires.
- A prompt in scope allows the source to narrate what the code used to do or what remains to migrate.
