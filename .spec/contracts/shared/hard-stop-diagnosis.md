# Hard-Stop Diagnosis — Shared Contract

## Purpose
Define, once for every Flanders surface that diagnoses a hard stop of the single-task cycle, how the preserved evidence is read, how the root cause is determined, and how that cause maps to the action that removes it. The `/flanders-hard-stop-review` skill applies this to a hard stop the `implement` command left behind (see [.spec/contracts/ai-skills/hard-stop-review-skill.md](/.spec/contracts/ai-skills/hard-stop-review-skill.md)), and the `/flanders-implement` skill applies it to its own hard stop, in the same run and unprompted (see [.spec/contracts/ai-skills/implement-skill.md](/.spec/contracts/ai-skills/implement-skill.md)).

The diagnosis is read-only: it inspects evidence and reports a finding. Every file change it leads to happens through a separate, user-initiated act.

## Diagnosis

1. **Read the preserved evidence.** Read the preserved hard-stop temporary folder (see [.spec/contracts/shared/task-workspace.md#hard-stop-per-iteration-error-logs](/.spec/contracts/shared/task-workspace.md#hard-stop-per-iteration-error-logs)): the main folder's per-iteration worker, build, test, and reviewer output logs; the per-iteration, per-stage error logs the hard stop materializes — `build.<iteration>.error.log`, `test.<iteration>.error.log`, `reviewer.<iteration>.<position>.error.log`, and `commit.<iteration>.error.log` — which make explicit which stage failed in each iteration and by which reviewer, the single briefing `error.log` having been removed at the hard stop; the worker-declared `hard-stop.log`, when the stop was the worker's own declaration; any material the surface consolidated for its worker; and each per-reviewer folder's `error.log`. From that evidence, identify the task that hard-stopped.

2. **Ground the analysis in the project's specs.** Read the statement of the task that hard-stopped and the contracts and rules it bears on, consulting the wider spec corpus as far as the diagnosis needs, so the finding and the recommendation are stated against the project's actual specs.

3. **Determine the root cause.** Examine how the iterations progressed — what each iteration changed and how the recorded failures evolved from one iteration to the next — and classify the hard stop as one of two cases:
   - The task made real progress across iterations, so the hard stop reflects a task larger than the iteration cap can finish or a transient failure, and a fresh run or a smaller task would carry it through.
   - The iterations circled the same unresolved failure with no net progress — a loop — driven by a cause the next run must remove first: a contradictory or ambiguous contract or rule, a stated outcome no implementation can satisfy as written, a premise about runtime behavior the code does not bear out, a task scoped too large or attempted ahead of a dependency it needs, or a review that keeps re-failing the change for the same reason.

   When the preserved folder carries a worker-declared `hard-stop.log`, its declared cause is evidence, not a conclusion: verify the declaration against the iteration history and the specs, and classify the stop by what that verification sustains.

4. **Map the cause to an action.** Recommend the action that removes the identified cause:
   - Run the same work again unchanged, when the failure was transient or the task was progressing and needs only a fresh iteration budget. The per-task iteration cap is a fixed five and is not configurable (see [.spec/contracts/shared/task-cycle.md#per-cycle-state](/.spec/contracts/shared/task-cycle.md#per-cycle-state)), so the remedy for a task that needs more attempts is a fresh run — which resets the iteration counter to zero — or the work split smaller, and never a raised cap.
   - Fix the spec through `/flanders-spec` (see [.spec/contracts/ai-skills/spec-skill.md](/.spec/contracts/ai-skills/spec-skill.md)): resolve the contradictory or ambiguous contract or rule that left the task unsatisfiable.
   - Narrow or correct the statement of the work itself, through whichever entry point owns it on that surface.
   - A combination of the above, when the evidence shows more than one cause.

5. **Present the diagnosis.** Present the root-cause finding and the recommendation to the user in chat.

## Out of scope
- The analysis draws only on the preserved hard-stop temporary folder, the statement of the task, and the project's spec corpus; it does not read the AI tools' own session transcripts.
- Which entry point owns the statement of the work, and therefore what a "narrow or correct the work" recommendation concretely names, is the surface's own.
- Whether the diagnosis offers to launch another skill afterwards, and which ones, is the surface's own.
