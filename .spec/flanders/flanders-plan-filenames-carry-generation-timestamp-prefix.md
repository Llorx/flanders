# `/flanders-plan` plan filenames carry a generation-timestamp prefix

## When `/flanders-plan` writes a plan file, its filename begins with the local generation timestamp

When `/flanders-plan` persists a plan file into the project's `plans/` folder, the filename begins with a timestamp prefix of the form `YYYY-MM-DD_HH.MM-`, immediately followed by the descriptive subject portion and the `.md` extension, so the full filename is `YYYY-MM-DD_HH.MM-<descriptive-subject>.md`.

The prefix is built from a four-digit year, a two-digit month, and a two-digit day joined by `-`; then a single `_`; then a two-digit hour on a 24-hour clock and a two-digit minute joined by `.`; then a single `-` separating the timestamp block from the descriptive subject. Every numeric component is zero-padded to its fixed width, so the prefix is always the same length and the plan files in `plans/` sort chronologically by name.

The timestamp is the machine's local date and time at the moment the plan file is generated. The portion after the prefix is the descriptive subject, which keeps satisfying the requirement that the plan filename be descriptive of the plan's subject pinned in [.spec/contracts/ai-skills/plan-skill.md § Behavior](/.spec/contracts/ai-skills/plan-skill.md#behavior).

This is a behavior rule in the sense pinned by [.spec/contracts/shared/flanders-behavior-rules.md](/.spec/contracts/shared/flanders-behavior-rules.md): it constrains how the `/flanders-plan` skill (see [.spec/contracts/ai-skills/plan-skill.md](/.spec/contracts/ai-skills/plan-skill.md)) names the file it authors, not the host project's own code.

### Who this applies to

- **Subject:** the `/flanders-plan` skill, on every run that persists a plan file into the project's `plans/` folder. Every plan file the skill writes carries the timestamp prefix in the form above.
- **Not subject:** any other Flanders command or skill. In particular, the `implement` command reads an existing plan file and updates it in place; it does not originate the plan filename, so the prefix it works with is whatever `/flanders-plan` already wrote.

### Why

A fixed-width, zero-padded timestamp prefix gives every plan a name that sorts chronologically by name and stays distinct across runs, so successive plans never collide and the `plans/` folder reads as an ordered history at a glance. Local time is used because the plan is created in the user's own session on their own machine, so the wall-clock the user reads is the one stamped onto the file.

### Failure signals

- A plan file written by `/flanders-plan` whose name lacks the `YYYY-MM-DD_HH.MM-` prefix, or whose numeric components are not zero-padded to their fixed width.
- A prefix whose date and time are drawn from a clock other than the machine's local time.
- A plan filename that is only the timestamp prefix with no descriptive subject following it.
