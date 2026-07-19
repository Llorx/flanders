# Skill Chat Reports Precede Questions

## Purpose
Pin the ordering between a skill's substantive chat deliverables and the questions it puts to the user: a deliverable owed in chat is delivered as its own chat message before the question it precedes, and the question never substitutes for it. This contract governs that ordering and the form of the end-of-run next-step launch question; how every other question is grouped and presented is governed by [.spec/contracts/ai-skills/question-cadence.md](/.spec/contracts/ai-skills/question-cadence.md), and which deliverables a skill owes is governed by each skill's own contract.

## Scope
This contract governs every skill installed by `npx flanders install` (see [.spec/contracts/cli-commands/install.md](/.spec/contracts/cli-commands/install.md)) — `/flanders-spec` (see [.spec/contracts/ai-skills/spec-skill.md](/.spec/contracts/ai-skills/spec-skill.md)), `/flanders-plan` (see [.spec/contracts/ai-skills/plan-skill.md](/.spec/contracts/ai-skills/plan-skill.md)), `/flanders-work` (see [.spec/contracts/ai-skills/work-skill.md](/.spec/contracts/ai-skills/work-skill.md)), and `/flanders-hard-stop-review` (see [.spec/contracts/ai-skills/hard-stop-review-skill.md](/.spec/contracts/ai-skills/hard-stop-review-skill.md)) — whenever it puts a question to the user, whether through a facility the AI tool provides for asking questions or as a plain chat question when the AI tool provides no such facility.

## Obligation
When the skill's own contract obliges it to present a substantive deliverable in chat — a diagnosis, a planned file layout, an approach trade-off summary, or any other finding or report its contract requires it to present — and that presentation precedes a question, the skill delivers the deliverable as its own chat message, emitted before the question is presented. The question decides only the choice it asks.

The end-of-run next-step launch question — the question `/flanders-spec` and `/flanders-hard-stop-review` put to the user after their final report — is asked as plain chat text at the end of the same chat message that carries that final report, so the report and its question arrive together in one message.

Content embedded in the question interaction itself — the question's text, its option labels, or its option descriptions — does not satisfy a presentation obligation, whatever facility carries the question.

The obligation stands when the user has already supplied their own analysis or summary of the matter the deliverable covers: the skill still presents its own finding — where it confirms the user's account and where it diverges — before asking.

A question that no owed deliverable precedes — for example a clarifying question asked while the skill is still gathering what it needs — carries no preamble under this contract: the contract orders a presentation the skill already owes relative to the question that follows it, and requires no report where none is owed.
