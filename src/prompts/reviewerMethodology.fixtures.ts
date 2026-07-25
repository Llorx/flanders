// Independent reproductions of the surface-neutral additions the shared reviewer methodology
// carries, kept here as the single authoritative source so both `prompts.test.ts` and
// `skills.test.ts` assert against one literal rather than duplicating it. The literals are
// reproduced independently of the production string (not imported from `prompts.ts`) so any drift
// in the shipped wording is caught by an exact-match. Every paragraph addition interpolates no
// per-surface field, so each renders identically into the implement reviewer prompt
// (`prompts.reviewer`), the citation-free `reviewerMethodologyCore`, and `workSkillBody`. Content
// that varies per surface is reproduced as a builder instead: the code-comment discipline (the
// channel its justification is routed to differs) and the five FAIL conditions (the name of the
// spec under review and the first condition's wording differ).

export const REFERENCED_OBLIGATION_ENUMERATION_PARAGRAPH = "Referenced-obligation enumeration. Before deciding conditions 2, 3, 4, and 5 are met, enumerate the discrete obligations of each contract and rule in scope — every contract and rule the work references, plus every corpus contract, rule, or behavior rule you judge should have applied — as separate items, and confirm each obligation is actively applied in the changes. A contract or rule that pins more than one discrete obligation — for example a required-exclusion list, a set of required surfaces, or several conditions stated in one section — is never satisfied by confirming the contract or rule \"in general\": each enumerated obligation is its own item with its own confirmation, and an obligation the changes leave unapplied, or that you never enumerated, is a violation. A reference whose obligations enumerate N discrete facts expands into N items.";

export const COMMENT_ADJUDICATION_PARAGRAPH = "Comment adjudication. Judge every comment the changes add or modify. A comment earns its place only by stating what the code cannot show — an external constraint, an invariant the code cannot enforce, or a consequence a competent reader of the code alone would get wrong. One that instead argues the change is correct, cites the obligation or review finding behind it, or narrates what the code used to do is a violation, recorded with its `file:line`. The content a rule of the project requires at that construct is never a violation, and any further content the same comment carries beyond what the rule requires is judged by the same test as any other comment; comments in files the change set does not touch — or that a touched file carried unmodified — are out of scope.";

export const NO_OWN_TEST_STANDARD_SENTENCE = "You apply no test-adequacy, coverage, or regression standard of your own: you require a test, a particular assertion, or a regression guard for an enumerated item only where a contract or rule in scope requires one, and you then enforce that requirement as you enforce any other rule under conditions 3 and 4.";

export const NON_EXECUTION_PARAGRAPH = "You are inspection-only: you make no edit and run no operation that generates files. Compiling the project and running its tests both generate files, so you run neither the build command nor the test command — not directly, not through the project's package manager, and not through any wrapper. The build and test gates already passed against these changes before this review started, so you take the build as succeeding and the tests as passing without running them, and you confirm a claim one of those gates would catch by naming that already-passed gate or test instead of executing it. The only commands you run are the read-only git operations that derive the change set.";

// The code-authoring counterpart of the comment-adjudication paragraph, reproduced as a builder
// because the channel the displaced justification is routed to is the one part that differs per
// surface.
export function expectedCodeCommentEconomy(channel:string):string {
    return `Code comments: before you write a comment explaining the code, try to make the code itself say it — a clearer name, a type that carries the constraint, a construct extracted so its name replaces the explanation — and comment only where none of those expresses it, reaching no further than the code your change already writes or modifies. A comment you write states only what the code cannot show — an external constraint, an invariant the code cannot enforce, or a consequence a competent reader of the code alone would get wrong. The argument that your change is correct, the criterion, contract, rule, behavior rule, task, or review finding behind it, the \`file:line\` you want an inspection to target, and what the code used to do or has yet to migrate belong in ${channel}, never in the source. Where a rule of the project requires a comment at a construct, you write the content it requires; the rest of that comment meets the same standard as any other.`;
}

// The five FAIL conditions every Flanders adversarial reviewer enumerates, reproduced as a
// builder because two parts differ per surface: the name of the spec under review and the
// wording of the first condition.
export function expectedReviewerFailConditions(specRef:string, failCondition1:string):string {
    return `1. ${failCondition1}
2. A contract referenced by ${specRef} is not honored.
3. A rule referenced by ${specRef} is not applied in the changes — you have the positive obligation to verify that every referenced rule is actively applied; a referenced rule that is not applied is FAIL.
4. A contract or rule from the global lists above that you determine should have been applied but was not, even if not referenced by ${specRef}, is FAIL.
5. A behavior rule from the behavior-rule list above whose \`.spec/flanders\` scope encloses the files the working-tree changes touch is not honored by the changes, even if ${specRef} did not reference it, is FAIL.`;
}

export function reviewerFailConditionsBlock(surface:string):string {
    const marker = "a violation of ANY of them is a FAIL:\n\n";
    const start = surface.indexOf(marker) + marker.length;
    return surface.substring(start, surface.indexOf("\n\nExhaustiveness:", start));
}
