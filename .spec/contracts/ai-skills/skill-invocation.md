# Flanders Skill Invocation

## Purpose
Pin how the user reaches an installed Flanders skill from inside an AI-tool session, for every skill `install` delivers and every AI tool it delivers them to (see [.spec/contracts/cli-commands/install.md](/.spec/contracts/cli-commands/install.md)). Each skill contract in `.spec/contracts/ai-skills/` pins what its skill does with the input it receives; this contract pins how the user hands that input over.

## Invocation
Each Flanders skill carries a name — `flanders-spec`, `flanders-plan`, `flanders-work`, `flanders-hard-stop-review` — and the user invokes it from inside an AI-tool session by naming it through the skill-invocation mechanism the invoking tool provides, optionally followed by that skill's single `<data>` argument. The skill's name and the meaning of its `<data>` are the same in every AI tool the skills are installed for; the concrete token the user types to name the skill is the one the invoking tool's mechanism defines, so it differs between tools.

## Slash form denotes the skill
Throughout the Flanders contracts and rules each skill is written in its slash form — `/flanders-spec`, `/flanders-plan`, `/flanders-work`, `/flanders-hard-stop-review`. That form names the skill being described. The token a user types to invoke it in a given AI tool is the one that tool's invocation mechanism defines.

## `<data>` argument
A skill takes at most one optional `<data>` argument, supplied after the skill's name in the same invocation. What each skill does with a supplied or an omitted `<data>` is pinned by that skill's own contract: [.spec/contracts/ai-skills/spec-skill.md](/.spec/contracts/ai-skills/spec-skill.md), [.spec/contracts/ai-skills/plan-skill.md](/.spec/contracts/ai-skills/plan-skill.md), [.spec/contracts/ai-skills/work-skill.md](/.spec/contracts/ai-skills/work-skill.md), and [.spec/contracts/ai-skills/hard-stop-review-skill.md](/.spec/contracts/ai-skills/hard-stop-review-skill.md).

## Out of scope
- The invocation token, argument syntax, and discovery mechanism each AI tool defines for its own skills. Those belong to the tool; this contract pins only that Flanders skills are reached through whichever mechanism the invoking tool provides, under the same name and with the same `<data>` meaning everywhere.
