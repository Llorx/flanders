# README presentation

The root `README.md` is the document a user reads to learn how to use Flanders. The rules below pin how it presents its content: how deep each description reaches, where each topic is explained, how each step identifies the surface it runs on, and how the hard-stop explanation opens.

Which topics the `README.md` covers is pinned by [.spec/rules/readme-scoped-to-usable-surface.md](/.spec/rules/readme-scoped-to-usable-surface.md), its agreement with the project-root public contract layer by [.spec/rules/readme-mirrors-public-contract-layer.md](/.spec/rules/readme-mirrors-public-contract-layer.md), and the tone it is written in by [.spec/contracts/shared/flanders-voice.md](/.spec/contracts/shared/flanders-voice.md).

## Who this applies to
- The root `README.md` only, and every edit to it. Each rule below names the part of the `README.md` it binds.
- Documentation files inside source directories, including every nested `.spec/` folder, are not the root `README.md` and are not bound by these rules.

## Each topic is explained in one place

The `README.md` explains each topic once, in the section that introduces it. A section that reaches a topic an earlier section already explained names the topic and points the reader to where it is explained, carrying no second explanation of its own.

**Binds:** every section of the root `README.md`.

## Description stops where the reader's own operation stops

The `README.md` describes each part of the usable surface to the depth a reader needs in order to invoke it and know what to expect from it, and states what the reader does with the surface. The detail the running tool puts on screen for itself — the order of the entries in an interactive list and which entry it starts on, the fields, labels, and countdowns of a live status line, the individual files a preserved folder holds — is left to the tool to show.

**Binds:** every description in the root `README.md` of a CLI command, a skill, or an interactive prompt.

## Every step names the surface it runs on

Wherever the `README.md` presents a step the reader performs, that step names the surface it runs on: the Flanders CLI, or an invocation from inside an AI coding session.

**Binds:** every ordered workflow, every worked example, and every listed invocation in the root `README.md`.

## The hard-stop explanation opens with the recovery action

The first sentence of the `README.md`'s hard-stop explanation tells the reader to hand the preserved folder path that `implement` prints to the `/flanders-hard-stop-review` skill. What a hard stop is and what causes one follow that sentence, the causes as a list with one entry per cause.

**Binds:** the section of the root `README.md` that explains what happens on a hard stop.
