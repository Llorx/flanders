# Skills read relevant references before drafting

Before drafting any deliverable, `/flanders-spec` and `/flanders-plan` read every file in their canonical reference set that is relevant to the request. Reading is not optional. A draft that begins without the relevant files having been read is invalid, regardless of how confident the drafter is about the request.

## Who this applies to

- **Subject:** every invocation of the two Flanders skills:
  - `/flanders-spec`
  - `/flanders-plan`
- **Not subject:** other agents and commands, including the `implement` command and the workers, reviewers, and validators it spawns. They consult contracts and rules under their own rules and are out of scope here.

## Canonical reference set per skill

The reference set is the existing spec content the new deliverable must be consistent with — every contract under a `.spec/contracts` folder and every rule under a `.spec/rules` folder, discovered across the whole project tree per [src/workspace/.spec/rules/spec-discovery/docs-folders-enumerated-recursively.md](/src/workspace/.spec/rules/spec-discovery/docs-folders-enumerated-recursively.md):

- `/flanders-spec` — the project's contracts and rules.
- `/flanders-plan` — the project's contracts and rules.

The reference set is captured at invocation. Files added or removed mid-run are not picked up retroactively. The drafter does not consult any other source — for example, a stale snapshot held in conversation context, a previous run's listing, or memory — in place of the state captured at invocation.

## What "relevant" means

A file in the canonical reference set is relevant to the request when any of the following is true:

- It defines an obligation the new deliverable must respect or contradict-check against.
- It covers content the new deliverable would update or extend in place.
- It sits in a topically adjacent namespace whose existing wording shapes how the new deliverable should be written (to preserve consistency of style, scope, and vocabulary).

When in doubt, the drafter reads rather than omits. Under-reading is more costly than over-reading: a deliverable that contradicts or duplicates an unread file is invalid, while a few extra reads only cost time.

## When the read happens

Reading happens before the clarification phase concludes and certainly before the drafting phase begins. The drafter does not start drafting on the assumption that it will read relevant files later, and does not present a planned file layout in the drafting phase without having already read the files that would shape that layout.

## Failure signals

- The skill drafts a contract, rule, or plan without having read the existing files it must avoid contradicting or duplicating.
- The skill picks a subset of "obviously relevant" files and skips others whose obligations would shape the deliverable.
- The skill drafts against a stale reference set instead of the state captured at invocation.
- The skill presents a planned file layout for user approval without having read the files in the canonical reference set that overlap with that layout.
- The skill produces a deliverable that contradicts or duplicates an existing file that the skill, on inspection, had not read.
