# A criterion that enumerates N facts needs N independent guards

When a single acceptance criterion enumerates N independent facts that the artifact must satisfy — "the body contains items A, B, C, D, E, and F", "the result has fields X AND Y AND Z", "the output covers cases (a), (b), (c), (d)" — each of the N facts needs its own independent guard. A criterion guarded by evidence covering only K of its N facts (K < N) is FAIL on the (N − K) facts that lack a guard, even when the uncovered facts happen to hold in the current artifact.

## Who this applies to

- **Subject:** every Flanders-launched subagent that produces or grades evidence for an acceptance criterion — the `worker` self-auditing per `rules/ai/agents/evidence-report.md`, the adversarial `reviewer` deciding PASS or FAIL, and any future role of the same shape.
- **Not subject:** the `/flanders-spec` and `/flanders-plan` post-write validators, which grade markdown spec and plan files rather than code under test.

## The enumerated-minimum is a floor, never a ceiling

A task may list, as one criterion, a minimum set of guards the artifact must carry ("the test has separate entries for A, B, C, D"). That enumerated list is a floor: it adds to this rule, it does not cap it. When one criterion enumerates N facts the artifact must satisfy and another criterion lists K < N of them as the required guards, the N-guard obligation governs — all N facts need guards regardless of the smaller list. The mismatch between the two criteria never licenses guarding only K; it is itself a signal that the smaller list undercounts what the artifact must protect.

## Why each fact needs its own guard

A guard that covers a subset of an enumerated criterion lets a regression of any uncovered fact pass silently — exactly the outcome the regression-signal classification in `rules/ai/agents/acceptance-criteria/criterion-evidence-classification.md` exists to prevent, applied fact by fact. A single guard standing in for several conjoined facts also fails the moment the artifact changes: if the guard checks fact A and facts B and C are deleted, the criterion is reported satisfied while two of its three obligations are gone. One guard per enumerated fact is what makes each fact independently regression-detectable.

## Failure signals

- A criterion enumerating N facts is marked satisfied by evidence covering only some of them, with the rest asserted to hold "by inspection".
- A subagent treats a task's enumerated-minimum guard list as the complete set of required guards when another criterion enumerates more facts the artifact must satisfy.
- Independent facts joined by AND in one criterion are collapsed into a single guard that would still pass if one of the conjuncts regressed.
