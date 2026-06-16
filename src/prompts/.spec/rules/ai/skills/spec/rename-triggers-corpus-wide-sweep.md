# A term rename sweeps the whole corpus by token, not a curated subset

When a `/flanders-spec` run renames, relocates, or removes a term that can recur in spec files beyond the ones it is editing — a folder name, a path segment, a flag, an identifier, a fixed string, or a namespace convention — the skill establishes the full set of files to touch by searching the entire corpus for the old term and triaging every occurrence individually. It does not curate a subset of "relevant" files by judgment and assume that subset is complete; coverage is driven by the token, not by which files the drafter believes are central.

## Who this applies to

- **Subject:** the `/flanders-spec` skill, during any request that renames, relocates, or removes such a recurring term, for every term the run changes.
- **Not subject:** `/flanders-plan` — it authors a single plan file and does not rename corpus-wide spec terms — and every other agent or command. A request that introduces only new terms, or edits a single file with no recurring term, does not trigger the sweep.

## What the sweep requires

- For each old term the run changes, search the whole corpus — every contract and every rule — for that term, and inspect every occurrence the search returns. The search is exhaustive over the corpus; it is not narrowed to the files the drafter already planned to edit.
- Triage each occurrence individually into exactly one of two dispositions: an occurrence the rename must update, which the run edits; or an occurrence that is an intentional reference the rename leaves alone, such as a cross-reference to an unrelated file or a deliberately unchanged example. An occurrence is never left unexamined on the grounds that its file looked irrelevant.
- The set of files the run edits is the union of the files the sweep shows must be updated. A file the sweep surfaces that the drafter had not planned to touch is added to the run.
- Moving or renaming a spec file changes that file's namespace — a path segment and namespace convention that recurs as the text and the target of every markdown link pointing at it. Such a move or rename is one of the term changes this sweep covers: the run searches the corpus for the old namespace and updates every occurrence, and because a reference's target is that namespace prefixed with a leading slash per [.spec/contracts/shared/cross-file-reference-links.md](/.spec/contracts/shared/cross-file-reference-links.md), updating an occurrence updates both the link text and the link target.

## How this relates to reading references

This obligation is additive to [src/prompts/.spec/rules/ai/skills/read-relevant-references-before-drafting.md](/src/prompts/.spec/rules/ai/skills/read-relevant-references-before-drafting.md). That rule governs which existing files the drafter reads before drafting, selected by relevance to the request. This rule governs coverage of a rename: for the specific case of a recurring term it removes the relevance judgment, because a stale occurrence most often survives precisely in a file the drafter judged irrelevant. The two obligations are complementary; neither substitutes for the other.

## Failure signals

- The run renames a recurring term, edits the files the drafter judged central, and leaves a stale occurrence of the old term in a file the drafter never searched.
- The drafter triages a broad search result by dismissing whole files as "incidental" without inspecting each occurrence inside them.
- The run fixes the set of files to edit before the corpus search and does not let the search expand that set.
