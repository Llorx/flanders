# Spec Folder Layout — `.docs` Hierarchy and Scope

## Purpose
Pin how a Flanders-managed project organizes its spec files, what makes a spec a contract or a rule, and where each spec belongs. This layout is the structure every Flanders skill and command reads the project's specs from and writes them to. Who is authorized to write each spec folder is pinned in `.docs/contracts/shared/spec-folder-write-authority.md`.

## `.docs` folders
A project's specs live in `.docs` folders. A `.docs` folder is a directory named exactly `.docs`, and one may appear at any level of the project tree — at the project root and inside any other directory. Each `.docs` folder holds three subfolders: a `.docs/contracts/` subfolder for that scope's contracts, a `.docs/rules/` subfolder for that scope's rules, and a `.docs/flanders/` subfolder for the rules that govern Flanders' own command behavior within that scope (see `.docs/contracts/shared/flanders-behavior-rules.md`). A `.docs` folder scopes the directory that contains it: the specs inside it govern that directory and everything beneath it.

## Contract versus rule — scope-relative
Within any `.docs` folder, the split between a contract and a rule is relative to the boundary of the directory that `.docs` scopes:

- A **contract** describes behavior visible across that boundary — what code outside the directory relies on. It states that behavior abstractly: it describes what the boundary guarantees, never how the directory achieves it internally, and it never names internal symbols, internal data shapes, or paths inside a source directory. At the project-root `.docs` folder the boundary is the whole project, so its contracts describe what the end user of the project sees, does, and relies on.
- A **rule** captures a single, atomic piece of implementation guidance internal to the directory the `.docs` scopes — a constraint, convention, or pattern that the directory's code must follow. Each rule file describes exactly one rule; bundles of related rules are modeled as a subfolder of single-rule files.

## Placement
A spec lives in the `.docs` folder of the lowest directory that encloses all the code its obligation governs:

- An obligation that governs only one directory lives in that directory's `.docs` folder.
- An obligation that governs code in two or more sibling directories lives in the `.docs` folder of their nearest common ancestor.
- An obligation about behavior at the project boundary lives in the project-root `.docs` folder.

A spec is a contract because code outside its scope depends on it, not because the end user observes it directly; only at the project-root `.docs` folder do those two coincide.

## Plans
Plans are project-level. They live in a single `plans/` folder at the project root — never inside a `.docs` folder and never nested. A plan sequences work across the whole project regardless of which directories its tasks touch.

## The corpus
The project's contracts are the union of every contract file across every `.docs/contracts` folder in the tree; the project's rules are the union of every rule file across every `.docs/rules` folder. A `.docs` folder located under a path the project's git ignore rules exclude is not part of the corpus — placing a `.docs` folder in an ignored location keeps its specs out of the corpus entirely. Every Flanders surface that consults the project's specs considers all of them: a contract or rule placed in any non-ignored `.docs` folder at any depth is part of the corpus and is honored.

## Namespace
A spec's namespace is its path relative to the project root. For a spec inside a nested `.docs` folder, that path includes the directories above the `.docs` folder, so two specs that share a filename in different `.docs` folders stay distinct. The namespace is how tasks, listings, and tooling reference a spec.
