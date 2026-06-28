# `/flanders-spec` flags README sync when the public contract layer changes

## When `/flanders-spec` changes the project-root public contract layer, it tells the user the README may need reconciliation

When a `/flanders-spec` run creates, modifies, or deletes any file under the project-root `.spec/contracts/` tree, the skill tells the user, in chat before the run ends, that the root `README.md` may need to be reconciled with the changed public contract layer so the two keep agreeing (the agreement obligation is pinned in [.spec/rules/readme-mirrors-public-contract-layer.md](/.spec/rules/readme-mirrors-public-contract-layer.md)). The skill surfaces this need; it never writes, creates, or edits the `README.md` itself, because its write boundary confines its output to the `.spec/contracts` and `.spec/rules` folders (see [.spec/contracts/ai-skills/spec-skill.md](/.spec/contracts/ai-skills/spec-skill.md)).

This is a behavior rule in the sense pinned by [.spec/contracts/shared/flanders-behavior-rules.md](/.spec/contracts/shared/flanders-behavior-rules.md): it constrains how the `/flanders-spec` skill (see [.spec/contracts/ai-skills/spec-skill.md](/.spec/contracts/ai-skills/spec-skill.md)) behaves while it works, not the host project's own code.

### Who this applies to

- **Subject:** the `/flanders-spec` skill, on any run whose work creates, modifies, or deletes a file whose target falls under the project-root `.spec/contracts/` tree.
- **Not subject:** a `/flanders-spec` run that touches only `.spec/rules` files, only nested (non-root) `.spec/contracts` files, or otherwise leaves the project-root public contract layer unchanged. The root `README.md` reflects only the project-root public surface, so a run that does not change that surface raises no reminder.

### Why

`/flanders-spec` is the only authorized editor of the project-root contracts yet cannot write the `README.md`, so when it changes the public surface the `README.md` can fall out of agreement with no single actor positioned to fix it inside the same run. The chat reminder closes that loop: it hands the reconciliation to the user or a code-writing flow that can write the `README.md`, without `/flanders-spec` performing a write it is not allowed to perform.

### Failure signals

- A `/flanders-spec` run edits the project-root public contract layer and ends without telling the user the `README.md` may need reconciliation.
- A `/flanders-spec` run writes or edits the `README.md` directly instead of only surfacing the need.
