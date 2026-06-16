# A claim that enumerates N facts needs N independent guards

When a single claim (as defined in [src/commands/.spec/rules/ai/agents/evidence-report.md](/src/commands/.spec/rules/ai/agents/evidence-report.md)) enumerates N independent facts that the artifact must satisfy — "the body contains items A, B, C, D, E, and F", "the result has fields X AND Y AND Z", "the output covers cases (a), (b), (c), (d)", "no occurrence of X, Y, or Z" — each of the N facts needs its own independent guard. A claim guarded by evidence covering only K of its N facts (K < N) is FAIL on the (N − K) facts that lack a guard, even when the uncovered facts happen to hold in the current artifact.

## Who this applies to

- **Subject:** every Flanders-launched subagent that produces or grades evidence for a claim — the `worker` self-auditing per [src/commands/.spec/rules/ai/agents/evidence-report.md](/src/commands/.spec/rules/ai/agents/evidence-report.md), the adversarial `reviewer` deciding PASS or FAIL, and any future role of the same shape.
- **Not subject:** the `/flanders-spec` and `/flanders-plan` post-write validators, which grade markdown spec and plan files rather than code under test.

## The enumerated-minimum is a floor, never a ceiling

A task may list, as one claim, a minimum set of guards the artifact must carry ("the test has separate entries for A, B, C, D"). That enumerated list is a floor: it adds to this rule, it does not cap it. When one claim enumerates N facts the artifact must satisfy and another claim lists K < N of them as the required guards, the N-guard obligation governs — all N facts need guards regardless of the smaller list. The mismatch between the two claims never licenses guarding only K; it is itself a signal that the smaller list undercounts what the artifact must protect.

## Why each fact needs its own guard

A guard that covers a subset of an enumerated claim lets a regression of any uncovered fact pass silently — exactly the outcome the regression-signal classification in [src/commands/.spec/rules/ai/agents/evidence/claim-evidence-classification.md](/src/commands/.spec/rules/ai/agents/evidence/claim-evidence-classification.md) exists to prevent, applied fact by fact. A single guard standing in for several conjoined facts also fails the moment the artifact changes: if the guard checks fact A and facts B and C are deleted, the claim is reported satisfied while two of its three obligations are gone. One guard per enumerated fact is what makes each fact independently regression-detectable.

## Failure signals

- A claim enumerating N facts is marked satisfied by evidence covering only some of them, with the rest asserted to hold "by inspection".
- A subagent treats a task's enumerated-minimum guard list as the complete set of required guards when another claim enumerates more facts the artifact must satisfy.
- Independent facts joined by AND in one claim are collapsed into a single guard that would still pass if one of the conjuncts regressed.
- A rule claim that prohibits N distinct patterns (for example, "no `private`-state peek AND no `as any` cast AND no `// @ts-expect-error` comment for the same purpose") is guarded by an assertion that checks only one of the N patterns.
