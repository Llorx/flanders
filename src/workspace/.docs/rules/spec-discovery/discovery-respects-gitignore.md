# Recursive `.docs` discovery excludes git-ignored paths

The recursive discovery of `.docs` folders (pinned in [src/workspace/.docs/rules/spec-discovery/docs-folders-enumerated-recursively.md](/src/workspace/.docs/rules/spec-discovery/docs-folders-enumerated-recursively.md)) does not descend into or collect from any path the project's git ignore rules exclude. A directory git ignores is not walked, and a `.docs` folder located under an ignored path contributes no contracts or rules to the corpus. This keeps the walk out of ignored trees such as dependency and build-output directories, and it relies on the project being a git repository as required by [.docs/contracts/cli-commands/implement/git-integration.md](/.docs/contracts/cli-commands/implement/git-integration.md).

## Who this applies to

- **Subject:** the construction of the canonical reference set of `/flanders-spec` and `/flanders-plan` — the set of existing contracts and rules each skill reads before drafting.
- **Subject:** the construction of the global contract list and the global rule list that the `implement` command's orchestrator assembles and passes to its worker and reviewer invocations.
- **Not subject:** the `plans/` folder, which is enumerated directly and is not reached by this walk.

## Behavior

- A path excluded by the project's git ignore rules — whether through a `.gitignore` file or any other ignore source git honors — is skipped: the walk does not enter an ignored directory and does not collect an ignored `.docs` folder or any spec inside it.
- A non-ignored `.docs` folder is collected normally, whether or not its files are already tracked by git.

## Failure signals

- The walk descends into a git-ignored directory (for example a dependency or build-output directory) and collects `.docs` folders from it.
- A `.docs` folder under a git-ignored path contributes contracts or rules to the listing a skill, worker, or reviewer receives.
- The discovery enumerates ignored paths because it walks the raw directory tree without consulting the project's git ignore rules.
