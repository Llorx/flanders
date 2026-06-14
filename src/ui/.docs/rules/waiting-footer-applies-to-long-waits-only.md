# The waiting footer state appears only for long retry waits

The footer's waiting state is reserved for retry waits long enough to be worth surfacing to the user. Short retry waits — those used by the transient-error backoff — do not transition the footer out of its normal footer state.

## Who this applies to

- **Subject:** the bottom-fixed UI block, specifically its footer line.
- **Scope:** the transition between the normal footer state and the waiting footer state defined by the UI contract, for the prep and worker AI waits. The normal footer state is the `Preparing` state during the prep stage and the `Working` state during the worker stage (see [.docs/contracts/cli-commands/implement/ui.md](/.docs/contracts/cli-commands/implement/ui.md)). The adversarial review stage is out of this scope: it does not use the global waiting footer state. A reviewer's rate-limit wait during the review stage is surfaced as that reviewer's `waiting` status inside the reviewing footer line (see [.docs/contracts/cli-commands/implement/ui.md](/.docs/contracts/cli-commands/implement/ui.md), `Footer line — reviewing state`), not by switching the whole footer into the global waiting state.

## When the waiting state is shown

- A rate-limit wait. Rate-limit waits can last minutes to hours and the user benefits from seeing the expected end and a countdown.
- Any future retry wait that is similarly long-running and has a knowable expected end.

## When the waiting state is not shown

- A transient-error backoff (see [src/ai/.docs/rules/retry/transient-error-backoff.md](/src/ai/.docs/rules/retry/transient-error-backoff.md)). These waits are capped at one minute and the user does not benefit from a dedicated footer state for them; the footer stays in its normal footer state — `Preparing` during the prep stage, `Working` during the worker stage — and the animation continues.
- Any retry whose duration cannot be reliably surfaced upfront, unless the contract explicitly extends the waiting state to cover it.

## Failure signals

- A short transient backoff (capped at one minute) toggles the footer into the waiting state, only to toggle back almost immediately.
- The waiting state activates without an expected end or countdown to show, because the wait's duration is not knowable upfront.
- A future long-running retry type is introduced without explicitly opting into or out of the waiting footer state.
