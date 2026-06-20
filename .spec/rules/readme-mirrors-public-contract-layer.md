# README mirrors the public contract layer

The project keeps a root `README.md` that presents the project's public surface to a human reader. The project-root public contract layer — every contract file under the project-root `.spec/contracts/` tree — is the source of truth for that public surface. The `README.md` is a derived, human-facing view of it; the contracts are canonical.

## Invariant
The root `README.md` and the project-root public contract layer never disagree. Wherever the `README.md` describes a part of the public surface that a project-root contract pins, it states that part consistently with the contract. The `README.md` may present the surface in its own words and add explanatory detail that no contract pins, but it never states anything about the public surface that a project-root contract contradicts.

## Obligation
A change to the project-root public contract layer is not complete until the root `README.md` has been reconciled with it, so that leaving the `README.md` unchanged would never leave it disagreeing with or misrepresenting the changed public surface. The reconciliation is required only when the change affects content the `README.md` covers — a contract change the `README.md` does not describe needs no `README.md` edit. Contracts lead and the `README.md` follows: the contract states the obligation and the `README.md` is brought into agreement with it, never the reverse.

## Who this applies to
- Every change to a file under the project-root `.spec/contracts/` tree, and every change to the root `README.md` that touches its description of the public surface.
- [.spec/contracts/shared/spec-folder-write-authority.md](/.spec/contracts/shared/spec-folder-write-authority.md) restricts edits to the project-root contracts to the `/flanders-spec` skill, and that skill is barred from writing the `README.md` (see [.spec/contracts/ai-skills/spec-skill.md](/.spec/contracts/ai-skills/spec-skill.md)). The `README.md` reconciliation is therefore performed by an actor that can write it — the user, or a code-writing flow such as `/flanders-work` or `implement` — while `/flanders-spec` surfaces the need per [.spec/flanders/flanders-spec-flags-readme-on-public-contract-change.md](/.spec/flanders/flanders-spec-flags-readme-on-public-contract-change.md).

## Out of scope
- The nested `.spec/contracts/` folders inside source directories pin internal-boundary public surfaces, not the end-user surface the root `README.md` presents; this rule binds only the project-root public contract layer.
- The exact structure, wording, and section layout of the `README.md` are not pinned here; only its agreement with the public contract layer is.
