# A task's body is delimited by the next task line, whether that line is open or done

When the `implement` command extracts a leaf task's body from the plan file — the region it injects as the full task text per [src/commands/.spec/rules/ai/task-context.md#the-workers-first-iteration-receives-the-task-and-reference-content-by-deterministic-script-injection](/src/commands/.spec/rules/ai/task-context.md#the-workers-first-iteration-receives-the-task-and-reference-content-by-deterministic-script-injection) — it delimits the body using the canonical task-line recognizer, which matches both an open `[ ]` and a done `[x]` checkbox. A body runs from its own task line down to, but not including, the next line the recognizer matches, or the end of the file when no further task line follows. The next task line bounds the body regardless of its checkbox state, so a body whose following task is already completed is neither truncated short of its real end nor extended past the completed task into the next task's content.

## Who this applies to

- **Subject:** the `implement` command's plan-parsing code, when it extracts the body of a leaf task to inject as the full task text (see [.spec/contracts/shared/plan-file-format.md](/.spec/contracts/shared/plan-file-format.md) and [.spec/contracts/cli-commands/implement/iteration-loop.md](/.spec/contracts/cli-commands/implement/iteration-loop.md)).
- **Not subject:** the `plan` command's generation path and the `/flanders-plan` validator, which write and count task lines but do not extract task bodies.

## How to apply this rule

- The boundary scan uses the canonical task-line recognizer regex pinned in [src/prompts/.spec/rules/ai/skills/plan.md#the-flanders-plan-validator-confirms-task-line-format-by-exact-matching-the-canonical-recognizer-regex](/src/prompts/.spec/rules/ai/skills/plan.md#the-flanders-plan-validator-confirms-task-line-format-by-exact-matching-the-canonical-recognizer-regex), whose checkbox group matches a space, `x`, or `X`. The same recognizer that finds the current task line finds the line that ends its body.
- The current task line is included in the extracted region; the next matched task line is excluded from it. When no further task line follows, the body extends to the end of the file.
- A line that is not a task line — a parent grouping heading, a blank line, ordinary prose, a link bullet — never ends a body. Only a line the recognizer matches does.

## Failure signals

- The extractor scans for the next body boundary with an open-only matcher (one that recognizes `[ ]` but not `[x]`), so a task immediately followed by an already-completed task has its body extended past the completed task into later content.
- The extractor includes the next task's line in the current task's extracted body, or drops the current task's own line from it.
- The extractor stops a body at a non-task line such as a parent heading or a blank line instead of at the next recognized task line or the end of the file.
