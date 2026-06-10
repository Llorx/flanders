# Spec artifacts state only the present spec — the /flanders-spec prompt prohibits past content actively

A contract or rule authored by `/flanders-spec` describes only the present spec: what the software does now and what the code must do now. It never records what the spec used to be, what it replaces, what changed in the run that produced it, or any other historical, transitional, or migration framing. Past facts about the spec's evolution belong in the commit message or pull-request description, not in a permanent spec file. The `/flanders-spec` skill artifact body enforces this as an active prohibition in its own drafting guidance, not solely as a check the post-write validator applies after the fact.

## Who this applies to

- **Subject:** every contract file under a `.docs/contracts` folder and every rule file under a `.docs/rules` folder that `/flanders-spec` writes or updates — including flanders' own spec, which `/flanders-spec` authors because the project self-hosts its spec.
- **Subject:** the source content that produces the `/flanders-spec` skill artifact body — the prompt text the `install` command ships — which must carry the active prohibition described under "How to apply".
- **Not subject:** plan files under `plans/` (`/flanders-plan` output), which sequence work and may reference prior state as task context.
- **Not subject:** commit messages, pull-request descriptions, and other non-spec documents — these are the correct home for historical, transitional, and migration notes.

## What counts as past content

Past content is any statement whose subject is the spec's history rather than its current obligations. The following in a contract or rule file are forbidden:

- "Replaces the former X", "supersedes Y", "this used to be Z", "previously W".
- A changelog or summary of what the producing run added, removed, renamed, or merged.
- Migration or transition notes describing how the project moved from an old shape to the current one.
- References to skills, files, or obligations that no longer exist, framed as things the current spec evolved away from.

A spec file reads as if the present shape is simply how things are, with no memory of how it got there.

## How to apply

- The `/flanders-spec` skill artifact body states this prohibition **actively in its drafting guidance** — a direct instruction not to write historical, transitional, or migration content into the contracts and rules it produces — placed where the body tells the skill how to draft, not deferred to the body's final-validation section alone. An obligation surfaced only as a validator check is reactive: the skill writes the past content and is then forced to undo it. The active prohibition stops it being written in the first place.
- When the producing run needs to record that the spec changed — a merge, a rename, a removal — that record goes in the commit message or pull-request description for the change, never in the spec file itself.
- The spec validator additionally gates this obligation, per `src/.docs/rules/ai/skills/spec/final-validator.md`. The active prohibition and the validator check are complementary, not alternatives.

## Failure signals

- A contract or rule file authored by `/flanders-spec` contains "replaces the former X", a changelog of the run's edits, or any other historical, transitional, or migration framing instead of stating only the present spec.
- The `/flanders-spec` skill artifact body surfaces this obligation only in its final-validation section, with no active prohibition in its drafting guidance.
- A spec file names a skill, file, or obligation that no longer exists, framed as something the current spec evolved away from.
