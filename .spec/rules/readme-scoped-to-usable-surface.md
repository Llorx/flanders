# README is scoped to the library's usable surface

The root `README.md` is the document a user reads to learn how to use Flanders. Its content is scoped to the library's usable surface: everything a reader needs in order to install, configure, and operate the library, and only that.

## Invariant
The `README.md` content is exactly the library's usable surface, bounded in both directions.

**Complete coverage.** The `README.md` documents the whole usable surface a user can invoke: every CLI command together with the arguments, flags, and behavior each one carries; every AI-tool skill together with what invoking it does; the requirements for running the library; how the library is installed; how it is configured; and how it is used from start to finish. Each part of the usable surface a user can operate is present in the `README.md`. The conceptual orientation a reader needs to understand what the library is and how its surfaces fit together — the spec → plan → implement cycle — is part of that usable surface and is documented too.

**Usable-surface only.** The `README.md` carries only content that helps a reader install, configure, or operate the library. Content that does not serve that purpose is absent: packaging metadata, license, authorship, repository / issue-tracker / homepage links, and a standalone section whose content describes a quality of the tool — such as the tone of its output — instead of how to operate it.

## Who this applies to
- The root `README.md` only. Every edit to the root `README.md`, and every change to the public surface it presents, keeps the `README.md` content within this scope.
- This rule governs which topics the `README.md` covers and which it leaves out. It does not govern the `README.md`'s section order, structure, or wording — those stay open per [.spec/rules/readme-mirrors-public-contract-layer.md](/.spec/rules/readme-mirrors-public-contract-layer.md) — nor the tone the `README.md` is written in, which the Flanders voice governs (see [.spec/contracts/shared/flanders-voice.md](/.spec/contracts/shared/flanders-voice.md)).

## Out of scope
- Documentation files inside source directories, including nested `.spec/` folders, are not the root `README.md` and are not bound by this rule.
- The agreement between the `README.md` and the project-root public contract layer — that the two never state the public surface inconsistently — is pinned by [.spec/rules/readme-mirrors-public-contract-layer.md](/.spec/rules/readme-mirrors-public-contract-layer.md), not here.
