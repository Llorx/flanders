# Skill Clarification Question Cadence

## Purpose
Pin the cadence the `/flanders-spec` and `/flanders-plan` skills follow whenever they put clarifying questions to the user — how the skill groups the questions it needs and presents them. This governs the mechanics of asking; which questions each skill is permitted to ask is governed by each skill's own clarification phase.

## Scope
This contract governs the question-asking cadence of the skills installed by `npx flanders install` (see [.spec/contracts/cli-commands/install.md](/.spec/contracts/cli-commands/install.md)) that conduct a clarification phase: `/flanders-spec` (see [.spec/contracts/ai-skills/spec-skill.md](/.spec/contracts/ai-skills/spec-skill.md)) and `/flanders-plan` (see [.spec/contracts/ai-skills/plan-skill.md](/.spec/contracts/ai-skills/plan-skill.md)). It governs both a skill's initial clarification phase and any re-entered clarification phase the post-write validation fix loop triggers (see [.spec/contracts/ai-skills/post-write-validation.md](/.spec/contracts/ai-skills/post-write-validation.md)).

## Obligation
Before it begins asking, the skill accumulates every clarifying question it can determine whose content does not depend on the answer to another question, and asks that whole set together in a single interaction rather than one question at a time. A question is held back only when its content genuinely depends on an earlier answer.

When the AI tool the skill runs in provides a facility for asking several questions at once, the skill presents the accumulated batch through that facility in a single interaction. When the AI tool provides no such facility, the skill asks one question per turn.

A question whose content depends on the answer to an earlier question is held back and asked in a later round, once its prerequisite has been answered. Each later round again accumulates and presents together every question that has become independent, under the same cadence.

Multiple-choice questions are preferred whenever the answer space is bounded.

## Relationship to each skill's clarification scope
This cadence is independent of which questions a skill may ask. Whether a given doubt is raised with the user at all is decided by the originating skill's clarification phase — broad for `/flanders-spec`, narrower for `/flanders-plan` — and a re-entered clarification phase asks only about the specific ambiguity its failed validation issue closes. This contract governs only how the questions a skill has decided to ask are grouped and presented to the user.
