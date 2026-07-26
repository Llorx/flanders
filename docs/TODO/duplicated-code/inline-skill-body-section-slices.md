# Duplicated: inline skill-body section slices inside test bodies
Date: 2026-07-26

## What
`src/prompts/skills.test.ts` now has one authoritative section extractor, `sectionBetween(body, startMarker, endMarker)`, that every top-level semantic selector delegates to. Inside the `ASSERTS` entries of the same file, however, the identical `body.slice(body.indexOf(start), body.indexOf(end))` expression is still recomputed inline, with the same boundary pair repeated verbatim across the entries of a test and across sibling tests. The largest clusters:

- `"### Plan content rules"` → `"## Post-write verification"` — 26 identical inline copies.
- `"Drafting phase"` → `"Final validation"` — 10 identical inline copies.
- `"1. Format and shape"` → `"2. Semantic dependency order"` — 7 identical inline copies.
- `"## Procedure"` → `"## Final validation"` — 5 identical inline copies.
- `"## Final validation"` → `"## Summary"` and `"## Final validation"` → `"## Output language"` — 3 identical inline copies each.
- `"3. **Clarification phase.**"` → `"4. **Drafting phase.**"` — 2 identical inline copies.

Each cluster is a named section of a skill body that deserves the same thin semantic wrapper the top-level cluster already uses (`planValidatorCategory4`, `validatorInputsSection`, `specValidatorChecksSection`, `specValidatorCategoryC`, `interactionAndReasoningLanguageSection`).

## Where
- `src/prompts/skills.test.ts:40` — `sectionBetween`, the authoritative core the inline copies bypass.
- `src/prompts/skills.test.ts:944` onward — the `"### Plan content rules"` cluster, recomputed in 26 `ASSERTS` entries.
- `src/prompts/skills.test.ts:1822` onward — the `"Drafting phase"` cluster, recomputed in 10 `ASSERTS` entries.
- `src/prompts/skills.test.ts:1061` onward — the `"1. Format and shape"` cluster, recomputed in 7 `ASSERTS` entries.
- `src/prompts/skills.test.ts:2204` onward — the `"## Procedure"` cluster, recomputed in 5 `ASSERTS` entries.

## Why It Matters
The boundary strings are markers into prompt text that changes as the prompts change. When a heading is renamed, every inline copy of its boundary pair must be found and updated by hand; a missed copy does not fail loudly — `indexOf` returns `-1` and the slice silently degrades to a different region, so the assertion can keep passing while no longer testing the section it names. A named wrapper per section gives each boundary pair one authoritative definition, so a heading rename is a one-line edit and a stale marker surfaces at that single site. Consolidating is deferred rather than fixed inline because it touches roughly sixty assertion entries across four `describe` blocks unrelated to the change that surfaced this, and each cluster needs a wrapper name agreed against the prompt section it selects.
