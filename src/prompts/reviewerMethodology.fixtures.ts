// Independent reproductions of the two surface-neutral additions the shared reviewer methodology
// carries, kept here as the single authoritative source so both `prompts.test.ts` and
// `skills.test.ts` assert against one literal rather than duplicating it. The literals are
// reproduced independently of the production string (not imported from `prompts.ts`) so any drift
// in the shipped wording is caught by an exact-match. Both additions interpolate no per-surface
// field, so each renders identically into the implement reviewer prompt (`prompts.reviewer`), the
// citation-free `reviewerMethodologyCore`, and `workSkillBody`.

export const REFERENCED_OBLIGATION_ENUMERATION_PARAGRAPH = "Referenced-obligation enumeration. Before deciding conditions 2, 3, 4, and 5 are met, enumerate the discrete obligations of each contract and rule in scope — every contract and rule the work references, plus every corpus contract, rule, or behavior rule you judge should have applied — as separate items, and confirm each obligation is actively applied in the changes. A contract or rule that pins more than one discrete obligation — for example a required-exclusion list, a set of required surfaces, or several conditions stated in one section — is never satisfied by confirming the contract or rule \"in general\": each enumerated obligation is its own item with its own confirmation, and an obligation the changes leave unapplied, or that you never enumerated, is a violation. A reference whose obligations enumerate N discrete facts expands into N items.";

export const TEST_GUARDED_COVERAGE_SENTENCE = "A spec element classified test-guarded is confirmed satisfied only when the named test's assertions cover every case and every fact the element requires: the existence of a test for the element is not enough, and a test that asserts some of the element's cases while leaving a required case unguarded does not satisfy it — the uncovered case is a violation, never waved through as holding \"by inspection\".";
