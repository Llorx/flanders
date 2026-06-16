# The spec corpus is enumerated by recursive discovery of `.spec` folders

When a Flanders surface builds the list of the project's contracts and rules, it discovers them by walking the project tree and collecting every `.spec` folder it finds in the non-ignored portion of the tree (git-ignored paths are excluded per [src/workspace/.docs/rules/spec-discovery/discovery-respects-gitignore.md](/src/workspace/.docs/rules/spec-discovery/discovery-respects-gitignore.md)), at every depth — taking the files under each `.spec/contracts` subfolder as contracts and the files under each `.spec/rules` subfolder as rules. It does not read a single fixed pair of root folders. A contract or rule placed in a `.spec` folder anywhere in the tree is therefore included in the listing without any per-location configuration. The `.spec` layout this enumeration walks is pinned in [.docs/contracts/shared/spec-folder-layout.md](/.docs/contracts/shared/spec-folder-layout.md).

## Who this applies to

- **Subject:** the construction of the canonical reference set of `/flanders-spec` and `/flanders-plan` — the set of existing contracts and rules each skill reads before drafting.
- **Subject:** the construction of the global contract list and the global rule list that the `implement` command's orchestrator assembles and passes to its worker and reviewer invocations.
- **Not subject:** the `plans/` folder, which is a single project-root folder enumerated directly, not discovered by this walk.

## Behavior

- The discovery walks from the project root and, for every directory named `.spec`, collects the files under its `.spec/contracts/` subfolder as contracts and the files under its `.spec/rules/` subfolder as rules.
- Each discovered file is identified by its namespace — its path relative to the project root — so files that share a leaf filename in different `.spec` folders remain distinct entries.
- The project-root `.spec` folder and every nested `.spec` folder are collected the same way; depth carries no special casing.

## Failure signals

- A Flanders surface lists only a fixed root `.spec/contracts/` and `.spec/rules/` pair and misses contracts or rules that live in nested `.spec` folders.
- The discovery collapses two specs that share a leaf filename in different `.spec` folders into a single entry instead of distinguishing them by namespace.
- A spec placed in a valid, non-ignored `.spec` folder is absent from the listing the worker or reviewer receives.
