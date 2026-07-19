# Skill Question Cadence

## Purpose
Pin the cadence the Flanders skills follow whenever they put a question to the user — how a skill groups the clarifying questions it needs and how it presents every question whose answer space is bounded. This governs the mechanics of asking; which questions each skill is permitted to ask is governed by each skill's own contract.

## Scope
This contract governs the question-asking cadence of the skills installed by `npx flanders install` (see [.spec/contracts/cli-commands/install.md](/.spec/contracts/cli-commands/install.md)) whenever they put a question to the user: the clarification phases of `/flanders-spec` (see [.spec/contracts/ai-skills/spec-skill.md](/.spec/contracts/ai-skills/spec-skill.md)) and `/flanders-plan` (see [.spec/contracts/ai-skills/plan-skill.md](/.spec/contracts/ai-skills/plan-skill.md)) — both a skill's initial clarification phase and any re-entered clarification phase the post-write validation fix loop triggers (see [.spec/contracts/ai-skills/post-write-validation.md](/.spec/contracts/ai-skills/post-write-validation.md)) — and the end-of-run next-step launch question of `/flanders-spec` and `/flanders-hard-stop-review` (see [.spec/contracts/ai-skills/hard-stop-review-skill.md](/.spec/contracts/ai-skills/hard-stop-review-skill.md)).

## Bounded questions go through the AI tool's question facility
Every question a skill puts to the user whose answer space is bounded — a clarifying question with an enumerable answer space or a pick among presented approaches — is presented through the AI tool's question facility when the tool the skill runs in provides one, as a multiple-choice question whose options enumerate that answer space. When the AI tool provides no such facility, the skill asks the question in chat, phrasing it as a multiple-choice question whenever the answer space is bounded. The end-of-run next-step launch question is asked in the form pinned by [.spec/contracts/ai-skills/report-before-question.md](/.spec/contracts/ai-skills/report-before-question.md), not through the facility.

## Clarification batching
Before it begins asking, the skill accumulates every clarifying question it can determine whose content does not depend on the answer to another question, and asks that whole set together in a single interaction rather than one question at a time. A question is held back only when its content genuinely depends on an earlier answer.

When the AI tool provides a facility for asking several questions at once, the skill presents the accumulated batch through that facility in a single interaction. When the AI tool provides no such facility, the skill asks one question per turn.

A question whose content depends on the answer to an earlier question is held back and asked in a later round, once its prerequisite has been answered. Each later round again accumulates and presents together every question that has become independent, under the same cadence.

## Relationship to each skill's question scope
This cadence is independent of which questions a skill may ask. Whether a given question is put to the user at all is decided by the originating skill's contract — its clarification phase for clarifying questions, broad for `/flanders-spec` and narrower for `/flanders-plan`, with a re-entered clarification phase asking only about the specific ambiguity its failed validation issue closes, and its next-step section for the launch question. This contract governs only how the questions a skill has decided to ask are grouped and presented to the user.
