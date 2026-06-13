# Skill Interaction Language

## Purpose
Pin the natural language the `/flanders-spec`, `/flanders-plan`, and `/flanders-work` skills use when they converse with the user. This is the language of the conversation itself, distinct from the language any files a skill persists are written in.

## Scope
This contract governs the skills installed by `npx flanders install` (see `.docs/contracts/cli-commands/install.md`): `/flanders-spec` (see `.docs/contracts/ai-skills/spec-skill.md`), `/flanders-plan` (see `.docs/contracts/ai-skills/plan-skill.md`), and `/flanders-work` (see `.docs/contracts/ai-skills/work-skill.md`).

## Obligation
Every message a skill addresses to the user during its run is written in the natural language of the user's most recent message in the conversation. This covers all of the skill's conversational output without exception — its clarifying questions and every summary, warning, recommendation, and other text it prints in chat. When the user switches the language they write in partway through the interaction, every subsequent message the skill addresses to the user is written in the language of the user's latest message.

## Relationship to output language
The interaction language is resolved independently of the content a skill writes into the project. It governs only what the skill says to the user in the conversation; it never governs the content of the contract, rule, or plan files that `/flanders-spec` and `/flanders-plan` write — whose language each of those skills resolves by its own output-language rules (see `.docs/contracts/ai-skills/spec-skill.md` and `.docs/contracts/ai-skills/plan-skill.md`) — nor the code `/flanders-work` writes. The two are resolved separately and can differ: a conversation conducted in one language can produce files written in another.
