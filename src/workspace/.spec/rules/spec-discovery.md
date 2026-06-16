# Spec discovery rules

## Recursive `.spec` discovery excludes git-ignored paths

The recursive discovery of `.spec` folders (pinned in [src/workspace/.spec/rules/spec-discovery.md#the-spec-corpus-is-enumerated-by-recursive-discovery-of-spec-folders](/src/workspace/.spec/rules/spec-discovery.md#the-spec-corpus-is-enumerated-by-recursive-discovery-of-spec-folders)) does not descend into or collect from any path the project's git ignore rules exclude. A directory git ignores is not walked, and a `.spec` folder located under an ignored path contributes no contracts or rules to the corpus. This keeps the walk out of ignored trees such as dependency and build-output directories, and it relies on the project being a git repository as required by [.spec/contracts/cli-commands/implement/git-integration.md](/.spec/contracts/cli-commands/implement/git-integration.md).

### Who this applies to

- **Subject:** the construction of the canonical reference set of `/flanders-spec` and `/flanders-plan` — the set of existing contracts and rules each skill reads before drafting.
- **Subject:** the construction of the global contract list and the global rule list that the `implement` command's orchestrator assembles and passes to its worker and reviewer invocations.
- **Not subject:** the `plans/` folder, which is enumerated directly and is not reached by this walk.

### Behavior

- A path excluded by the project's git ignore rules — whether through a `.gitignore` file or any other ignore source git honors — is skipped: the walk does not enter an ignored directory and does not collect an ignored `.spec` folder or any spec inside it.
- A non-ignored `.spec` folder is collected normally, whether or not its files are already tracked by git.

### Failure signals

- The walk descends into a git-ignored directory (for example a dependency or build-output directory) and collects `.spec` folders from it.
- A `.spec` folder under a git-ignored path contributes contracts or rules to the listing a skill, worker, or reviewer receives.
- The discovery enumerates ignored paths because it walks the raw directory tree without consulting the project's git ignore rules.

## The spec corpus is enumerated by recursive discovery of `.spec` folders

When a Flanders surface builds the list of the project's contracts and rules, it discovers them by walking the project tree and collecting every `.spec` folder it finds in the non-ignored portion of the tree (git-ignored paths are excluded per [src/workspace/.spec/rules/spec-discovery.md#recursive-spec-discovery-excludes-git-ignored-paths](/src/workspace/.spec/rules/spec-discovery.md#recursive-spec-discovery-excludes-git-ignored-paths)), at every depth — taking the files under each `.spec/contracts` subfolder as contracts and the files under each `.spec/rules` subfolder as rules. It does not read a single fixed pair of root folders. A contract or rule placed in a `.spec` folder anywhere in the tree is therefore included in the listing without any per-location configuration. The `.spec` layout this enumeration walks is pinned in [.spec/contracts/shared/spec-folder-layout.md](/.spec/contracts/shared/spec-folder-layout.md).

### Who this applies to

- **Subject:** the construction of the canonical reference set of `/flanders-spec` and `/flanders-plan` — the set of existing contracts and rules each skill reads before drafting.
- **Subject:** the construction of the global contract list and the global rule list that the `implement` command's orchestrator assembles and passes to its worker and reviewer invocations.
- **Not subject:** the `plans/` folder, which is a single project-root folder enumerated directly, not discovered by this walk.

### Behavior

- The discovery walks from the project root and, for every directory named `.spec`, collects the files under its `.spec/contracts/` subfolder as contracts and the files under its `.spec/rules/` subfolder as rules.
- Each discovered file is identified by its namespace — its path relative to the project root — so files that share a leaf filename in different `.spec` folders remain distinct entries.
- The project-root `.spec` folder and every nested `.spec` folder are collected the same way; depth carries no special casing.

### Failure signals

- A Flanders surface lists only a fixed root `.spec/contracts/` and `.spec/rules/` pair and misses contracts or rules that live in nested `.spec` folders.
- The discovery collapses two specs that share a leaf filename in different `.spec` folders into a single entry instead of distinguishing them by namespace.
- A spec placed in a valid, non-ignored `.spec` folder is absent from the listing the worker or reviewer receives.
