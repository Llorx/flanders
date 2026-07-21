// Independent reproductions of the surface-neutral additions the shared reviewer methodology
// carries, kept here as the single authoritative source so both `prompts.test.ts` and
// `skills.test.ts` assert against one literal rather than duplicating it. The literals are
// reproduced independently of the production string (not imported from `prompts.ts`) so any drift
// in the shipped wording is caught by an exact-match. Every paragraph addition interpolates no
// per-surface field, so each renders identically into the implement reviewer prompt
// (`prompts.reviewer`), the citation-free `reviewerMethodologyCore`, and `workSkillBody`. The
// code-comment discipline is reproduced as a builder instead, because it is the one addition that
// varies per surface: only the channel its justification is routed to differs.

export const REFERENCED_OBLIGATION_ENUMERATION_PARAGRAPH = "Referenced-obligation enumeration. Before deciding conditions 2, 3, 4, and 5 are met, enumerate the discrete obligations of each contract and rule in scope — every contract and rule the work references, plus every corpus contract, rule, or behavior rule you judge should have applied — as separate items, and confirm each obligation is actively applied in the changes. A contract or rule that pins more than one discrete obligation — for example a required-exclusion list, a set of required surfaces, or several conditions stated in one section — is never satisfied by confirming the contract or rule \"in general\": each enumerated obligation is its own item with its own confirmation, and an obligation the changes leave unapplied, or that you never enumerated, is a violation. A reference whose obligations enumerate N discrete facts expands into N items.";

export const TEST_GUARDED_COVERAGE_SENTENCE = "A spec element classified test-guarded is confirmed satisfied only when the named test's assertions cover every case and every fact the element requires: the existence of a test for the element is not enough, and a test that asserts some of the element's cases while leaving a required case unguarded does not satisfy it — the uncovered case is a violation, never waved through as holding \"by inspection\".";

export const FULL_TEST_BODY_READ_PARAGRAPH = "Read the complete body of every test you accept as evidence — the fixture and setup it builds, the concrete inputs it drives, and every assertion it makes. A test is never accepted from its name, a search hit showing it exists, a citation of it, or an assertion list read without the fixture that produces the asserted state.";

export const COMMENT_ADJUDICATION_PARAGRAPH = "Comment adjudication. Judge every comment the changes add or modify. A comment earns its place only by stating what the code cannot show — an external constraint, an invariant the code cannot enforce, or a consequence a competent reader of the code alone would get wrong. One that instead argues the change is correct, cites the obligation or review finding behind it, or narrates what the code used to do is a violation, recorded with its `file:line`. A comment a rule of the project requires at that construct is never a violation, and comments in files the change set does not touch — or that a touched file carried unmodified — are out of scope.";

// The code-authoring counterpart of the paragraph above, reproduced as a builder because the
// channel the displaced justification is routed to is the one part that differs per surface.
export function expectedCodeCommentEconomy(channel:string):string {
    return `Code comments: a comment you write states only what the code cannot show — an external constraint, an invariant the code cannot enforce, or a consequence a competent reader of the code alone would get wrong. The argument that your change is correct, the criterion, contract, rule, behavior rule, task, or review finding behind it, the \`file:line\` you want an inspection to target, and what the code used to do or has yet to migrate belong in ${channel}, never in the source. Where a rule of the project requires a comment at a construct, you write it.`;
}

export const COUNTERFACTUAL_REGRESSION_PARAGRAPH = "For each test you accept, construct the simplest plausible regression of the element — the least-effort implementation change that violates what it requires — and trace whether the test's assertions, evaluated against the inputs the test actually drives, would fail under it. Confirm the element only when they would. A fixture whose expected outcome coincides with what the implementation would produce while ignoring the tested input, taking the fallback path, or applying the default does not guard the element, whatever its assertions enumerate; a regression that survives the test is a violation, recorded with the surviving regression, the test's `file:line`, and the fixture property that lets it pass.";
