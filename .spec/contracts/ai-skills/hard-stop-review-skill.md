# `/flanders-hard-stop-review` Skill Contract

## Purpose
Diagnose a hard stop of the `implement` command and recommend the concrete Flanders action that lets `implement` be relaunched so the same task completes instead of stopping again. When `implement` exceeds the per-task iteration cap it ends the run, preserves its temporary folder on disk, and points the user at it (see [.spec/contracts/cli-commands/implement/iteration-loop.md#hard-stop](/.spec/contracts/cli-commands/implement/iteration-loop.md#hard-stop) and [.spec/contracts/cli-commands/implement/workspace.md](/.spec/contracts/cli-commands/implement/workspace.md)). This skill reads that preserved evidence, determines why the task never reached a clean iteration, and tells the user what to change before the next run. The skill runs inside the user's own AI-tool session and delivers its analysis in chat.

## Provisioning
The skill becomes available only after the user runs `npx flanders install` (see [.spec/contracts/cli-commands/install.md](/.spec/contracts/cli-commands/install.md)). The skill is installed for each AI tool the user picked at install time (Claude Code, Codex CLI, or both). The invocation form below is the same regardless of which AI tool the user is invoking it from.

## Invocation
The user invokes the skill from inside an AI-tool session as:

    /flanders-hard-stop-review [<data>]

`<data>` is the filesystem path of the preserved hard-stop temporary folder — the path the hard stop printed. When `<data>` is supplied, it names the folder the skill analyzes. When `<data>` is omitted, the skill takes that path from the conversation.

## Behavior
The skill's work is read-only: it inspects evidence and reports its findings, carrying the request through the steps below.

1. **Read the preserved evidence.** The skill reads the preserved hard-stop temporary folder: the main folder's per-iteration worker, build, test, and reviewer output logs, its briefing `error.log`, and its consolidated `spec.md`, together with each per-reviewer folder's `error.log`, per [.spec/contracts/cli-commands/implement/workspace.md](/.spec/contracts/cli-commands/implement/workspace.md). From that evidence it identifies the task that hard-stopped — its plan-file line number and title — and the plan file the run was implementing.

2. **Ground the analysis in the project's specs.** The skill reads the identified plan file and the contracts and rules the hard-stopped task references, consulting the wider spec corpus as far as the diagnosis needs, so its finding and recommendation are stated against the project's actual plan and specs.

3. **Determine the root cause.** The skill examines how the iterations progressed — what each iteration changed and how the recorded failures evolved from one iteration to the next — and classifies the hard stop as one of two cases:
   - The task made real progress across iterations, so the hard stop reflects a task larger than the iteration cap can finish or a transient failure, and a fresh run or a smaller task would carry it through.
   - The iterations circled the same unresolved failure with no net progress — a loop — driven by a cause the next run must remove first: a contradictory or ambiguous contract or rule, an acceptance criterion no implementation can satisfy as written, a task premise about runtime behavior the code does not bear out, a task scoped too large or ordered ahead of a dependency it needs, or a review that keeps re-failing the change for the same reason.

4. **Map the cause to a Flanders action.** The skill recommends the action that removes the identified cause:
   - Re-run `flanders implement` unchanged, when the failure was transient or the task was progressing and needs only a fresh iteration budget. The per-task iteration cap is a fixed five and is not configurable (see [.spec/contracts/cli-commands/implement/iteration-loop.md#per-run-state](/.spec/contracts/cli-commands/implement/iteration-loop.md#per-run-state)), so the remedy for a task that needs more attempts is a fresh run — which resets the per-task iteration counter to zero — or a task split into smaller tasks, and never a raised cap.
   - Revise the plan through `/flanders-plan` (see [.spec/contracts/ai-skills/plan-skill.md](/.spec/contracts/ai-skills/plan-skill.md)): split the hard-stopped task into smaller tasks, correct acceptance criteria or a task premise the iterations proved wrong, or reorder the task against the dependency it needs.
   - Fix the spec through `/flanders-spec` (see [.spec/contracts/ai-skills/spec-skill.md](/.spec/contracts/ai-skills/spec-skill.md)): resolve the contradictory or ambiguous contract or rule that left the task unsatisfiable.
   - A combination of the above, when the evidence shows more than one cause.

5. **Present the diagnosis.** The skill presents its root-cause finding and its recommendation in chat. This is the skill's sole deliverable; the skill writes no file of its own.

## Recommending and launching the next step
After presenting the diagnosis, the skill asks the user which skill to launch to carry out the recommendation: `/flanders-spec`, `/flanders-plan`, or neither. It recommends the one its root-cause finding points to — `/flanders-spec` (see [.spec/contracts/ai-skills/spec-skill.md](/.spec/contracts/ai-skills/spec-skill.md)) when the cause is a contract or rule defect, and `/flanders-plan` (see [.spec/contracts/ai-skills/plan-skill.md](/.spec/contracts/ai-skills/plan-skill.md)) when the cause is a plan defect or a task that must be split. When the user chooses one, the skill launches it in the same session with no `<data>` argument, so the launched skill takes its input from the conversation — the diagnosis just produced. The run then proceeds under the chosen skill's own contract, whose write boundary governs any file that skill writes; the launch leaves this skill's own read-only boundary unchanged. When the recommended fix is to re-run `implement` unchanged, the skill states the `flanders implement` command for the user to run and launches nothing, because carrying out a plan is the `implement` command's role (see [.spec/contracts/cli-commands/implement/overview.md](/.spec/contracts/cli-commands/implement/overview.md)). When the user declines, the skill ends.

## Write boundary
The skill creates, modifies, deletes, and renames no file: not code, not a plan file, and no file inside any `.spec/contracts`, `.spec/rules`, or `.spec/flanders` folder. Its analysis reads the preserved evidence, the plan, and the spec corpus and reports in chat; every file change happens only through a skill it launches, under that skill's own write authority (see [.spec/contracts/shared/spec-folder-write-authority.md](/.spec/contracts/shared/spec-folder-write-authority.md)).

## Interaction language
The natural language the skill converses in with the user — its diagnosis, its recommendation, the launch offer, and every other message it prints in chat — is resolved per [.spec/contracts/ai-skills/interaction-language.md](/.spec/contracts/ai-skills/interaction-language.md).

## Out of scope
- The skill's analysis draws only on the preserved hard-stop temporary folder, the plan file, and the project's spec corpus; it does not read the AI tools' own session transcripts.
- The skill does not re-run the `implement` command itself: on the re-run recommendation it states the command and leaves running it to the user.
- The exact internal contents of the skill artifact (frontmatter fields, body shape) are implementation choices, pinned only insofar as the user is able to invoke `/flanders-hard-stop-review` from inside an AI-tool session of each selected tool after a successful `install` run.
