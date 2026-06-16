# Cross-File Reference Links

## Purpose
Pin the form every cross-file reference takes inside the markdown files Flanders skills produce, so a reader can follow a reference from one file to the file it points at by clicking it. This keeps the relationships between contracts, rules, and plan tasks navigable instead of having to be located by hand.

## Scope
This governs every reference that a file produced by `/flanders-spec` or `/flanders-plan` makes to another spec file in the project:

- A reference one contract or rule file makes to another contract or rule file (`/flanders-spec` output).
- A reference a plan task makes to a contract or rule file (`/flanders-plan` output).

A reference names a specific spec file by its namespace — its path relative to the project root, as pinned in [.docs/contracts/shared/spec-folder-layout.md](/.docs/contracts/shared/spec-folder-layout.md). A structural mention of a spec folder by its conventional shape — a `.spec/contracts` folder, a `.spec/rules` folder, the `plans/` folder — that names no specific file is not a cross-file reference and is not governed here.

## The link form
Every such reference is a real markdown link, `[text](target)`:

- The link text is the referenced file's namespace — its path relative to the project root, written without a leading slash — so the reference stays readable and searchable as written.
- The link target is the referenced file's namespace prefixed with a single leading slash, so the link resolves against the project root and can be followed from a referencing file at any depth in the project tree.

A reference is written as that markdown link, never as a bare path and never as inline code.

## Section and line references
When the relevant obligation lives in a specific section or line range of the referenced file rather than the whole file:

- The link text names that section or line range in addition to the namespace.
- The link target carries a fragment that points at it: the heading anchor for a section, `#L<n>` for a single line, or `#L<n>-L<m>` for a line range.

## Resolution invariant
A reference's target resolves to the referenced file's current location. When a referenced file is moved or renamed, every reference to it — its link text and its target — is updated to the file's new namespace, so the link keeps resolving. A reference is never left pointing at a path the referenced file no longer occupies.
