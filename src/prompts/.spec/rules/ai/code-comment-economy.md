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

## Flanders' code-authoring prompts instruct the agent to make the code carry the meaning before it reaches for a comment

Every Flanders prompt through which an agent authors source code in the host project instructs that agent that when the code it is writing would need a comment to be understood, it first tries to make the code itself carry that meaning — a name that states what a value or function is, a type that makes the constraint unrepresentable, a construct extracted so its name replaces the explanation — and writes the comment only where none of those can express it. This is the step ahead of [src/prompts/.spec/rules/ai/code-comment-economy.md#flanders-code-authoring-prompts-instruct-the-agent-that-a-source-comment-carries-only-what-the-code-cannot-express](/src/prompts/.spec/rules/ai/code-comment-economy.md#flanders-code-authoring-prompts-instruct-the-agent-that-a-source-comment-carries-only-what-the-code-cannot-express): that obligation governs what a comment carries once one is warranted, and this one decides whether one is warranted at all.

### Who this applies to

- **Subject:** the construction of the Flanders prompts through which an agent authors source code in the host project — the `implement` command's worker prompt (see [.spec/contracts/cli-commands/implement/iteration-loop.md](/.spec/contracts/cli-commands/implement/iteration-loop.md)) and the `/flanders-work` skill artifact body in its work-and-rework role (see [.spec/contracts/ai-skills/work-skill.md](/.spec/contracts/ai-skills/work-skill.md)) — at the point where the prompt instructs the agent how to write the code.
- **Not subject:** every Flanders adversarial reviewer prompt and the build-and-test detection agent prompt, and the `/flanders-spec`, `/flanders-plan`, and `/flanders-hard-stop-review` skill bodies, none of which author source code in the host project.
- **Not subject:** code the change would not otherwise author or modify. The attempt to express the meaning in code reaches only as far as the change already reaches.

### Behavior

The prompt instructs the agent that, in the code it writes:

1. **The code is tried first.** When the agent is about to write a comment that explains what the code does or why it is shaped as it is, it first asks whether a clearer name, a type that carries the constraint, or an extracted construct would convey that meaning, and applies the one that does.

2. **The comment carries what the code cannot.** Where no naming, typing, or extraction expresses it — an external constraint, a platform quirk, an invariant the type system cannot hold — the agent writes the comment.

3. **The attempt stays inside the change.** The agent applies this to the code the change authors or modifies, and leaves surrounding code as it stands rather than restructuring it to remove a comment.

### Why

A comment that explains the code is a symptom: the code did not say what it meant, and the prose compensates. Compensating leaves two artifacts that must be kept in step, and the prose is the one that rots — it survives edits to the code it describes and then misleads the next reader with authority it no longer has. Making the code carry the meaning removes the second artifact entirely and puts the explanation where the compiler and the reader both see it. Ordering this attempt ahead of the comment-content test also stops that test from being satisfied the cheap way: an agent that only asks whether a comment is permitted writes a permitted comment at the place where a better name would have left nothing to write, and the content test alone never catches that, because the comment it produces is honest about a genuine obscurity the agent chose not to remove. Bounding the attempt to the code the change already touches keeps a comment from pulling a refactor of its surroundings into an unrelated diff.

### Failure signals

- A prompt in scope instructs the agent what a comment may contain but never has it consider whether a clearer name, a type, or an extracted construct would remove the need for one.
- A prompt in scope has the agent explain in prose what a rename or an extraction would have made evident in the code.
- A prompt in scope licenses the agent to restructure code the change does not otherwise author or modify in order to remove a comment.
